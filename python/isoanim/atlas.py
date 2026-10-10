"""Atlas packing and export (Phaser 'JSON Array' format)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

from .common import IsoAnimError, write_json


def pack_grid(frames: dict[str, Image.Image], columns: int | None = None, padding: int = 0) -> tuple[Image.Image, dict]:
    """Pack same-size frames into a grid. Returns (sheet, phaser_atlas_dict).

    Frames must share dimensions: that is what keeps pivots identical across the sheet.
    `padding` adds transparent gutters (use >=1 if the texture is scaled or filtered).
    """
    if not frames:
        raise IsoAnimError("cannot build an atlas from zero frames")
    sizes = {im.size for im in frames.values()}
    if len(sizes) != 1:
        raise IsoAnimError(f"frames have different sizes {sorted(sizes)}; run `isoanim align` first")
    (w, h), = sizes
    n = len(frames)
    cols = columns or max(1, int(math.ceil(math.sqrt(n * h / w))))
    rows = int(math.ceil(n / cols))
    sheet = Image.new("RGBA", (cols * (w + padding) + padding, rows * (h + padding) + padding), (0, 0, 0, 0))
    entries = []
    for idx, (name, im) in enumerate(frames.items()):
        x = padding + (idx % cols) * (w + padding)
        y = padding + (idx // cols) * (h + padding)
        sheet.paste(im.convert("RGBA"), (x, y))
        entries.append({
            "filename": name,
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        })
    atlas = {"frames": entries, "meta": {"app": "isoanim", "version": "1.0", "size": {"w": sheet.width, "h": sheet.height}, "scale": "1", "format": "RGBA8888"}}
    return sheet, atlas


def write_atlas(frames: dict[str, Image.Image], out_png: str | Path, out_json: str | Path, **kw) -> dict:
    sheet, atlas = pack_grid(frames, **kw)
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_png)
    atlas["meta"]["image"] = out_png.name
    write_json(out_json, atlas)
    return atlas


def load_atlas_frames(atlas_json: dict, sheet: Image.Image) -> dict[str, Image.Image]:
    out = {}
    for e in atlas_json["frames"]:
        f = e["frame"]
        out[e["filename"]] = sheet.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    return out
