import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from isoanim.cli import main

ROOT = Path(__file__).resolve().parents[2]


def make_sheet(path, magenta_bg=True):
    """2 directions × 4 frames of 32px cells; a bobbing coloured block with a magenta gem."""
    bg = (255, 0, 255, 255) if magenta_bg else (0, 0, 0, 0)
    im = Image.new("RGBA", (32 * 4, 32 * 2), bg)
    d = ImageDraw.Draw(im)
    for r in range(2):
        for c in range(4):
            x, y = c * 32, r * 32
            top = 6 + (c % 2) * 2
            d.rectangle((x + 8, y + top, x + 24, y + 28), fill=(40, 120, 200, 255))
            d.rectangle((x + 14, y + top + 4, x + 16, y + top + 6), fill=(255, 0, 255, 255))
    im.save(path)


def spec(tmp, **over):
    s = {
        "id": "blocky", "profile": "humanoid", "sheet": "sheet.png", "grid": {"frameWidth": 32, "frameHeight": 32},
        "background": {"mode": "color", "color": [255, 0, 255]},
        "align": {"mode": "anchor"},
        "animations": {
            "idle": {"fps": 4, "loop": True, "frames": 4, "rows": {"S": 0, "E": 1}},
            "walk": {"fps": 8, "loop": True, "frames": 4, "rows": {"S": 0, "E": 1}, "stride": 1.0},
        },
    }
    s.update(over)
    (tmp / "spec.json").write_text(json.dumps(s))
    return tmp / "spec.json"


def test_process_existing_sheet_end_to_end(tmp_path, capsys):
    make_sheet(tmp_path / "sheet.png")
    code = main(["process", "--spec", str(spec(tmp_path)), "--out", str(tmp_path / "out")])
    out = capsys.readouterr().out
    m = json.loads((tmp_path / "out/character-manifest.json").read_text())
    assert code == 0, out
    assert m["animations"]["walk"]["cycleTravel"]["E"]["x"] > 0
    assert (tmp_path / "out/reports/validation-report.md").exists()
    assert "removed" in out and "kept" in out  # corrections are reported, incl. preserved magenta gem px
    assert "gem" not in out


def test_process_refuses_magenta_auto_without_confirmation(tmp_path, capsys):
    make_sheet(tmp_path / "sheet.png")
    code = main(["process", "--spec", str(spec(tmp_path, background={"mode": "auto"})), "--out", str(tmp_path / "o")])
    assert code == 2
    assert "magenta" in capsys.readouterr().err


def test_exit_codes_for_bad_input(tmp_path, capsys):
    assert main(["validate", "--manifest", str(tmp_path / "missing.json")]) == 2
    assert main(["split", "--sheet", str(tmp_path / "nope.png"), "--out-dir", str(tmp_path / "x"), "--cols", "2", "--rows", "2"]) == 2
    assert main(["bg", "remove", "--image", str(tmp_path / "x.png")]) == 2


def test_validate_exit_code_1_on_errors(hero, tmp_path):
    import shutil
    d = tmp_path / "c"
    shutil.copytree(Path(hero).parent, d)
    (d / "hero.json").unlink()
    assert main(["validate", "--manifest", str(d / "character-manifest.json")]) == 1


def test_validate_strict_turns_warnings_into_failures(hero, tmp_path):
    import shutil
    d = tmp_path / "c"
    shutil.copytree(Path(hero).parent, d)
    m = json.loads((d / "character-manifest.json").read_text())
    m["animations"]["walk"]["fps"] = 40  # 8 frames @40fps = 0.2s: implausible
    (d / "character-manifest.json").write_text(json.dumps(m))
    assert main(["validate", "--manifest", str(d / "character-manifest.json")]) == 0
    assert main(["validate", "--manifest", str(d / "character-manifest.json"), "--strict"]) == 1


def test_preview_and_compare_write_files(hero, tmp_path):
    out = tmp_path / "prev"
    assert main(["preview", "--manifest", str(hero), "--out-dir", str(out), "--anim", "walk", "--direction", "E", "--debug"]) == 0
    gif = Image.open(out / "walk_E.gif")
    assert gif.n_frames == 8
    assert (out / "walk_sheet.png").exists()
    assert main(["compare", "--before", str(hero), "--after", str(hero), "--anim", "walk", "--direction", "E", "--out", str(tmp_path / "cmp.png")]) == 0
    assert (tmp_path / "cmp.png").exists()


def test_analyze_never_claims_semantic_understanding(hero, tmp_path):
    from isoanim.cli import main as m
    out = tmp_path / "a.json"
    sheet = Path(hero).parent / "hero.png"
    assert m(["analyze", "--image", str(sheet), "--out", str(out)]) == 0
    a = json.loads(out.read_text())
    assert a["semanticAnalysis"] is False and a["analyzedBy"] == "local-metadata" and a["needsInput"]


def test_script_wrapper_runs_without_installing(tmp_path):
    r = subprocess.run([sys.executable, str(ROOT / "scripts/isoanim.py"), "doctor"], capture_output=True, text=True)
    assert "Pillow" in r.stdout and r.returncode in (0, 3)


def test_atlas_command_and_split_roundtrip(tmp_path):
    make_sheet(tmp_path / "sheet.png", magenta_bg=False)
    assert main(["split", "--sheet", str(tmp_path / "sheet.png"), "--out-dir", str(tmp_path / "f"), "--frame-size", "32x32"]) == 0
    assert len(list((tmp_path / "f").glob("*.png"))) == 8
    assert main(["align", "--in-dir", str(tmp_path / "f"), "--out-dir", str(tmp_path / "al"), "--mode", "foot"]) == 0
    assert main(["atlas", "--frames-dir", str(tmp_path / "al"), "--out", str(tmp_path / "atl")]) == 0
    atlas = json.loads((tmp_path / "atl.json").read_text())
    assert len(atlas["frames"]) == 8 and atlas["frames"][0]["filename"] == "frame_000"


def test_from_frames_builds_manifest_and_flags_inconsistent_trees(tmp_path, capsys):
    root = tmp_path / "frames"
    for d in ("S", "E"):
        for i in range(4):
            (root / "idle" / d).mkdir(parents=True, exist_ok=True)
            im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
            ImageDraw.Draw(im).rectangle((10, 6 + i % 2, 22, 28), fill=(200, 80, 80, 255))
            im.save(root / "idle" / d / f"{i}.png")
    meta = {"id": "blend", "pivot": [16, 29], "animations": {"idle": {"fps": 4, "loop": True}}}
    (tmp_path / "meta.json").write_text(json.dumps(meta))
    code = main(["from-frames", "--frames-dir", str(root), "--meta", str(tmp_path / "meta.json"), "--out", str(tmp_path / "o")])
    m = json.loads((tmp_path / "o/character-manifest.json").read_text())
    assert m["animations"]["idle"]["frames"] == 4 and m["animations"]["idle"]["directions"] == ["S", "E"]
    assert code in (0, 1)
    (root / "idle" / "E" / "3.png").unlink()
    assert main(["from-frames", "--frames-dir", str(root), "--meta", str(tmp_path / "meta.json"), "--out", str(tmp_path / "o2")]) == 2
    assert "same number of frames" in capsys.readouterr().err


def test_shipped_examples_and_skill_package_are_valid(tmp_path):
    import subprocess
    root = Path(__file__).resolve().parents[2]
    r = subprocess.run([sys.executable, str(root / "scripts/validate_skill.py"), str(root)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout
    ex = root / "examples/spritesheet-spec"
    spec = json.loads((ex / "spec.json").read_text())
    assert main(["process", "--spec", str(ex / "spec.json"), "--out", str(tmp_path / "p")]) == 0
    assert spec["id"] == "blocky"
