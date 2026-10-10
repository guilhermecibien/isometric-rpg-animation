"""Frames tree (<anim>/<DIR>/<index>.png, e.g. from Blender) + metadata → atlas + manifest."""
from __future__ import annotations

from pathlib import Path

from .assemble import assemble_character, cycle_travel_for
from .common import DIRECTIONS_8, IsoAnimError, frame_name, read_json
from .spritesheet import open_rgba


def build_from_frames(frames_dir: str | Path, meta_path: str | Path, out_dir: str | Path) -> Path:
    """meta JSON: {id, profile, pivot:[x,y], animations:{walk:{fps, loop, stride?, events?}}, projection?, license?}.

    Frame counts and directions are discovered from the tree, so the tree is the source of truth.
    """
    root = Path(frames_dir)
    meta = read_json(meta_path)
    for k in ("id", "pivot", "animations"):
        if k not in meta:
            raise IsoAnimError(f"meta is missing {k!r}")
    proj = meta.get("projection", {"tileWidth": 64, "tileHeight": 32, "zScale": 40})
    frames, animations, size = {}, {}, None
    for anim, a in meta["animations"].items():
        adir = root / anim
        if not adir.is_dir():
            raise IsoAnimError(f"no folder for animation {anim!r} in {root}")
        dirs = [d for d in DIRECTIONS_8 if (adir / d).is_dir()]
        if not dirs:
            raise IsoAnimError(f"{adir}: no direction folders (expected names like {DIRECTIONS_8})")
        counts = {d: len(list((adir / d).glob("*.png"))) for d in dirs}
        n = counts[dirs[0]]
        if n == 0 or any(c != n for c in counts.values()):
            raise IsoAnimError(f"{anim}: every direction needs the same number of frames, found {counts}")
        for d in dirs:
            for i in range(n):
                f = adir / d / f"{i}.png"
                if not f.exists():
                    raise IsoAnimError(f"missing frame {f} (frames must be numbered 0..{n - 1})")
                im = open_rgba(f)
                if size is None:
                    size = im.size
                elif im.size != size:
                    raise IsoAnimError(f"{f} is {im.size}, expected {size}; all frames must share one canvas")
                frames[frame_name(anim, d, i)] = im
        entry = {"frames": n, "fps": a["fps"], "loop": a.get("loop", False), "directions": dirs, "events": a.get("events", [])}
        if a.get("stride"):
            entry["cycleTravel"] = cycle_travel_for(a["stride"], dirs, proj)
        animations[anim] = entry
    assert size is not None
    return assemble_character(out_dir, meta["id"], meta.get("profile", "humanoid"), frames, animations, size, tuple(meta["pivot"]),
                              {"method": meta.get("method", "frames-tree"), "license": meta.get("license", "unspecified"), "projection": proj},
                              name=meta.get("name"), shadow=meta.get("shadow"))
