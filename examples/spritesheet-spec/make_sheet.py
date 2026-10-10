#!/usr/bin/env python3
"""Writes a synthetic magenta-background spritesheet (2 directions x 6 frames) for the process example."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "sheet.png")
im = Image.new("RGBA", (48 * 6, 48 * 2), (255, 0, 255, 255))
d = ImageDraw.Draw(im)
for row in range(2):
    for c in range(6):
        x, y = c * 48, row * 48
        bob = 2 if c % 2 else 0
        d.rounded_rectangle((x + 14, y + 8 + bob, x + 34, y + 40), 5, fill=(70, 130, 190, 255), outline=(20, 20, 40, 255))
        d.rectangle((x + 22, y + 16 + bob, x + 25, y + 19 + bob), fill=(255, 0, 255, 255))  # magenta gem: part of the art, must survive
        swing = (-4, 0, 4, 0, -4, 0)[c] * (1 if row == 0 else -1)
        d.rectangle((x + 16 + swing, y + 40, x + 21 + swing, y + 46), fill=(40, 40, 70, 255))
        d.rectangle((x + 27 - swing, y + 40, x + 32 - swing, y + 46), fill=(40, 40, 70, 255))
im.save(out)
print("wrote", out)
