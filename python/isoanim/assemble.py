"""Shared final step of every production path: frames + metadata → atlas, manifest."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from .atlas import write_atlas
from .common import frame_name, heading, project, write_json
from .manifest import SCHEMA_VERSION


def cycle_travel_for(stride: float, directions: list[str], projection: dict) -> dict:
    """Screen-space body travel per loop for a world stride (cells), using the runtime projection."""
    out = {}
    for d in directions:
        h = heading(d)
        sx, sy = project(h[0] * stride, h[1] * stride, 0, projection["tileWidth"], projection["tileHeight"], projection.get("zScale", 40))
        out[d] = {"x": round(sx, 4), "y": round(sy, 4)}
    return out


def assemble_character(out_dir: str | Path, char_id: str, profile: str, frames: dict[str, Image.Image], animations: dict,
                       canvas: tuple[int, int], pivot: tuple[int, int], source: dict, name: str | None = None,
                       shadow: dict | None = None, columns: int = 16, analysis: dict | None = None) -> Path:
    """`animations` maps key → manifest animation entry; `frames` maps `anim/dir/index` → image."""
    out = Path(out_dir)
    write_atlas(frames, out / f"{char_id}.png", out / f"{char_id}.json", columns=columns)
    manifest = {
        "schemaVersion": SCHEMA_VERSION, "id": char_id, "name": name or char_id, "profile": profile,
        "frame": {"width": canvas[0], "height": canvas[1]}, "pivot": {"x": pivot[0], "y": pivot[1]},
        "atlas": {"image": f"{char_id}.png", "data": f"{char_id}.json"},
        "animations": animations, "source": source,
        "analysis": analysis or {"analyzedBy": "local-metadata", "semanticAnalysis": False},
    }
    if shadow:
        manifest["shadow"] = shadow
    mp = out / "character-manifest.json"
    write_json(mp, manifest)
    return mp
