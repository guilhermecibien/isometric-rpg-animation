"""`process`: existing spritesheet + layout spec → validated character directory (path 1)."""
from __future__ import annotations

from pathlib import Path

from .align import align_many
from .assemble import assemble_character, cycle_travel_for
from .common import DIRECTIONS_8, IsoAnimError, frame_name, read_json
from .spritesheet import detect_background, open_rgba, remove_background, split_grid


def process_sheet(spec_path: str | Path, out_dir: str | Path) -> tuple[Path, list[str]]:
    sp = Path(spec_path)
    spec = read_json(sp)
    corrections: list[str] = []
    for k in ("id", "sheet", "grid", "animations"):
        if k not in spec:
            raise IsoAnimError(f"spec is missing required key {k!r}")
    sheet = open_rgba(sp.parent / spec["sheet"])

    bgc = spec.get("background", {"mode": "none"})
    mode = bgc.get("mode", "none")
    if mode == "auto":
        info = detect_background(sheet)
        if info["already_transparent"]:
            corrections.append("background: already transparent, nothing removed")
        elif not info["uniform"]:
            raise IsoAnimError(f"background auto-detect failed: border is not uniform (share {info['border_share']}); pass an explicit colour")
        else:
            if info["magenta_like"] and not bgc.get("allowMagenta"):
                raise IsoAnimError("border colour looks magenta; set background.mode='color' with background.color (or allowMagenta=true) to confirm it is a chroma key and not part of the art")
            sheet, r = remove_background(sheet, tuple(info["color"]), bgc.get("tolerance", 0))
            corrections.append(f"background: removed {r['removed_pixels']} px of colour {info['color']} ({r['removed_share']:.1%}); {r['same_color_pixels_kept']} same-colour interior px kept")
    elif mode == "color":
        col = tuple(bgc["color"])
        sheet, r = remove_background(sheet, col, bgc.get("tolerance", 0), bgc.get("contiguous", True))
        corrections.append(f"background: removed {r['removed_pixels']} px of colour {list(col)}; {r['same_color_pixels_kept']} same-colour px kept (not border-connected)")
    elif mode != "none":
        raise IsoAnimError(f"unknown background mode {mode!r}")

    g = spec["grid"]
    cells = split_grid(sheet, g.get("frameWidth"), g.get("frameHeight"), g.get("cols"), g.get("rows"), g.get("margin", 0), g.get("spacing", 0))
    cols = g.get("cols") or sheet.width // g["frameWidth"]

    seqs: dict[str, list] = {}
    meta: dict[str, dict] = {}
    proj = spec.get("projection", {"tileWidth": 64, "tileHeight": 32, "zScale": 40})
    for key, a in spec["animations"].items():
        dirs = a.get("rows") or {}
        if not dirs:
            raise IsoAnimError(f"animation {key!r} needs 'rows' mapping direction → row index")
        for d, row in dirs.items():
            if d not in DIRECTIONS_8:
                raise IsoAnimError(f"animation {key!r}: unknown direction {d!r}")
            start = a.get("startCol", 0)
            idxs = [row * cols + start + i for i in range(a["frames"])]
            if idxs[-1] >= len(cells):
                raise IsoAnimError(f"animation {key}/{d}: frames run past the end of the sheet")
            seqs[f"{key}/{d}"] = [cells[i] for i in idxs]
        meta[key] = a

    al = spec.get("align", {})
    aligned, arep = align_many(seqs, canvas=tuple(al["canvas"]) if al.get("canvas") else None, pivot=tuple(al["pivot"]) if al.get("pivot") else None,
                               mode=al.get("mode", "anchor"), padding=al.get("padding", 4), smooth_x=al.get("smoothX", False))
    corrections.append(f"align: mode={arep['mode']}, canvas {arep['canvas']}, pivot {arep['pivot']}, largest shift {arep['maxShift']}px")

    frames, animations = {}, {}
    for key, a in meta.items():
        dirs = list(a["rows"].keys())
        entry = {"frames": a["frames"], "fps": a["fps"], "loop": a.get("loop", key in ("idle", "walk", "run")), "directions": dirs,
                 "events": a.get("events", [])}
        if a.get("stride"):
            entry["cycleTravel"] = cycle_travel_for(a["stride"], dirs, proj)
        animations[key] = entry
        for d in dirs:
            for i, im in enumerate(aligned[f"{key}/{d}"]):
                frames[frame_name(key, d, i)] = im

    mp = assemble_character(
        out_dir, spec["id"], spec.get("profile", "humanoid"), frames, animations, tuple(arep["canvas"]), tuple(arep["pivot"]),
        {"method": "existing-spritesheet", "referenceImages": [spec["sheet"]], "license": spec.get("license", "unspecified"), "projection": proj},
        name=spec.get("name"), shadow=spec.get("shadow"), columns=spec.get("atlasColumns", 16))
    return mp, corrections
