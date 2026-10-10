import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageChops

from isoanim.articulated import Rig, build_articulated, sample_track
from isoanim.cli import main
from isoanim.common import IsoAnimError
from isoanim.validate import validate_character

EX = Path(__file__).resolve().parents[2] / "examples/articulated-rig"


@pytest.fixture()
def rig_dir(tmp_path):
    subprocess.run([sys.executable, str(EX / "make_parts.py"), str(tmp_path / "parts")], check=True, capture_output=True)
    (tmp_path / "rig.json").write_text((EX / "rig.json").read_text())
    return tmp_path


def test_keyframe_sampling_loops_seamlessly_and_eases():
    keys = [{"t": 0, "rot": {"a": 0}}, {"t": 0.5, "rot": {"a": 40}}]
    assert sample_track(keys, 0.0, True)["rot"]["a"] == 0
    assert sample_track(keys, 0.5, True)["rot"]["a"] == 40
    assert 0 < sample_track(keys, 0.25, True)["rot"]["a"] < 40
    assert sample_track(keys, 0.25, True, "linear")["rot"]["a"] == pytest.approx(20)
    assert sample_track(keys, 0.99, True)["rot"]["a"] == pytest.approx(0.0, abs=0.1)   # wraps back to key 0
    assert sample_track(keys, 0.9, False)["rot"]["a"] == 40                              # one-shots clamp
    with pytest.raises(IsoAnimError):
        sample_track([], 0.0, True)


def test_build_generates_valid_character(rig_dir):
    mp = build_articulated(rig_dir / "rig.json", rig_dir / "out")
    m = json.loads(mp.read_text())
    assert m["source"]["method"] == "articulated-2d"
    assert set(m["animations"]) == {"idle", "walk"}
    assert m["animations"]["walk"]["directions"] == ["S", "E", "W"] or set(m["animations"]["walk"]["directions"]) == {"S", "E", "W"}
    assert m["animations"]["walk"]["cycleTravel"]["E"]["x"] > 0
    rep = validate_character(mp)
    assert rep.ok, [f.message for f in rep.findings if f.severity == "error"]


def test_frames_really_differ_and_each_is_a_fresh_render(rig_dir):
    rig = Rig(json.loads((rig_dir / "rig.json").read_text()), rig_dir)
    from isoanim.articulated import sample_track as st
    spec = json.loads((rig_dir / "rig.json").read_text())["animations"]["walk"]
    a, _ = rig.render("E", st(spec["keyframes"], 0.0, True))
    b, _ = rig.render("E", st(spec["keyframes"], 0.25, True))
    assert ImageChops.difference(a, b).getbbox() is not None
    # rendering the same pose twice is bit-identical (deterministic, no cross-frame blending)
    a2, _ = rig.render("E", st(spec["keyframes"], 0.0, True))
    assert ImageChops.difference(a, a2).getbbox() is None


def test_mirrored_view_is_the_flipped_east_view_for_a_symmetric_pose(rig_dir):
    rig = Rig(json.loads((rig_dir / "rig.json").read_text()), rig_dir)
    e, _ = rig.render("E", {"root": [0, 0], "rot": {}})
    w, _ = rig.render("W", {"root": [0, 0], "rot": {}})
    flipped = e.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    # pivot-centred canvases: mirroring about the pivot column equals a flip of the canvas
    # (canvas width 96, pivot x 48 → mirror axis at x=48 maps pixel x to 95-x ± 1px rounding)
    diff = ImageChops.difference(w, flipped).getchannel("A")
    assert sum(diff.histogram()[64:]) < 0.01 * 96 * 96


def test_foot_markers_follow_the_rotating_legs_and_report_contacts(rig_dir):
    mp = build_articulated(rig_dir / "rig.json", rig_dir / "out")
    m = json.loads(mp.read_text())
    mk = m["animations"]["walk"]["footMarkers"]["E"]
    assert len(mk) == 8
    assert [x["contact"] for x in mk[0]] == [True, False]
    assert [x["contact"] for x in mk[5]] == [False, True]
    assert mk[0][0]["x"] != mk[2][0]["x"]  # foot moves as the leg swings


def test_rotating_leg_arcs_are_reported_as_slide(rig_dir):
    """An angle-only rig cannot keep a foot planted; the validator must say so rather than pass it."""
    mp = build_articulated(rig_dir / "rig.json", rig_dir / "out")
    rep = validate_character(mp, max_foot_slide=0.5)
    assert any(f.id == "foot.slide" for f in rep.findings)


def test_cli_and_error_paths(rig_dir, capsys):
    assert main(["articulated", "--rig", str(rig_dir / "rig.json"), "--out", str(rig_dir / "o2")]) in (0, 1)
    assert (rig_dir / "o2/character-manifest.json").exists()
    spec = json.loads((rig_dir / "rig.json").read_text())
    spec["hierarchy"]["head"] = "ghost"
    (rig_dir / "bad.json").write_text(json.dumps(spec))
    assert main(["articulated", "--rig", str(rig_dir / "bad.json"), "--out", str(rig_dir / "o3")]) == 2
    assert "unknown part" in capsys.readouterr().err
    (rig_dir / "parts/leg.png").unlink()
    assert main(["articulated", "--rig", str(rig_dir / "rig.json"), "--out", str(rig_dir / "o4")]) == 2
