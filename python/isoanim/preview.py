"""Previews: GIFs, contact sheets, pivot/foot overlays and before/after comparisons."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from .atlas import load_atlas_frames
from .common import IsoAnimError, read_json


def _load(manifest_path: str | Path):
    mp = Path(manifest_path)
    m = read_json(mp)
    atlas = read_json(mp.parent / m["atlas"]["data"])
    sheet = Image.open(mp.parent / m["atlas"]["image"]).convert("RGBA")
    return m, load_atlas_frames(atlas, sheet)


def _bg(size, color=(52, 64, 70, 255)):
    return Image.new("RGBA", size, color)


def overlay(frame: Image.Image, pivot, markers=None, scale: int = 1) -> Image.Image:
    im = _bg(frame.size)
    im.alpha_composite(frame)
    if scale > 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    d = ImageDraw.Draw(im)
    px, py = pivot[0] * scale, pivot[1] * scale
    d.line([(px - 6 * scale, py), (px + 6 * scale, py)], fill=(255, 238, 0, 255))
    d.line([(px, py - 6 * scale), (px, py + 6 * scale)], fill=(255, 238, 0, 255))
    for mk in markers or []:
        x, y = px + mk["x"] * scale, py + mk["y"] * scale
        col = (51, 255, 102, 255) if mk["contact"] else (255, 153, 51, 255)
        r = 3 * scale
        d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=max(1, scale))
    return im


def make_gif(manifest_path: str | Path, anim: str, direction: str, out: str | Path, scale: int = 2, debug: bool = False, loops: int = 0) -> Path:
    m, frames = _load(manifest_path)
    a = m["animations"].get(anim)
    if not a:
        raise IsoAnimError(f"animation {anim!r} not in manifest (have: {', '.join(m['animations'])})")
    if direction not in a["directions"]:
        raise IsoAnimError(f"direction {direction!r} not available for {anim}")
    pivot = (m["pivot"]["x"], m["pivot"]["y"])
    seq = []
    for i in range(a["frames"]):
        f = frames[f"{anim}/{direction}/{i}"]
        mk = (a.get("footMarkers") or {}).get(direction, [[]] * a["frames"])[i] if debug else None
        seq.append(overlay(f, pivot, mk, scale).convert("P", palette=Image.ADAPTIVE))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    seq[0].save(out, save_all=True, append_images=seq[1:], duration=int(1000 / a["fps"]), loop=loops, disposal=2)
    return out


def contact_sheet(manifest_path: str | Path, anim: str, out: str | Path, scale: int = 1, debug: bool = True) -> Path:
    """Rows = directions, columns = frames."""
    m, frames = _load(manifest_path)
    a = m["animations"].get(anim)
    if not a:
        raise IsoAnimError(f"animation {anim!r} not in manifest")
    fw, fh = m["frame"]["width"] * scale, m["frame"]["height"] * scale
    dirs = a["directions"]
    sheet = _bg((fw * a["frames"], fh * len(dirs)))
    pivot = (m["pivot"]["x"], m["pivot"]["y"])
    for r, d in enumerate(dirs):
        for i in range(a["frames"]):
            mk = (a.get("footMarkers") or {}).get(d, [[]] * a["frames"])[i] if debug else None
            tile = overlay(frames[f"{anim}/{d}/{i}"], pivot, mk, scale)
            sheet.alpha_composite(tile, (i * fw, r * fh))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out)
    return out


def compare_sheets(before: str | Path, after: str | Path, anim: str, direction: str, out: str | Path, scale: int = 2) -> Path:
    """Two manifests (old vs new) rendered one above the other, frame by frame."""
    rows = []
    for mp in (before, after):
        m, frames = _load(mp)
        a = m["animations"].get(anim)
        if not a or direction not in a["directions"]:
            raise IsoAnimError(f"{mp}: no {anim}/{direction}")
        pivot = (m["pivot"]["x"], m["pivot"]["y"])
        mk = (a.get("footMarkers") or {}).get(direction)
        rows.append([overlay(frames[f"{anim}/{direction}/{i}"], pivot, mk[i] if mk else None, scale) for i in range(a["frames"])])
    n = max(len(r) for r in rows)
    w = max(t.width for r in rows for t in r)
    h = max(t.height for r in rows for t in r)
    out_im = _bg((w * n, h * 2 + 16), (24, 28, 32, 255))
    d = ImageDraw.Draw(out_im)
    for ri, row in enumerate(rows):
        for i, t in enumerate(row):
            out_im.alpha_composite(t, (i * w, ri * (h + 16)))
        d.text((4, ri * (h + 16) + 2), "BEFORE" if ri == 0 else "AFTER", fill=(255, 255, 255, 255))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out_im.convert("RGB").save(out)
    return out
