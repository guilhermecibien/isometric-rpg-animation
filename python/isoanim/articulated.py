"""Path 2: articulated 2D rig (cut-out parts + keyframed joint angles) → frames.

Every output frame is rendered from the parts at the pose for that instant; frames are
never produced by blending neighbouring frames, so there are no ghosts or smeared pixels.
Foot markers come from tagged points on the foot parts, so slide validation works.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

from .assemble import assemble_character, cycle_travel_for
from .common import DIRECTIONS_8, IsoAnimError, frame_name, read_json

_EASE = {
    "linear": lambda x: x,
    "smooth": lambda x: x * x * (3 - 2 * x),
    "hold": lambda x: 0.0,
}


def sample_track(keys: list[dict], t: float, loop: bool, ease: str = "smooth") -> dict:
    """Interpolate keyframes ({t, root:[x,y], rot:{part:deg}}) at time t in [0,1)."""
    if not keys:
        raise IsoAnimError("animation has no keyframes")
    ks = sorted(keys, key=lambda k: k["t"])
    if loop:  # wrap so the last key blends into the first one (seamless loops)
        ks = ks + [{**ks[0], "t": ks[0]["t"] + 1.0}]
        t = t if t >= ks[0]["t"] else t + 1.0
    if t <= ks[0]["t"]:
        return ks[0]
    for a, b in zip(ks, ks[1:]):
        if a["t"] <= t <= b["t"]:
            w = _EASE[ease]((t - a["t"]) / max(1e-9, b["t"] - a["t"]))
            parts = set(a.get("rot", {})) | set(b.get("rot", {}))
            ra, rb = a.get("rot", {}), b.get("rot", {})
            ax, ay = a.get("root", [0, 0]); bx, by = b.get("root", [0, 0])
            return {
                "root": [ax + (bx - ax) * w, ay + (by - ay) * w],
                "rot": {p: ra.get(p, 0.0) + (rb.get(p, 0.0) - ra.get(p, 0.0)) * w for p in parts},
            }
    return ks[-1]


def _rotate_about(img: Image.Image, pivot: tuple[float, float], angle_deg: float) -> tuple[Image.Image, tuple[float, float]]:
    """Rotate `img` clockwise by angle about `pivot`; returns (image, new pivot position inside it)."""
    r = int(math.ceil(max(math.hypot(x - pivot[0], y - pivot[1]) for x in (0, img.width) for y in (0, img.height)))) + 2
    big = Image.new("RGBA", (2 * r, 2 * r), (0, 0, 0, 0))
    big.alpha_composite(img, (int(round(r - pivot[0])), int(round(r - pivot[1]))))
    return big.rotate(-angle_deg, resample=Image.BICUBIC), (r, r)


class Rig:
    def __init__(self, spec: dict, base: Path):
        for k in ("parts", "hierarchy", "attach", "views", "animations", "canvas", "pivot"):
            if k not in spec:
                raise IsoAnimError(f"rig spec is missing {k!r}")
        self.spec = spec
        self.images: dict[str, Image.Image] = {}
        for name, p in spec["parts"].items():
            f = base / p["image"]
            try:
                self.images[name] = Image.open(f).convert("RGBA")
            except (FileNotFoundError, OSError) as e:
                raise IsoAnimError(f"part {name!r}: cannot read {f}: {e}")
        for child, parent in spec["hierarchy"].items():
            if child not in self.images or (parent is not None and parent not in self.images):
                raise IsoAnimError(f"hierarchy references unknown part: {child} → {parent}")
        roots = [c for c, p in spec["hierarchy"].items() if p is None]
        if len(roots) != 1:
            raise IsoAnimError(f"rig needs exactly one root part, found {roots}")
        self.root = roots[0]
        self._order = self._topo()

    def _topo(self) -> list[str]:
        out, seen = [], set()
        def visit(n):
            if n in seen:
                return
            p = self.spec["hierarchy"][n]
            if p is not None:
                visit(p)
            seen.add(n); out.append(n)
        for n in self.spec["hierarchy"]:
            visit(n)
        return out

    def pose_transforms(self, pose: dict, mirror: bool) -> dict[str, tuple[float, float, float]]:
        """name → (x, y, angle_deg) of each part's pivot in canvas space."""
        cw, ch = self.spec["canvas"]; px, py = self.spec["pivot"]
        rx, ry = pose.get("root", [0, 0])
        sgn = -1 if mirror else 1
        T: dict[str, tuple[float, float, float]] = {}
        for n in self._order:
            par = self.spec["hierarchy"][n]
            rot = sgn * pose.get("rot", {}).get(n, 0.0)
            ox, oy = self.spec["attach"].get(n, [0, 0])
            ox *= sgn
            if par is None:
                T[n] = (px + sgn * rx + ox, py + ry + oy, rot)
            else:
                X, Y, A = T[par]
                a = math.radians(A)
                T[n] = (X + ox * math.cos(a) - oy * math.sin(a), Y + ox * math.sin(a) + oy * math.cos(a), A + rot)
        return T

    def render(self, view: str, pose: dict) -> tuple[Image.Image, dict]:
        v = self.spec["views"][view]
        src_view = v.get("mirrorOf")
        base_view = self.spec["views"][src_view] if src_view else v
        mirror = bool(src_view)
        order = base_view.get("order") or self._order
        T = self.pose_transforms(pose, mirror)
        canvas = Image.new("RGBA", tuple(self.spec["canvas"]), (0, 0, 0, 0))
        for n in order:
            if n not in T:
                continue
            img = self.images[n]
            pv = tuple(self.spec["parts"][n]["pivot"])
            if mirror:
                img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                pv = (img.width - pv[0], pv[1])
            rot, (cx, cy) = _rotate_about(img, pv, T[n][2])
            _clip_paste(canvas, rot, (int(round(T[n][0] - cx)), int(round(T[n][1] - cy))))
        feet = {}
        for fid, f in self.spec.get("feet", {}).items():
            part, pt = f["part"], f["point"]
            ptx = (self.images[part].width - pt[0]) if mirror else pt[0]
            pvx, pvy = self.spec["parts"][part]["pivot"]
            pvx = (self.images[part].width - pvx) if mirror else pvx
            X, Y, A = T[part]
            dx, dy = ptx - pvx, pt[1] - pvy
            a = math.radians(A)
            feet[fid] = (X + dx * math.cos(a) - dy * math.sin(a), Y + dx * math.sin(a) + dy * math.cos(a))
        return canvas, feet


def _clip_paste(canvas: Image.Image, img: Image.Image, offset: tuple[int, int]) -> None:
    dx, dy = offset
    sx, sy = max(0, -dx), max(0, -dy)
    ex, ey = min(img.width, canvas.width - dx), min(img.height, canvas.height - dy)
    if ex > sx and ey > sy:
        canvas.alpha_composite(img.crop((sx, sy, ex, ey)), (max(0, dx), max(0, dy)))


def build_articulated(spec_path: str | Path, out_dir: str | Path) -> Path:
    sp = Path(spec_path)
    spec = read_json(sp)
    rig = Rig(spec, sp.parent)
    proj = spec.get("projection", {"tileWidth": 64, "tileHeight": 32, "zScale": 40})
    pivot = tuple(spec["pivot"])
    frames: dict[str, Image.Image] = {}
    animations: dict = {}
    for key, a in spec["animations"].items():
        n, loop = a["frames"], a.get("loop", False)
        dirs = a.get("directions") or list(spec["views"])
        for d in dirs:
            if d not in DIRECTIONS_8 or d not in spec["views"]:
                raise IsoAnimError(f"animation {key!r}: direction {d!r} has no view in the rig")
        entry = {"frames": n, "fps": a["fps"], "loop": loop, "directions": dirs, "events": a.get("events", [])}
        markers = {}
        for d in dirs:
            per_frame = []
            for i in range(n):
                t = i / n if loop else (i / (n - 1) if n > 1 else 0.0)
                pose = sample_track(a["keyframes"], t, loop, a.get("ease", "smooth"))
                img, feet = rig.render(d, pose)
                frames[frame_name(key, d, i)] = img
                if feet:
                    contacts = a.get("contacts", {})
                    per_frame.append([{"id": f, "x": round(x - pivot[0], 3), "y": round(y - pivot[1], 3),
                                       "contact": any(lo <= (i / n) < hi for lo, hi in contacts.get(f, []))} for f, (x, y) in feet.items()])
            if per_frame:
                markers[d] = per_frame
        if markers:
            entry["footMarkers"] = markers
        if a.get("stride"):
            entry["cycleTravel"] = cycle_travel_for(a["stride"], dirs, proj)
        animations[key] = entry
    return assemble_character(
        out_dir, spec["id"], spec.get("profile", "humanoid"), frames, animations, tuple(spec["canvas"]), pivot,
        {"method": "articulated-2d", "license": spec.get("license", "unspecified"), "projection": proj}, name=spec.get("name"), shadow=spec.get("shadow"))
