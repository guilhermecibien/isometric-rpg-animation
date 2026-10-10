#!/usr/bin/env python3
"""Writes simple placeholder part images (body, head, legs, arm) so the rig example is runnable.

Replace them with real cut-outs from your character art: same file names, same pivots in rig.json.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "parts")
out.mkdir(parents=True, exist_ok=True)


def part(name, size, draw):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    draw(ImageDraw.Draw(im), size)
    im.save(out / f"{name}.png")


part("body", (24, 32), lambda d, s: d.rounded_rectangle((1, 1, s[0] - 2, s[1] - 2), 6, fill=(60, 140, 160, 255), outline=(30, 30, 50, 255)))
part("head", (24, 24), lambda d, s: d.ellipse((1, 1, s[0] - 2, s[1] - 2), fill=(240, 196, 160, 255), outline=(30, 30, 50, 255)))
part("leg", (10, 30), lambda d, s: d.rounded_rectangle((1, 1, s[0] - 2, s[1] - 2), 4, fill=(60, 64, 120, 255), outline=(30, 30, 50, 255)))
part("arm", (8, 24), lambda d, s: d.rounded_rectangle((1, 1, s[0] - 2, s[1] - 2), 3, fill=(46, 110, 130, 255), outline=(30, 30, 50, 255)))
print("wrote parts to", out)
