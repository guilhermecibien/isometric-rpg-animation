"""Split spritesheets into frames, detect/remove uniform backgrounds."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from PIL import Image

from .common import IsoAnimError


def open_rgba(path: str | Path) -> Image.Image:
    try:
        return Image.open(path).convert("RGBA")
    except FileNotFoundError:
        raise IsoAnimError(f"image not found: {path}")
    except OSError as e:
        raise IsoAnimError(f"cannot read image {path}: {e}")


def split_grid(sheet: Image.Image, frame_w: int | None = None, frame_h: int | None = None, cols: int | None = None, rows: int | None = None,
               margin: int = 0, spacing: int = 0) -> list[Image.Image]:
    """Cut a regular grid. Give frame size OR cols/rows. Row-major order."""
    W, H = sheet.size
    if frame_w and frame_h:
        cols = cols or max(1, (W - 2 * margin + spacing) // (frame_w + spacing))
        rows = rows or max(1, (H - 2 * margin + spacing) // (frame_h + spacing))
    elif cols and rows:
        frame_w = (W - 2 * margin - (cols - 1) * spacing) // cols
        frame_h = (H - 2 * margin - (rows - 1) * spacing) // rows
    else:
        raise IsoAnimError("give --frame-size WxH or --cols and --rows")
    if frame_w <= 0 or frame_h <= 0:
        raise IsoAnimError("computed frame size is not positive; check margin/spacing")
    if margin + cols * frame_w + (cols - 1) * spacing > W or margin + rows * frame_h + (rows - 1) * spacing > H:
        raise IsoAnimError(f"grid {cols}x{rows} of {frame_w}x{frame_h} does not fit in {W}x{H}")
    out = []
    for r in range(rows):
        for c in range(cols):
            x = margin + c * (frame_w + spacing)
            y = margin + r * (frame_h + spacing)
            out.append(sheet.crop((x, y, x + frame_w, y + frame_h)))
    return out


def split_by_gaps(sheet: Image.Image, alpha_threshold: int = 8, min_gap: int = 1) -> list[Image.Image]:
    """Auto-detect frames separated by fully transparent columns/rows (single row sheets, packed sheets).

    Rows are detected first, then columns inside each row. Returns frames in reading order,
    each cropped to its tight bounding box (use `align` to put them on a common canvas).
    """
    a = sheet.getchannel("A").point(lambda v: 255 if v > alpha_threshold else 0)
    W, H = a.size
    px = a.load()
    row_has = [any(px[x, y] for x in range(W)) for y in range(H)]
    frames = []
    for y0, y1 in _runs(row_has, min_gap):
        col_has = [any(px[x, y] for y in range(y0, y1)) for x in range(W)]
        for x0, x1 in _runs(col_has, min_gap):
            box = sheet.crop((x0, y0, x1, y1))
            bb = box.getchannel("A").point(lambda v: 255 if v > alpha_threshold else 0).getbbox()
            frames.append(box.crop(bb) if bb else box)
    return frames


def _runs(flags: list[bool], min_gap: int) -> list[tuple[int, int]]:
    runs, start, gap = [], None, 0
    for i, f in enumerate(flags + [False] * (min_gap + 1)):
        if f:
            if start is None:
                start = i
            gap = 0
            end = i + 1
        else:
            if start is not None:
                gap += 1
                if gap >= min_gap:
                    runs.append((start, end))
                    start = None
    return runs


def detect_background(img: Image.Image, tolerance: int = 0) -> dict:
    """Report the likely uniform background colour from the border. Never modifies anything."""
    rgba = img.convert("RGBA")
    W, H = rgba.size
    px = rgba.load()
    border = [px[x, 0] for x in range(W)] + [px[x, H - 1] for x in range(W)] + [px[0, y] for y in range(H)] + [px[W - 1, y] for y in range(H)]
    c = Counter(border)
    color, count = c.most_common(1)[0]
    share = count / len(border)
    transparent = color[3] == 0
    return {
        "color": list(color[:3]) if not transparent else None,
        "alpha": color[3],
        "border_share": round(share, 4),
        "already_transparent": transparent,
        "uniform": share >= 0.9,
        "magenta_like": (not transparent) and color[0] > 200 and color[2] > 200 and color[1] < 80,
        "note": "border colour only; interior pixels with the same colour are NOT assumed to be background",
    }


def remove_background(img: Image.Image, color: tuple[int, int, int], tolerance: int = 0, contiguous: bool = True) -> tuple[Image.Image, dict]:
    """Make `color` transparent.

    contiguous=True (default) only removes pixels connected to the image border, so a
    same-coloured detail inside the character (e.g. magenta gems) is preserved.
    Returns (image, report) with counts so the result can be verified.
    """
    rgba = img.convert("RGBA")
    W, H = rgba.size
    px = rgba.load()

    def match(p) -> bool:
        return p[3] > 0 and all(abs(p[i] - color[i]) <= tolerance for i in range(3))

    removed = 0
    if contiguous:
        seen = bytearray(W * H)
        stack = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
        while stack:
            x, y = stack.pop()
            i = y * W + x
            if seen[i]:
                continue
            seen[i] = 1
            if not match(px[x, y]):
                continue
            px[x, y] = (px[x, y][0], px[x, y][1], px[x, y][2], 0)
            removed += 1
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx]:
                    stack.append((nx, ny))
    else:
        for y in range(H):
            for x in range(W):
                if match(px[x, y]):
                    px[x, y] = (px[x, y][0], px[x, y][1], px[x, y][2], 0)
                    removed += 1
    kept_same = sum(1 for y in range(H) for x in range(W) if match(px[x, y]))
    return rgba, {"removed_pixels": removed, "same_color_pixels_kept": kept_same, "total_pixels": W * H, "removed_share": round(removed / (W * H), 4), "contiguous": contiguous}
