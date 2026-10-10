"""Shared helpers: directions, projection constants, JSON IO and errors."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

DIRECTIONS_8 = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]

# World heading (x, y) for each SCREEN direction under the default projection
# (camera rotation 0). +x runs down-right on screen, +y runs down-left.
HEADINGS = {
    "S": (1, 1), "SW": (0, 1), "W": (-1, 1), "NW": (-1, 0),
    "N": (-1, -1), "NE": (0, -1), "E": (1, -1), "SE": (1, 0),
}


class IsoAnimError(Exception):
    """User-facing error: bad input, missing file, invalid configuration."""


EXIT_OK = 0
EXIT_VALIDATION = 1  # ran fine, but errors were found in the assets
EXIT_USAGE = 2       # bad arguments or unreadable input
EXIT_ENV = 3         # missing dependency / tool


def heading(direction: str) -> tuple[float, float]:
    x, y = HEADINGS[direction]
    n = math.hypot(x, y)
    return x / n, y / n


def project(x: float, y: float, z: float = 0.0, tile_w: float = 64, tile_h: float = 32, z_scale: float = 42) -> tuple[float, float]:
    """World (cells) to screen px, matching src/core/iso.ts with camera rotation 0."""
    return (x - y) * tile_w / 2, (x + y) * tile_h / 2 - z * z_scale


def read_json(path: str | Path) -> Any:
    p = Path(path)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise IsoAnimError(f"file not found: {p}")
    except json.JSONDecodeError as e:
        raise IsoAnimError(f"invalid JSON in {p}: {e}")


def write_json(path: str | Path, data: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def frame_name(anim: str, direction: str, index: int) -> str:
    return f"{anim}/{direction}/{index}"
