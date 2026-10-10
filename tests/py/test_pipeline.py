import json
import shutil
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from isoanim.align import align_frames, alpha_bbox, foot_point
from isoanim.atlas import pack_grid, write_atlas
from isoanim.common import IsoAnimError
from isoanim.spritesheet import detect_background, remove_background, split_by_gaps, split_grid


def blob(size=(32, 32), box=(8, 8, 24, 28), color=(200, 40, 40, 255)):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(im).rectangle(box, fill=color)
    return im


def test_split_grid_row_major_and_size():
    sheet = Image.new("RGBA", (64, 32))
    frames = split_grid(sheet, 16, 16)
    assert len(frames) == 8 and frames[0].size == (16, 16)
    assert len(split_grid(sheet, cols=4, rows=2)) == 8


def test_split_grid_errors():
    with pytest.raises(IsoAnimError):
        split_grid(Image.new("RGBA", (10, 10)))
    with pytest.raises(IsoAnimError):
        split_grid(Image.new("RGBA", (10, 10)), 16, 16, cols=2, rows=1)


def test_split_by_gaps_finds_separate_sprites():
    sheet = Image.new("RGBA", (80, 30))
    d = ImageDraw.Draw(sheet)
    d.rectangle((2, 3, 12, 20), fill=(255, 0, 0, 255))
    d.rectangle((30, 5, 45, 25), fill=(0, 255, 0, 255))
    d.rectangle((60, 1, 70, 10), fill=(0, 0, 255, 255))
    frames = split_by_gaps(sheet)
    assert [f.size for f in frames] == [(11, 18), (16, 21), (11, 10)]


def test_background_detect_reports_border_colour_only():
    im = Image.new("RGBA", (20, 20), (255, 0, 255, 255))
    info = detect_background(im)
    assert info["uniform"] and info["magenta_like"] and info["color"] == [255, 0, 255]
    assert detect_background(Image.new("RGBA", (4, 4), (0, 0, 0, 0)))["already_transparent"]


def test_remove_background_keeps_interior_magenta_by_default():
    im = Image.new("RGBA", (20, 20), (255, 0, 255, 255))
    d = ImageDraw.Draw(im)
    d.rectangle((4, 4, 15, 15), fill=(30, 30, 30, 255))
    d.rectangle((8, 8, 10, 10), fill=(255, 0, 255, 255))  # magenta gem inside the character
    out, rep = remove_background(im, (255, 0, 255))
    assert out.getpixel((0, 0))[3] == 0
    assert out.getpixel((9, 9)) == (255, 0, 255, 255)
    assert rep["same_color_pixels_kept"] == 9
    out2, rep2 = remove_background(im, (255, 0, 255), contiguous=False)
    assert out2.getpixel((9, 9))[3] == 0 and rep2["same_color_pixels_kept"] == 0


def test_remove_background_tolerance():
    im = Image.new("RGBA", (6, 6), (250, 3, 252, 255))
    out, rep = remove_background(im, (255, 0, 255), tolerance=6)
    assert rep["removed_pixels"] == 36
    _, rep0 = remove_background(im, (255, 0, 255), tolerance=0)
    assert rep0["removed_pixels"] == 0


def test_foot_point_and_alignment_to_pivot():
    a, b = blob(box=(8, 8, 24, 28)), blob(box=(4, 2, 20, 22))
    assert foot_point(a)[1] == 28  # PIL rectangles are inclusive
    out, rep = align_frames([a, b], mode="foot", padding=2)
    assert out[0].size == out[1].size == tuple(rep["canvas"])
    px, py = rep["pivot"]
    for im in out:
        bb = alpha_bbox(im)
        assert bb[3] == py  # ground row sits exactly on the pivot
    # the same pivot column too (both blobs are 16px wide so centroid → pivot x)
    assert alpha_bbox(out[0])[0] == alpha_bbox(out[1])[0]


def test_anchor_mode_preserves_internal_motion():
    a, b = blob(box=(8, 8, 24, 28)), blob(box=(8, 4, 24, 24))  # second frame bobs up 4px
    out, _ = align_frames([a, b], mode="anchor")
    assert alpha_bbox(out[0])[3] - alpha_bbox(out[1])[3] == 4


def test_align_rejects_empty_frames():
    with pytest.raises(IsoAnimError):
        align_frames([blob(), Image.new("RGBA", (32, 32))])


def test_align_given_canvas_clips_instead_of_crashing():
    out, rep = align_frames([blob()], canvas=(10, 10), pivot=(5, 9), mode="foot")
    assert out[0].size == (10, 10)


def test_pack_grid_requires_same_size_and_exports_phaser_format(tmp_path):
    frames = {"idle/S/0": blob(), "idle/S/1": blob()}
    sheet, atlas = pack_grid(frames, columns=2)
    assert sheet.size == (64, 32)
    e = atlas["frames"][1]
    assert e["filename"] == "idle/S/1" and e["frame"] == {"x": 32, "y": 0, "w": 32, "h": 32} and e["rotated"] is False
    with pytest.raises(IsoAnimError):
        pack_grid({"a": blob(), "b": blob((16, 16))})
    with pytest.raises(IsoAnimError):
        pack_grid({})
    write_atlas(frames, tmp_path / "a.png", tmp_path / "a.json")
    assert json.loads((tmp_path / "a.json").read_text())["meta"]["image"] == "a.png"


def test_atlas_padding_adds_gutters():
    sheet, atlas = pack_grid({"a": blob(), "b": blob()}, columns=2, padding=2)
    assert atlas["frames"][0]["frame"]["x"] == 2 and atlas["frames"][1]["frame"]["x"] == 36
