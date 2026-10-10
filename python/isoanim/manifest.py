"""character-manifest.json: structural validation (mirrors src/pipeline/manifest.ts)."""
from __future__ import annotations

import re
from pathlib import Path

from .common import DIRECTIONS_8, IsoAnimError, read_json

SCHEMA_VERSION = 1


def validate_structure(m) -> list[str]:
    p: list[str] = []
    if not isinstance(m, dict):
        return ["manifest must be an object"]
    if m.get("schemaVersion") != SCHEMA_VERSION:
        p.append(f"schemaVersion must be {SCHEMA_VERSION}")
    if not isinstance(m.get("id"), str) or not re.match(r"^[A-Za-z0-9][A-Za-z0-9_-]*$", m["id"]):
        p.append("id must be a non-empty identifier")
    if not isinstance(m.get("profile"), str):
        p.append("profile must be a string")
    f = m.get("frame")
    if not (isinstance(f, dict) and all(isinstance(f.get(k), (int, float)) and f[k] > 0 for k in ("width", "height"))):
        p.append("frame.width/height must be positive numbers")
        f = None
    pv = m.get("pivot")
    if not (isinstance(pv, dict) and all(isinstance(pv.get(k), (int, float)) for k in ("x", "y"))):
        p.append("pivot.x/y must be numbers")
    elif f and not (0 <= pv["x"] <= f["width"] and 0 <= pv["y"] <= f["height"]):
        p.append("pivot lies outside the frame")
    a = m.get("atlas")
    if not (isinstance(a, dict) and isinstance(a.get("image"), str) and isinstance(a.get("data"), str)):
        p.append("atlas.image and atlas.data must be strings")
    anims = m.get("animations")
    if not isinstance(anims, dict) or not anims:
        p.append("animations must be a non-empty object")
        return p
    for key, an in anims.items():
        w = f"animations.{key}"
        if not isinstance(an, dict):
            p.append(f"{w} must be an object")
            continue
        n = an.get("frames")
        if not isinstance(n, int) or isinstance(n, bool) or n < 1:
            p.append(f"{w}.frames must be an integer >= 1")
            n = None
        if not isinstance(an.get("fps"), (int, float)) or an["fps"] <= 0:
            p.append(f"{w}.fps must be > 0")
        if not isinstance(an.get("loop"), bool):
            p.append(f"{w}.loop must be boolean")
        dirs = an.get("directions")
        if not isinstance(dirs, list) or not dirs:
            p.append(f"{w}.directions must be a non-empty array")
        else:
            for d in dirs:
                if d not in DIRECTIONS_8:
                    p.append(f"{w}.directions contains invalid {d!r}")
        for e in an.get("events", []) or []:
            if not isinstance(e, dict) or not isinstance(e.get("frame"), int) or not isinstance(e.get("name"), str):
                p.append(f"{w}.events entries need frame and name")
            elif n and not (0 <= e["frame"] < n):
                p.append(f"{w}.events {e['name']!r} frame {e['frame']} out of range")
        fm = an.get("footMarkers")
        if isinstance(fm, dict) and n:
            for d, per in fm.items():
                if not isinstance(per, list) or len(per) != n:
                    p.append(f"{w}.footMarkers.{d} must have one entry per frame")
    return p


def load_manifest(path: str | Path) -> dict:
    m = read_json(path)
    problems = validate_structure(m)
    if problems:
        raise IsoAnimError("invalid manifest:\n - " + "\n - ".join(problems))
    return m


def expected_frame_names(m: dict) -> list[str]:
    return [f"{k}/{d}/{i}" for k, a in m["animations"].items() for d in a["directions"] for i in range(a["frames"])]
