"""Orientation review: does the art in each direction cell really face that direction?

Size, pivot and foot-slide checks cannot tell a front view from a back view. A generated
SW row that shows the character's back passes every automatic check and then plays as a
character walking down-left while facing up. This module closes that gap with a compass
contact sheet (each direction drawn where it points on screen, with an arrow) and a
recorded review that `validate` enforces.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

from .common import DIRECTIONS_8, IsoAnimError, project, read_json, write_json

REVIEW_FILE = "orientation-review.json"

# What the character must look like when it travels toward this SCREEN direction.
# Judge the whole body (chest/back, face, leading foot), not only the head.
EXPECTED = {
    "S": "FRONT: face and chest fully visible, looking at the viewer",
    "SW": "FRONT 3/4 toward bottom-left: face and chest visible, body turned to screen-left",
    "W": "LEFT profile: face and chest toward screen-left",
    "NW": "BACK 3/4 toward top-left: back visible, body turned away to screen-left",
    "N": "BACK: back of head and back visible, no face",
    "NE": "BACK 3/4 toward top-right: back visible, body turned away to screen-right",
    "E": "RIGHT profile: face and chest toward screen-right",
    "SE": "FRONT 3/4 toward bottom-right: face and chest visible, body turned to screen-right",
}

# Compass layout of the sheet: each direction sits where it points on screen.
_GRID = {"NW": (0, 0), "N": (1, 0), "NE": (2, 0), "W": (0, 1), "E": (2, 1), "SW": (0, 2), "S": (1, 2), "SE": (2, 2)}


def _arrow(d: ImageDraw.ImageDraw, cx: float, cy: float, direction: str, length: float) -> None:
    # Screen vector of the world heading under the default projection (2:1 tiles).
    from .common import HEADINGS
    sx, sy = project(*HEADINGS[direction])
    n = math.hypot(sx, sy) or 1
    ux, uy = sx / n, sy / n
    ex, ey = cx + ux * length, cy + uy * length
    col = (255, 220, 40, 255)
    d.line([(cx, cy), (ex, ey)], fill=col, width=3)
    for a in (2.6, -2.6):
        ang = math.atan2(uy, ux) + a
        d.line([(ex, ey), (ex + math.cos(ang) * 12, ey + math.sin(ang) * 12)], fill=col, width=3)


def frames_from_manifest(manifest_path: str | Path, anim: str = "walk", index: int = 0) -> dict[str, Image.Image]:
    from .atlas import load_atlas_frames
    mp = Path(manifest_path)
    m = read_json(mp)
    a = m["animations"].get(anim) or next(iter(m["animations"].values()))
    atlas = read_json(mp.parent / m["atlas"]["data"])
    frames = load_atlas_frames(atlas, Image.open(mp.parent / m["atlas"]["image"]).convert("RGBA"))
    key = anim if anim in m["animations"] else next(iter(m["animations"]))
    return {d: frames[f"{key}/{d}/{index}"] for d in a["directions"] if f"{key}/{d}/{index}" in frames}


def frames_from_sheet(sheet_path: str | Path, rows: list[str], frame_size: tuple[int, int], col: int = 0) -> dict[str, Image.Image]:
    """A flat game sheet: one row per direction in the game's own order, equal cells."""
    sheet = Image.open(sheet_path).convert("RGBA")
    w, h = frame_size
    out = {}
    for r, name in enumerate(rows):
        d = name.upper()
        if d not in DIRECTIONS_8:
            raise IsoAnimError(f"--rows: {name!r} is not one of {', '.join(DIRECTIONS_8)}")
        box = (col * w, r * h, (col + 1) * w, (r + 1) * h)
        if box[2] > sheet.width or box[3] > sheet.height:
            raise IsoAnimError(f"row {name} ({box}) falls outside the {sheet.width}x{sheet.height} sheet; check --frame-size/--rows")
        out[d] = sheet.crop(box)
    return out


def orientation_sheet(frames: dict[str, Image.Image], out: str | Path, scale: float = 1.0) -> Path:
    cell_w = max(f.width for f in frames.values())
    cell_h = max(f.height for f in frames.values())
    cw, ch = max(int(cell_w * scale) + 40, 330), int(cell_h * scale) + 72
    im = Image.new("RGBA", (cw * 3, ch * 3), (52, 64, 70, 255))
    d = ImageDraw.Draw(im)
    for name, (gx, gy) in _GRID.items():
        x0, y0 = gx * cw, gy * ch
        d.rectangle([x0 + 1, y0 + 1, x0 + cw - 2, y0 + ch - 2], outline=(90, 104, 112, 255))
        f = frames.get(name)
        if f is None:
            d.text((x0 + 10, y0 + 10), f"{name}: MISSING", fill=(255, 90, 90, 255))
            continue
        if scale != 1:
            f = f.resize((max(1, int(f.width * scale)), max(1, int(f.height * scale))), Image.LANCZOS)
        im.alpha_composite(f, (x0 + (cw - f.width) // 2, y0 + 56))
        head, desc = EXPECTED[name].split(": ", 1)
        d.text((x0 + 8, y0 + 6), f"{name}  must be: {head}", fill=(255, 255, 255, 255))
        words, lines, cur = desc.split(), [], ""
        for w in words:
            if len(cur) + len(w) + 1 > 48:
                lines.append(cur); cur = w
            else:
                cur = f"{cur} {w}".strip()
        lines.append(cur)
        for i, ln in enumerate(lines[:2]):
            d.text((x0 + 8, y0 + 22 + i * 14), ln, fill=(190, 205, 212, 255))
        _arrow(d, x0 + cw - 30, y0 + ch - 24, name, 16)
    cx, cy = cw + cw // 2, ch + ch // 2
    for i, line in enumerate(("ORIENTATION REVIEW", "Each cell sits where it points", "on screen; the yellow arrow is", "the travel direction.", "", "Where does the figure LOOK/FACE?",
                              "Record it in the review file.", "Chest or back? Face or hair?")):
        d.text((cw + 14, ch + 30 + i * 16), line, fill=(255, 220, 40, 255) if i == 0 else (225, 232, 236, 255))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(out)
    return out


def write_review_template(path: str | Path, directions: list[str]) -> Path:
    write_json(path, {
        "reviewed": False,
        "instructions": "For each direction, set `observed` to the SCREEN compass direction the figure actually faces in the "
                        "art (S = chest to the viewer, N = back to the viewer, W = looking screen-left...). "
                        "Set `reviewed` to true when done. Validation fails if any observed differs from its key.",
        "observed": {d: None for d in directions},
    })
    return Path(path)


def check_review(review: dict | None, directions: list[str]) -> tuple[str, list[str]]:
    """Returns (state, problems). state: missing | pending | mismatch | ok."""
    if not review:
        return "missing", []
    obs = review.get("observed") or {}
    if not review.get("reviewed") or any(obs.get(d) is None for d in directions):
        return "pending", []
    bad = [f"{d}: art faces {obs[d]}, expected {d} ({EXPECTED[d].split(':')[0]})" for d in directions if obs.get(d) != d]
    return ("mismatch", bad) if bad else ("ok", [])
