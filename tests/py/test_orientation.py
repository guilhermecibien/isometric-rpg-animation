import json
import shutil
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from isoanim import orientation as o
from isoanim.common import DIRECTIONS_8, IsoAnimError
from isoanim.validate import validate_character


def _review(observed, reviewed=True):
    return {"reviewed": reviewed, "observed": observed}


def test_check_review_states():
    assert o.check_review(None, DIRECTIONS_8)[0] == "missing"
    assert o.check_review(_review({d: None for d in DIRECTIONS_8}, False), DIRECTIONS_8)[0] == "pending"
    assert o.check_review(_review({d: d for d in DIRECTIONS_8}), DIRECTIONS_8) == ("ok", [])
    wrong = {d: d for d in DIRECTIONS_8}
    wrong["SW"], wrong["NW"] = "N", "NE"  # the real bug: SW drawn from behind, NW facing right
    state, bad = o.check_review(_review(wrong), DIRECTIONS_8)
    assert state == "mismatch" and len(bad) == 2 and "SW" in bad[0]


def test_sheet_in_game_row_order(tmp_path):
    rows = ["n", "ne", "e", "se", "s", "sw", "w", "nw"]
    sheet = Image.new("RGBA", (40, 80 * 8), (0, 0, 0, 0))
    for r in range(8):
        ImageDraw.Draw(sheet).rectangle([5, r * 80 + 5, 30, r * 80 + 70], fill=(30 * r + 10, 0, 0, 255))
    p = tmp_path / "walk.png"
    sheet.save(p)
    frames = o.frames_from_sheet(p, rows, (40, 80))
    assert list(frames) == ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    assert frames["SW"].getpixel((10, 10))[0] == 30 * 5 + 10  # row 5 is SW in game order
    out = o.orientation_sheet(frames, tmp_path / "s.png")
    assert out.exists() and Image.open(out).width >= 3 * 300
    with pytest.raises(IsoAnimError):
        o.frames_from_sheet(p, rows + ["s"], (40, 80))


def test_validate_enforces_orientation_review(hero, tmp_path):
    dst = tmp_path / "c"
    shutil.copytree(Path(hero).parent, dst)
    mp = dst / Path(hero).name
    rep = validate_character(mp)
    assert rep.ok and rep.warnings == 0  # a missing review is only info by default
    assert any(f.id == "orientation.review" and f.severity == "info" for f in rep.findings)
    assert not validate_character(mp, require_orientation=True).ok

    (dst / o.REVIEW_FILE).write_text(json.dumps(_review({d: d for d in DIRECTIONS_8})))
    assert validate_character(mp, require_orientation=True).ok

    bad = {d: d for d in DIRECTIONS_8}
    bad["SW"] = "N"
    (dst / o.REVIEW_FILE).write_text(json.dumps(_review(bad)))
    rep = validate_character(mp)
    assert not rep.ok
    assert any("wrong orientation" in f.message and "SW" in f.message for f in rep.findings)
