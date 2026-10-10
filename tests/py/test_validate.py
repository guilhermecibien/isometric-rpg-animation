import copy
import json
import math
from pathlib import Path

from PIL import Image

from isoanim.common import HEADINGS, project
from isoanim.validate import validate_character


def load(p):
    return json.loads(Path(p).read_text())


def test_generated_character_has_no_errors(hero):
    rep = validate_character(hero)
    assert rep.ok, [f for f in rep.findings if f.severity == "error"]
    assert rep.warnings == 0, [f.message for f in rep.findings if f.severity == "warning"]
    ids = {c["id"] for c in rep.checks}
    assert {"atlas.refs", "frames.dimensions", "foot.slide", "sync.travel-direction", "motion.continuity"} <= ids


def test_foot_markers_are_planted_for_every_direction(hero):
    rep = validate_character(hero)
    slide = rep.stats["footSlide"]
    assert len(slide) == 16  # walk + run × 8 directions
    assert all(v["max"] < 0.05 and v["samples"] >= 6 for v in slide.values())


def test_report_never_claims_naturalness(hero):
    d = validate_character(hero).to_dict()
    assert "does not prove the motion looks natural" in d["disclaimer"]
    assert any(f["id"] == "visual.review" and f["kind"] == "heuristic" for f in d["findings"])


def _copy(hero, tmp_path):
    import shutil
    dst = tmp_path / "c"
    shutil.copytree(Path(hero).parent, dst)
    return dst


def test_detects_foot_slide(hero, tmp_path):
    d = _copy(hero, tmp_path)
    m = load(d / "character-manifest.json")
    # make the stance foot stand still on screen while the body "moves": exactly what sliding looks like
    for per in m["animations"]["walk"]["footMarkers"]["E"]:
        for mk in per:
            mk["x"], mk["contact"] = 0.0, True
    (d / "character-manifest.json").write_text(json.dumps(m))
    rep = validate_character(d / "character-manifest.json")
    assert any(f.id == "foot.slide" and "walk/E" in f.where for f in rep.findings)


def test_detects_wrong_travel_direction(hero, tmp_path):
    d = _copy(hero, tmp_path)
    m = load(d / "character-manifest.json")
    ct = m["animations"]["walk"]["cycleTravel"]["E"]
    ct["x"], ct["y"] = -ct["x"], -ct["y"]
    (d / "character-manifest.json").write_text(json.dumps(m))
    rep = validate_character(d / "character-manifest.json")
    assert any(f.id == "sync.travel-direction" and f.severity == "error" for f in rep.findings)
    assert not rep.ok


def test_detects_missing_atlas_frame_and_bad_refs(hero, tmp_path):
    d = _copy(hero, tmp_path)
    a = load(d / "hero.json")
    a["frames"] = [f for f in a["frames"] if f["filename"] != "walk/S/3"]
    (d / "hero.json").write_text(json.dumps(a))
    rep = validate_character(d / "character-manifest.json")
    assert any(f.id == "atlas.refs" and "walk/S/3" in f.message for f in rep.findings)
    (d / "hero.png").unlink()
    rep = validate_character(d / "character-manifest.json")
    assert any(f.id == "files.exist" for f in rep.findings)


def test_detects_structural_errors(hero, tmp_path):
    d = _copy(hero, tmp_path)
    m = load(d / "character-manifest.json")
    m["animations"]["walk"]["fps"] = 0
    m["animations"]["walk"]["events"] = [{"frame": 99, "name": "x"}]
    m["pivot"] = {"x": 999, "y": 0}
    (d / "character-manifest.json").write_text(json.dumps(m))
    rep = validate_character(d / "character-manifest.json")
    msgs = " ".join(f.message for f in rep.findings)
    assert "fps must be > 0" in msgs and "out of range" in msgs and "pivot lies outside" in msgs


def test_detects_blank_and_opaque_frames(hero, tmp_path):
    d = _copy(hero, tmp_path)
    sheet = Image.open(d / "hero.png").convert("RGBA")
    atlas = load(d / "hero.json")
    e = {x["filename"]: x["frame"] for x in atlas["frames"]}
    f = e["idle/S/0"]
    sheet.paste((0, 0, 0, 0), (f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    g = e["idle/S/1"]
    sheet.paste((255, 0, 255, 255), (g["x"], g["y"], g["x"] + g["w"], g["y"] + g["h"]))
    sheet.save(d / "hero.png")
    rep = validate_character(d / "character-manifest.json")
    assert any(x.id == "frames.transparency" and x.severity == "error" and "idle/S/0" in x.message for x in rep.findings)
    assert any(x.id == "frames.transparency" and x.severity == "warning" and "idle/S/1" in x.message for x in rep.findings)


def test_game_speed_outside_sync_range_is_flagged(hero):
    rep = validate_character(hero, game_speeds={"walk": 6.0})
    assert any(f.id == "sync.game-speed" for f in rep.findings)
    ok = validate_character(hero, game_speeds={"walk": 1.375, "run": 3.325})
    assert not any(f.id == "sync.game-speed" for f in ok.findings)
    assert any(c["id"] == "sync.game-speed" and c["passed"] for c in ok.checks)


def test_cycle_travel_matches_runtime_projection(hero):
    m = load(hero)
    for d, (hx, hy) in HEADINGS.items():
        n = math.hypot(hx, hy)
        sx, sy = project(hx / n * 1.1, hy / n * 1.1)
        ct = m["animations"]["walk"]["cycleTravel"][d]
        assert math.isclose(ct["x"], sx, abs_tol=1e-3) and math.isclose(ct["y"], sy, abs_tol=1e-3)
