"""isoanim command line. Exit codes: 0 ok · 1 validation errors · 2 bad usage/input · 3 missing tool."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .common import DIRECTIONS_8, EXIT_ENV, EXIT_OK, EXIT_USAGE, EXIT_VALIDATION, IsoAnimError, write_json


def _size(s: str) -> tuple[int, int]:
    try:
        w, h = s.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected WxH, got {s!r}")


def _rgb(s: str) -> tuple[int, int, int]:
    try:
        parts = [int(p) for p in s.split(",")]
        assert len(parts) == 3 and all(0 <= p <= 255 for p in parts)
        return parts[0], parts[1], parts[2]
    except (ValueError, AssertionError):
        raise argparse.ArgumentTypeError(f"expected R,G,B (0-255), got {s!r}")


def cmd_doctor(a) -> int:
    rows, missing = [], False
    try:
        import PIL
        rows.append(("Pillow", PIL.__version__, True))
    except ImportError:
        rows.append(("Pillow", "missing: pip install Pillow", False)); missing = True
    for tool, why in (("node", "tests/demo"), ("npm", "tests/demo"), ("blender", "optional: 3D path"), ("ffmpeg", "optional: mp4 previews")):
        p = shutil.which(tool)
        rows.append((tool, p or f"not found ({why})", bool(p) or why.startswith("optional")))
        if not p and not why.startswith("optional"):
            missing = True
    for name, val, ok in rows:
        print(f"{'ok  ' if ok else 'FAIL'} {name:8s} {val}")
    return EXIT_ENV if missing else EXIT_OK


def cmd_analyze(a) -> int:
    from .analyze import analyze_references
    res = analyze_references(a.image, a.id)
    if a.out:
        write_json(a.out, res)
        print(f"wrote {a.out}")
    else:
        print(json.dumps(res, indent=2))
    return EXIT_OK


def cmd_split(a) -> int:
    from .spritesheet import open_rgba, split_by_gaps, split_grid
    sheet = open_rgba(a.sheet)
    if a.auto:
        frames = split_by_gaps(sheet)
    else:
        fw, fh = a.frame_size or (None, None)
        frames = split_grid(sheet, fw, fh, a.cols, a.rows, a.margin, a.spacing)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames):
        f.save(out / f"{a.prefix}{i:03d}.png")
    print(f"wrote {len(frames)} frames to {out}")
    return EXIT_OK


def cmd_bg(a) -> int:
    from .spritesheet import detect_background, open_rgba, remove_background
    img = open_rgba(a.image)
    if a.action == "detect":
        print(json.dumps(detect_background(img), indent=2))
        return EXIT_OK
    if not a.color:
        raise IsoAnimError("`bg remove` needs --color R,G,B (explicit on purpose: magenta may be part of the art). Run `bg detect` first.")
    out, rep = remove_background(img, a.color, a.tolerance, not a.global_)
    if not a.out:
        raise IsoAnimError("--out is required for `bg remove`")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    out.save(a.out)
    print(json.dumps(rep, indent=2))
    if rep["same_color_pixels_kept"]:
        print(f"note: {rep['same_color_pixels_kept']} pixels of that colour remain (not connected to the border); use --global to remove them too", file=sys.stderr)
    return EXIT_OK


def cmd_align(a) -> int:
    from .align import align_frames
    from .spritesheet import open_rgba
    files = sorted(Path(a.in_dir).glob("*.png"))
    if not files:
        raise IsoAnimError(f"no PNG files in {a.in_dir}")
    frames = [open_rgba(f) for f in files]
    out, rep = align_frames(frames, canvas=a.canvas, pivot=a.pivot, mode=a.mode, padding=a.padding, smooth_x=a.smooth_x)
    od = Path(a.out_dir)
    od.mkdir(parents=True, exist_ok=True)
    for f, im in zip(files, out):
        im.save(od / f.name)
    print(f"aligned {len(out)} frames: canvas {rep['canvas']} pivot {rep['pivot']} mode {rep['mode']} max shift {rep['maxShift']}px")
    return EXIT_OK


def cmd_atlas(a) -> int:
    from .atlas import write_atlas
    from .spritesheet import open_rgba
    root = Path(a.frames_dir)
    frames = {}
    for p in sorted(root.rglob("*.png")):
        frames[p.relative_to(root).with_suffix("").as_posix()] = open_rgba(p)
    if not frames:
        raise IsoAnimError(f"no PNG files under {root}")
    write_atlas(frames, a.out + ".png", a.out + ".json", columns=a.columns, padding=a.padding)
    print(f"wrote {a.out}.png / {a.out}.json ({len(frames)} frames; names are paths relative to {root})")
    return EXIT_OK


def cmd_process(a) -> int:
    from .process import process_sheet
    from .report import write_reports
    from .validate import validate_character
    mp, corrections = process_sheet(a.spec, a.out)
    rep = validate_character(mp)
    rep.corrections = corrections
    j, md = write_reports(rep, Path(a.out) / "reports")
    for c in corrections:
        print("•", c)
    print(f"manifest: {mp}\nreport:   {md}")
    return EXIT_OK if rep.ok else EXIT_VALIDATION


def cmd_articulated(a) -> int:
    from .articulated import build_articulated
    from .report import write_reports
    from .validate import validate_character
    mp = build_articulated(a.rig, a.out)
    rep = validate_character(mp)
    _, md = write_reports(rep, Path(a.out) / "reports")
    print(f"manifest: {mp}\nreport:   {md}")
    return EXIT_OK if rep.ok else EXIT_VALIDATION


def cmd_from_frames(a) -> int:
    from .from_frames import build_from_frames
    from .report import write_reports
    from .validate import validate_character
    mp = build_from_frames(a.frames_dir, a.meta, a.out)
    rep = validate_character(mp)
    _, md = write_reports(rep, Path(a.out) / "reports")
    print(f"manifest: {mp}\nreport:   {md}")
    return EXIT_OK if rep.ok else EXIT_VALIDATION


def cmd_validate(a) -> int:
    from .report import write_reports
    from .validate import validate_character
    speeds = dict(kv.split("=") for kv in (a.game_speed or []))
    rep = validate_character(a.manifest, a.max_foot_slide, game_speeds={k: float(v) for k, v in speeds.items()}, require_orientation=a.require_orientation)
    previews = [str(p) for p in sorted(Path(a.report_dir).glob("*.gif"))] if a.report_dir else None
    if a.report_dir:
        j, md = write_reports(rep, a.report_dir, [Path(p).name for p in previews or []])
        print(f"report: {md}")
    d = rep.to_dict()
    s = d["summary"]
    for f in rep.findings:
        if f.severity != "info":
            print(f"{f.severity.upper():7s} {f.id:24s} {f.message}")
    print(f"{'PASS' if rep.ok else 'FAIL'}: {s['errors']} error(s), {s['warnings']} warning(s), {s['checksPassed']}/{s['checksRun']} checks clean")
    print("note: automated checks cannot judge whether the motion looks natural; review the previews.")
    if not rep.ok or (a.strict and rep.warnings):
        return EXIT_VALIDATION
    return EXIT_OK


def cmd_orientation(a) -> int:
    from . import orientation as o
    if a.check:
        from .common import read_json
        rv = read_json(a.check)
        dirs = list((rv.get("observed") or {}).keys())
        state, bad = o.check_review(rv, dirs)
        for b in bad:
            print(f"ERROR   wrong orientation: {b}")
        print({"ok": "PASS: every direction faces where it should", "pending": "PENDING: review incomplete",
               "mismatch": "FAIL: art faces the wrong way", "missing": "FAIL: no review"}[state])
        return EXIT_OK if state == "ok" else EXIT_VALIDATION
    if a.sheet:
        if not (a.rows and a.frame_size):
            raise IsoAnimError("--sheet needs --rows (e.g. n,ne,e,se,s,sw,w,nw) and --frame-size WxH")
        frames = o.frames_from_sheet(a.sheet, [r for r in a.rows.split(",") if r], a.frame_size, a.col)
    elif a.manifest:
        frames = o.frames_from_manifest(a.manifest, a.anim, a.col)
    else:
        raise IsoAnimError("give --manifest or --sheet")
    out = Path(a.out_dir)
    sheet = o.orientation_sheet(frames, out / "orientation-sheet.png", a.scale)
    tpl = out / o.REVIEW_FILE
    if not tpl.exists():
        o.write_review_template(tpl, [d for d in DIRECTIONS_8 if d in frames])
    print(f"compass sheet: {sheet}\nreview file:   {tpl}\nLook at the sheet, fill `observed` per direction, then run: isoanim orientation --check {tpl}")
    print("When it passes, copy the review file next to the manifest so `validate` enforces it.")
    return EXIT_OK


def cmd_preview(a) -> int:
    from . import preview
    out = Path(a.out_dir)
    m = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
    anims = a.anim or list(m["animations"])
    n = 0
    for k in anims:
        an = m["animations"].get(k)
        if not an:
            raise IsoAnimError(f"unknown animation {k!r}")
        for d in (a.direction or an["directions"]):
            preview.make_gif(a.manifest, k, d, out / f"{k}_{d}.gif", a.scale, a.debug)
            n += 1
        preview.contact_sheet(a.manifest, k, out / f"{k}_sheet.png", max(1, a.scale // 2), a.debug)
    print(f"wrote {n} GIFs and {len(anims)} contact sheets to {out}")
    return EXIT_OK


def cmd_compare(a) -> int:
    from . import preview
    p = preview.compare_sheets(a.before, a.after, a.anim, a.direction, a.out, a.scale)
    print(f"wrote {p}")
    return EXIT_OK


def cmd_generate_demo(a) -> int:
    from .generate import generate_character
    from .report import write_reports
    from .validate import validate_character
    mp = generate_character(a.out, a.id, a.only)
    print(f"wrote {mp}")
    if a.validate:
        rep = validate_character(mp)
        write_reports(rep, Path(a.out) / "reports")
        s = rep.to_dict()["summary"]
        print(f"validation: {'PASS' if rep.ok else 'FAIL'} ({s['errors']} errors, {s['warnings']} warnings)")
        return EXIT_OK if rep.ok else EXIT_VALIDATION
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="isoanim", description="Sprite pipeline and validators for isometric RPG animation.")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("doctor", help="check dependencies"); s.set_defaults(fn=cmd_doctor)

    s = sub.add_parser("analyze", help="local metadata analysis of reference image(s)")
    s.add_argument("--image", nargs="+", required=True); s.add_argument("--id", default="character"); s.add_argument("--out")
    s.set_defaults(fn=cmd_analyze)

    s = sub.add_parser("split", help="cut a spritesheet into frames")
    s.add_argument("--sheet", required=True); s.add_argument("--out-dir", required=True); s.add_argument("--prefix", default="frame_")
    s.add_argument("--frame-size", type=_size, help="WxH"); s.add_argument("--cols", type=int); s.add_argument("--rows", type=int)
    s.add_argument("--margin", type=int, default=0); s.add_argument("--spacing", type=int, default=0)
    s.add_argument("--auto", action="store_true", help="detect frames separated by transparent gaps")
    s.set_defaults(fn=cmd_split)

    s = sub.add_parser("bg", help="detect or remove a uniform background")
    s.add_argument("action", choices=["detect", "remove"]); s.add_argument("--image", required=True)
    s.add_argument("--color", type=_rgb); s.add_argument("--tolerance", type=int, default=0); s.add_argument("--out")
    s.add_argument("--global", dest="global_", action="store_true", help="remove the colour everywhere, not only border-connected")
    s.set_defaults(fn=cmd_bg)

    s = sub.add_parser("align", help="put frames on a common canvas/pivot")
    s.add_argument("--in-dir", required=True); s.add_argument("--out-dir", required=True)
    s.add_argument("--mode", choices=["foot", "bottom-center", "anchor", "none"], default="anchor")
    s.add_argument("--canvas", type=_size); s.add_argument("--pivot", type=_size, help="X x Y written as XxY")
    s.add_argument("--padding", type=int, default=4); s.add_argument("--smooth-x", action="store_true")
    s.set_defaults(fn=cmd_align)

    s = sub.add_parser("atlas", help="pack a frames tree (anim/dir/idx.png) into a Phaser atlas")
    s.add_argument("--frames-dir", required=True); s.add_argument("--out", required=True, help="output path without extension")
    s.add_argument("--columns", type=int); s.add_argument("--padding", type=int, default=0)
    s.set_defaults(fn=cmd_atlas)

    s = sub.add_parser("process", help="spritesheet + spec → aligned atlas + manifest + report")
    s.add_argument("--spec", required=True); s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_process)

    s = sub.add_parser("articulated", help="articulated 2D rig (parts + keyframes) → frames, atlas, manifest")
    s.add_argument("--rig", required=True); s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_articulated)

    s = sub.add_parser("from-frames", help="frames tree (anim/DIR/N.png, e.g. Blender output) + meta JSON → atlas + manifest")
    s.add_argument("--frames-dir", required=True); s.add_argument("--meta", required=True); s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_from_frames)

    s = sub.add_parser("validate", help="validate a character directory")
    s.add_argument("--manifest", required=True); s.add_argument("--report-dir"); s.add_argument("--strict", action="store_true")
    s.add_argument("--max-foot-slide", type=float, default=1.0)
    s.add_argument("--require-orientation", action="store_true", help="fail when orientation-review.json is missing or incomplete")
    s.add_argument("--game-speed", nargs="*", metavar="ANIM=UNITS_PER_SEC", help="world units (cells) per second, e.g. walk=1.4 run=3.3")
    s.set_defaults(fn=cmd_validate)

    s = sub.add_parser("orientation", help="compass contact sheet + review file: does each direction's art face that direction?")
    s.add_argument("--manifest"); s.add_argument("--anim", default="walk")
    s.add_argument("--sheet", help="flat game sheet (one row per direction) instead of a manifest")
    s.add_argument("--rows", help="direction of each sheet row in order, e.g. n,ne,e,se,s,sw,w,nw")
    s.add_argument("--frame-size", type=_size, help="WxH of one cell in --sheet")
    s.add_argument("--col", type=int, default=0, help="frame column to show (default 0)")
    s.add_argument("--out-dir", default="orientation"); s.add_argument("--scale", type=float, default=1.0)
    s.add_argument("--check", metavar="REVIEW_JSON", help="only check a filled review file")
    s.set_defaults(fn=cmd_orientation)

    s = sub.add_parser("preview", help="GIFs and contact sheets")
    s.add_argument("--manifest", required=True); s.add_argument("--out-dir", required=True)
    s.add_argument("--anim", nargs="*"); s.add_argument("--direction", nargs="*"); s.add_argument("--scale", type=int, default=2)
    s.add_argument("--debug", action="store_true", help="draw pivot and foot markers")
    s.set_defaults(fn=cmd_preview)

    s = sub.add_parser("compare", help="before/after strip for one animation")
    s.add_argument("--before", required=True); s.add_argument("--after", required=True)
    s.add_argument("--anim", required=True); s.add_argument("--direction", required=True); s.add_argument("--out", required=True)
    s.add_argument("--scale", type=int, default=2)
    s.set_defaults(fn=cmd_compare)

    s = sub.add_parser("generate-demo", help="build the procedural demo character")
    s.add_argument("--out", required=True); s.add_argument("--id", default="hero"); s.add_argument("--only", nargs="*")
    s.add_argument("--validate", action="store_true")
    s.set_defaults(fn=cmd_generate_demo)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except IsoAnimError as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USAGE
    except ImportError as e:
        print(f"error: missing dependency: {e}", file=sys.stderr)
        return EXIT_ENV


if __name__ == "__main__":
    sys.exit(main())
