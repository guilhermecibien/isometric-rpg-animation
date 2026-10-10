"""Local image analysis → the `analysis` block of character-manifest.json.

This is metadata and pixel statistics only. Nothing here understands what the character
IS (hair, weapon, species); those fields are listed under `needsInput` so a vision model
or a human must fill them in. The tool never claims otherwise.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from .align import alpha_bbox, foot_point
from .common import IsoAnimError
from .spritesheet import detect_background, open_rgba


def dominant_colors(img: Image.Image, n: int = 6, alpha_threshold: int = 128) -> list[dict]:
    rgba = img.convert("RGBA")
    solid = Image.new("RGB", rgba.size, (0, 0, 0))
    mask = rgba.getchannel("A").point(lambda v: 255 if v >= alpha_threshold else 0)
    solid.paste(rgba.convert("RGB"), mask=mask)
    q = solid.quantize(colors=min(32, max(n * 3, 8)), method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts: dict[int, int] = {}
    mpx, qpx = mask.load(), q.load()
    total = 0
    for y in range(q.height):
        for x in range(q.width):
            if mpx[x, y]:
                counts[qpx[x, y]] = counts.get(qpx[x, y], 0) + 1
                total += 1
    out = []
    for idx, c in sorted(counts.items(), key=lambda t: -t[1])[:n]:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        out.append({"hex": f"#{r:02x}{g:02x}{b:02x}", "share": round(c / max(1, total), 4)})
    return out


def horizontal_symmetry(img: Image.Image, bbox) -> float:
    """1.0 = silhouette mirrors perfectly about its own vertical axis (a hint for front/back views)."""
    a = img.getchannel("A").crop(bbox).point(lambda v: 255 if v > 8 else 0)
    m = a.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    pa, pm = a.load(), m.load()
    inter = union = 0
    for y in range(a.height):
        for x in range(a.width):
            i, j = pa[x, y] > 0, pm[x, y] > 0
            inter += i and j
            union += i or j
    return round(inter / union, 4) if union else 0.0


def analyze_image(path: str | Path) -> dict:
    img = open_rgba(path)
    bb = alpha_bbox(img)
    bg = detect_background(img)
    res: dict = {
        "file": str(path),
        "imageSize": {"width": img.width, "height": img.height},
        "hasTransparency": img.getchannel("A").getextrema()[0] < 255,
        "background": bg,
    }
    if bb is None:
        res["warning"] = "image is fully transparent"
        return res
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    fp = foot_point(img)
    res.update({
        "silhouette": {
            "bbox": {"x": bb[0], "y": bb[1], "width": w, "height": h},
            "aspect": round(w / h, 4),
            "fillRatio": round(sum(img.getchannel("A").crop(bb).histogram()[9:]) / (w * h), 4),
            "symmetry": horizontal_symmetry(img, bb),
        },
        "groundContact": {"x": round(fp[0], 2), "y": fp[1] + 1} if fp else None,
        "suggestedPivot": {"x": round(fp[0], 2), "y": fp[1] + 1} if fp else None,
        "dominantColors": dominant_colors(img),
    })
    return res


def analyze_references(paths: list[str], character_id: str = "character") -> dict:
    if not paths:
        raise IsoAnimError("at least one reference image is required")
    images = [analyze_image(p) for p in paths]
    heights = [i["silhouette"]["bbox"]["height"] for i in images if "silhouette" in i]
    return {
        "analyzedBy": "local-metadata",
        "semanticAnalysis": False,
        "images": images,
        "proportions": {"silhouetteHeightsPx": heights, "heightRatioMaxMin": round(max(heights) / min(heights), 3) if heights and min(heights) else None},
        "invariants": [
            "pivot/ground point must stay on the same pixel in every frame",
            "silhouette height must not drift more than the validation tolerance between frames",
            "dominant palette must not change between frames",
        ],
        "needsInput": [
            "hair / clothing / accessories description",
            "weapons, shields and equipment (and which hand)",
            "limb and joint positions (needs a vision model or a human)",
            "which direction the reference faces",
            "style notes (outline weight, shading)",
        ],
    }
