"""Automatic asset validation.

Checks are split in two honest categories:
  objective  - measurable facts (sizes, hashes, pixel counts, marker arithmetic)
  heuristic  - statistical hints that point at likely problems but need a human eye
Passing every check does NOT mean the animation looks natural; the report says so.
"""
from __future__ import annotations

import hashlib
import math
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops

from .align import alpha_bbox
from .atlas import load_atlas_frames
from .common import HEADINGS, IsoAnimError, project, read_json
from .manifest import expected_frame_names, validate_structure

PROFILE_REQUIRED = {
    "humanoid": ["idle", "walk"], "quadruped": ["idle", "walk"], "flying": ["idle"], "legless": ["idle"],
}


@dataclass
class Finding:
    id: str
    severity: str  # error | warning | info
    kind: str      # objective | heuristic
    message: str
    where: str = ""

    def to_dict(self) -> dict:
        return {"id": self.id, "severity": self.severity, "kind": self.kind, "message": self.message, "where": self.where}


@dataclass
class Report:
    character: str = ""
    findings: list[Finding] = field(default_factory=list)
    checks: list[dict] = field(default_factory=list)   # every check that ran, with pass/fail
    stats: dict = field(default_factory=dict)
    corrections: list[str] = field(default_factory=list)

    def check(self, cid: str, description: str, kind: str = "objective") -> "Check":
        return Check(self, cid, description, kind)

    @property
    def errors(self) -> int:
        return sum(1 for f in self.findings if f.severity == "error")

    @property
    def warnings(self) -> int:
        return sum(1 for f in self.findings if f.severity == "warning")

    @property
    def ok(self) -> bool:
        return self.errors == 0

    def to_dict(self) -> dict:
        return {
            "character": self.character,
            "summary": {"ok": self.ok, "errors": self.errors, "warnings": self.warnings, "checksRun": len(self.checks),
                        "checksPassed": sum(1 for c in self.checks if c["passed"])},
            "checks": self.checks, "findings": [f.to_dict() for f in self.findings],
            "corrections": self.corrections, "stats": self.stats,
            "disclaimer": "Passing automated checks proves consistency of sizes, alignment and timing data. It does not prove the motion looks natural; review the preview GIFs and the interactive demo.",
        }


class Check:
    def __init__(self, report: Report, cid: str, description: str, kind: str):
        self.r, self.cid, self.desc, self.kind = report, cid, description, kind
        self.problems = 0

    def fail(self, severity: str, message: str, where: str = "") -> None:
        self.problems += 1
        self.r.findings.append(Finding(self.cid, severity, self.kind, message, where))

    def __enter__(self) -> "Check":
        return self

    def __exit__(self, *exc) -> None:
        self.r.checks.append({"id": self.cid, "description": self.desc, "kind": self.kind, "passed": self.problems == 0, "problems": self.problems})


def _hash(img: Image.Image) -> str:
    return hashlib.sha1(img.tobytes()).hexdigest()


def _centroid(img: Image.Image) -> tuple[float, float] | None:
    a = img.getchannel("A")
    bb = a.getbbox()
    if not bb:
        return None
    px = a.load()
    sx = sy = n = 0
    for y in range(bb[1], bb[3]):
        for x in range(bb[0], bb[2]):
            v = px[x, y]
            if v > 8:
                sx += x * v; sy += y * v; n += v
    return (sx / n, sy / n) if n else None


def _mad(a: Image.Image, b: Image.Image) -> float:
    d = ImageChops.difference(a.getchannel("A"), b.getchannel("A"))
    h = d.histogram()
    total = sum(i * c for i, c in enumerate(h))
    return total / (a.width * a.height)


def load_character(manifest_path: str | Path) -> tuple[dict, dict, Image.Image, Path]:
    manifest_path = Path(manifest_path)
    m = read_json(manifest_path)
    base = manifest_path.parent
    atlas = read_json(base / m["atlas"]["data"]) if (base / m["atlas"]["data"]).exists() else None
    img_path = base / m["atlas"]["image"]
    sheet = Image.open(img_path).convert("RGBA") if img_path.exists() else None
    return m, atlas, sheet, base  # type: ignore[return-value]


def validate_character(manifest_path: str | Path, max_foot_slide: float = 1.0, jump_factor: float = 4.0,
                       game_speeds: dict | None = None) -> Report:
    rep = Report()
    manifest_path = Path(manifest_path)
    m = read_json(manifest_path)
    rep.character = m.get("id", "?") if isinstance(m, dict) else "?"

    with rep.check("manifest.structure", "manifest has all required fields with valid values") as c:
        for p in validate_structure(m):
            c.fail("error", p)
    if rep.errors:
        return rep

    base = manifest_path.parent
    with rep.check("files.exist", "atlas image and data files referenced by the manifest exist") as c:
        for key in ("image", "data"):
            if not (base / m["atlas"][key]).exists():
                c.fail("error", f"atlas.{key} not found: {m['atlas'][key]}")
    if rep.errors:
        return rep
    atlas = read_json(base / m["atlas"]["data"])
    sheet = Image.open(base / m["atlas"]["image"]).convert("RGBA")

    names = [e["filename"] for e in atlas["frames"]]
    expected = expected_frame_names(m)
    fw, fh = m["frame"]["width"], m["frame"]["height"]

    with rep.check("atlas.refs", "every frame the manifest declares exists in the atlas exactly once, inside the image") as c:
        seen, dup = set(), set()
        for n in names:
            (dup if n in seen else seen).add(n)
        for n in sorted(dup):
            c.fail("error", f"duplicate atlas frame {n}", n)
        missing = [n for n in expected if n not in seen]
        for n in missing[:10]:
            c.fail("error", f"missing atlas frame {n}", n)
        if len(missing) > 10:
            c.fail("error", f"... and {len(missing) - 10} more missing frames")
        for e in atlas["frames"]:
            f = e["frame"]
            if f["x"] < 0 or f["y"] < 0 or f["x"] + f["w"] > sheet.width or f["y"] + f["h"] > sheet.height:
                c.fail("error", f"frame {e['filename']} lies outside the atlas image", e["filename"])
        for n in sorted(seen - set(expected))[:10]:
            c.fail("warning", f"atlas frame {n} is not declared in the manifest", n)

    if rep.errors:
        return rep
    frames = load_atlas_frames(atlas, sheet)

    with rep.check("frames.dimensions", "all frames have exactly the manifest frame size (same canvas = same pivot)") as c:
        for n, im in frames.items():
            if im.size != (fw, fh):
                c.fail("error", f"{n} is {im.size[0]}x{im.size[1]}, expected {fw}x{fh}", n)

    empties, opaque, clipped = [], [], []
    for n in expected:
        im = frames[n]
        if alpha_bbox(im) is None:
            empties.append(n)
            continue
        if im.getchannel("A").getextrema()[0] == 255:
            opaque.append(n)
        a = im.getchannel("A")
        px = a.load()
        W, H = im.size
        if any(px[x, 0] > 8 or px[x, H - 1] > 8 for x in range(W)) or any(px[0, y] > 8 or px[W - 1, y] > 8 for y in range(H)):
            clipped.append(n)
    with rep.check("frames.transparency", "no frame is empty or fully opaque (a leftover background)") as c:
        for n in empties:
            c.fail("error", f"{n} is fully transparent", n)
        for n in opaque[:10]:
            c.fail("warning", f"{n} has no transparent pixel; background may not have been removed", n)
    with rep.check("frames.clipping", "no sprite touches the canvas edge (likely clipped)") as c:
        for n in clipped[:10]:
            c.fail("warning", f"{n} has opaque pixels on the canvas border (possibly cropped)", n)
        if len(clipped) > 10:
            c.fail("warning", f"... {len(clipped) - 10} more frames touch the canvas border")

    pivot = (m["pivot"]["x"], m["pivot"]["y"])
    with rep.check("pivot.inside", "pivot lies within the sprite's horizontal extent in idle frames") as c:
        for d in m["animations"].get("idle", {}).get("directions", []):
            im = frames.get(f"idle/{d}/0")
            bb = alpha_bbox(im) if im else None
            if bb and not (bb[0] - 2 <= pivot[0] <= bb[2] + 2 and bb[1] <= pivot[1] <= bb[3] + 12):
                c.fail("warning", f"idle/{d}: pivot {pivot} is outside the sprite bbox {bb}", f"idle/{d}")

    prof_req = PROFILE_REQUIRED.get(m["profile"])
    with rep.check("profile.required", f"animations required by profile '{m['profile']}' are present") as c:
        if prof_req is None:
            c.fail("warning", f"unknown profile {m['profile']!r}; completeness not checked")
        else:
            for k in prof_req:
                if k not in m["animations"]:
                    c.fail("error", f"missing required animation {k!r}", k)

    stats: dict = {}
    dup_c = rep.check("frames.duplicates", "no unintended repeated frames inside a cycle")
    scale_c = rep.check("frames.scale", "silhouette height is consistent within each animation direction", "heuristic")
    jump_c = rep.check("motion.continuity", "no unexpected position jumps between consecutive frames", "heuristic")
    loop_c = rep.check("motion.loop-closure", "last→first frame transition of loops is as smooth as the rest", "heuristic")
    drift_c = rep.check("alignment.ground-drift", "in-place loops keep the ground point steady", "heuristic")
    with dup_c, scale_c, jump_c, loop_c, drift_c:
        for key, a in m["animations"].items():
            for d in a["directions"]:
                seq = [frames[f"{key}/{d}/{i}"] for i in range(a["frames"])]
                where = f"{key}/{d}"
                hs = [_hash(s) for s in seq]
                if a["frames"] > 2 and len(set(hs)) < len(hs):
                    dup_c.fail("warning" if key != "idle" else "info", f"{where}: {len(hs) - len(set(hs))} repeated frame(s)", where)
                boxes = [alpha_bbox(s) for s in seq]
                heights = [b[3] - b[1] for b in boxes if b]
                if len(heights) > 2 and key not in ("death", "hit", "attack", "cast", "spawn") and statistics.mean(heights) > 0:
                    cv = statistics.pstdev(heights) / statistics.mean(heights)
                    if cv > 0.12:
                        scale_c.fail("warning", f"{where}: silhouette height varies {cv:.0%} (coefficient of variation)", where)
                cents = [_centroid(s) for s in seq]
                if all(cents) and len(seq) > 2:
                    steps = [math.hypot(cents[i + 1][0] - cents[i][0], cents[i + 1][1] - cents[i][1]) for i in range(len(seq) - 1)]
                    med = max(statistics.median(steps), 1.0)
                    worst = max(steps)
                    if worst > jump_factor * med and worst > 6:
                        jump_c.fail("warning", f"{where}: centroid jumps {worst:.1f}px (median step {med:.1f}px) at frame {steps.index(worst)}→{steps.index(worst) + 1}", where)
                    if a["loop"] and len(seq) > 3:
                        closing = math.hypot(cents[0][0] - cents[-1][0], cents[0][1] - cents[-1][1])
                        if closing > jump_factor * med and closing > 6:
                            loop_c.fail("warning", f"{where}: loop seam moves {closing:.1f}px vs median {med:.1f}px", where)
                    if key == "idle":
                        feet_y = [b[3] for b in boxes if b]
                        if feet_y and max(feet_y) - min(feet_y) > 3:
                            drift_c.fail("warning", f"{where}: lowest pixel row drifts {max(feet_y) - min(feet_y)}px during idle", where)
                    stats.setdefault("meanCentroidStep", {})[where] = round(statistics.mean(steps), 3)

    with rep.check("timing.cycles", "cycle durations are plausible") as c:
        limits = {"walk": (0.4, 1.6), "run": (0.3, 1.2), "idle": (0.4, 6.0)}
        for key, a in m["animations"].items():
            dur = a["frames"] / a["fps"]
            if key in limits and not (limits[key][0] <= dur <= limits[key][1]):
                c.fail("warning", f"{key} cycle lasts {dur:.2f}s (expected {limits[key][0]}–{limits[key][1]}s)", key)
            if key == "death" and a["loop"]:
                c.fail("warning", "death should not loop", key)
            if key in ("walk", "run") and not a["loop"]:
                c.fail("error", f"{key} must loop", key)
            if key in ("attack", "cast", "hit", "start_walk", "stop_walk", "death") and a["loop"]:
                c.fail("warning", f"{key} is a one-shot animation but loop=true", key)
            if key in ("walk", "run") and a["frames"] % 2:
                c.fail("warning", f"{key} has an odd frame count ({a['frames']}); symmetric left/right cycles are expected", key)

    with rep.check("events.range", "animation events reference real frames and an attack has an impact event") as c:
        for key, a in m["animations"].items():
            for e in a.get("events", []) or []:
                if not 0 <= e["frame"] < a["frames"]:
                    c.fail("error", f"{key}: event {e['name']} at frame {e['frame']} is out of range", key)
        for key in ("attack", "cast"):
            if key in m["animations"] and not m["animations"][key].get("events"):
                c.fail("warning", f"{key} has no impact/release event; gameplay cannot sync damage to the animation", key)

    slide_c = rep.check("foot.slide", f"planted feet move ≤ {max_foot_slide}px/frame relative to the ground")
    marker_c = rep.check("foot.markers-on-sprite", "foot markers sit on opaque pixels of the sprite")
    travel_c = rep.check("sync.travel-direction", "cycleTravel points the way the sprite faces")
    with slide_c, marker_c, travel_c:
        for key, a in m["animations"].items():
            fm_all, ct_all = a.get("footMarkers") or {}, a.get("cycleTravel") or {}
            for d in a["directions"]:
                where = f"{key}/{d}"
                fm, ct = fm_all.get(d), ct_all.get(d)
                if ct:
                    hx, hy = HEADINGS[d]
                    ex, ey = project(hx, hy)
                    n1, n2 = math.hypot(ex, ey), math.hypot(ct["x"], ct["y"])
                    if n2 > 0 and (ex * ct["x"] + ey * ct["y"]) / (n1 * n2) < 0.9:
                        travel_c.fail("error", f"{where}: cycleTravel {ct} does not match the facing direction (expected toward {ex:.0f},{ey:.0f})", where)
                if fm:
                    for i, frame_markers in enumerate(fm):
                        im = frames[f"{key}/{d}/{i}"]
                        px = im.getchannel("A").load()
                        for mk in frame_markers:
                            x, y = int(round(pivot[0] + mk["x"])), int(round(pivot[1] + mk["y"]))
                            near = any(0 <= x + dx < im.width and 0 <= y + dy < im.height and px[x + dx, y + dy] > 8 for dx in range(-6, 7) for dy in range(-6, 7))
                            if not near:
                                marker_c.fail("warning", f"{where} frame {i}: marker {mk['id']} at ({x},{y}) is not near any sprite pixel", where)
                if fm and ct:
                    n = a["frames"]
                    step = (ct["x"] / n, ct["y"] / n)
                    worst, tot, cnt = 0.0, 0.0, 0
                    for i in range(n if a["loop"] else n - 1):
                        A, B = fm[i], fm[(i + 1) % n]
                        for fa in A:
                            fb = next((q for q in B if q["id"] == fa["id"]), None)
                            if fb and fa["contact"] and fb["contact"]:
                                s = math.hypot(fb["x"] - fa["x"] + step[0], fb["y"] - fa["y"] + step[1])
                                worst, tot, cnt = max(worst, s), tot + s, cnt + 1
                    stats.setdefault("footSlide", {})[where] = {"max": round(worst, 3), "mean": round(tot / cnt, 3) if cnt else None, "samples": cnt}
                    if cnt == 0:
                        slide_c.fail("warning", f"{where}: no planted-foot frames; slide cannot be verified", where)
                    elif worst > max_foot_slide:
                        slide_c.fail("warning", f"{where}: foot slide up to {worst:.2f}px/frame", where)
            if key in ("walk", "run") and not (ct_all and fm_all):
                slide_c.fail("info", f"{key}: no footMarkers/cycleTravel, so foot slide and speed sync cannot be verified", key)

    if game_speeds:
        with rep.check("sync.game-speed", "game speeds (world units/s) fall inside the animation's sync range (0.6–1.6×) for every direction") as c:
            pj = (m.get("source") or {}).get("projection") or {}
            tw, th, zs = pj.get("tileWidth", 64), pj.get("tileHeight", 32), pj.get("zScale", 40)
            for key, speed in game_speeds.items():
                a = m["animations"].get(key)
                if not a or not a.get("cycleTravel"):
                    continue
                for d, ct in a["cycleTravel"].items():
                    nominal = math.hypot(ct["x"], ct["y"]) * a["fps"] / a["frames"]
                    hx, hy = HEADINGS[d]
                    n = math.hypot(hx, hy)
                    sx, sy = project(hx / n * speed, hy / n * speed, 0, tw, th, zs)
                    ratio = math.hypot(sx, sy) / nominal if nominal else 0
                    if not 0.6 <= ratio <= 1.6:
                        c.fail("warning", f"{key}/{d}: game speed {speed} u/s is {ratio:.2f}× the stride speed", f"{key}/{d}")

    rep.findings.append(Finding("visual.review", "info", "heuristic",
                                "Naturalness, weight, anticipation, silhouette readability and style consistency cannot be verified automatically. Review the preview GIFs/contact sheets and run the demo."))
    rep.stats = {**stats, "frames": len(expected), "animations": len(m["animations"]), "atlas": f"{sheet.width}x{sheet.height}"}
    return rep
