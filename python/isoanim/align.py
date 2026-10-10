"""Frame alignment: put frames on a common canvas with a stable pivot."""
from __future__ import annotations

from PIL import Image

from .common import IsoAnimError


def alpha_bbox(img: Image.Image, threshold: int = 8) -> tuple[int, int, int, int] | None:
    return img.getchannel("A").point(lambda v: 255 if v > threshold else 0).getbbox()


def foot_point(img: Image.Image, threshold: int = 8, band: int = 3) -> tuple[float, int] | None:
    """Estimate ground contact: x centroid of the lowest `band` opaque rows and the lowest row."""
    bb = alpha_bbox(img, threshold)
    if not bb:
        return None
    a = img.getchannel("A").load()
    bottom = bb[3] - 1
    xs = [x for y in range(max(bb[1], bottom - band + 1), bottom + 1) for x in range(bb[0], bb[2]) if a[x, y] > threshold]
    return (sum(xs) / len(xs), bottom) if xs else None


def _anchors(frames: list[Image.Image], boxes: list, mode: str, threshold: int, smooth_x: bool) -> list[tuple[float, float]]:
    anchors: list[tuple[float, float]] = []
    for f, bb in zip(frames, boxes):
        if mode == "foot":
            fp = foot_point(f, threshold)
            anchors.append((fp[0], fp[1] + 1))  # type: ignore[index]
        elif mode == "bottom-center":
            anchors.append(((bb[0] + bb[2]) / 2, bb[3]))
        elif mode == "anchor":
            b0 = boxes[0]
            anchors.append(((b0[0] + b0[2]) / 2, b0[3]))
        else:
            raise IsoAnimError(f"unknown alignment mode {mode!r}")
    if smooth_x and mode == "foot":
        xs = [a[0] for a in anchors]
        sm = [sum(xs[max(0, i - 1): i + 2]) / len(xs[max(0, i - 1): i + 2]) for i in range(len(xs))]
        anchors = [(sm[i], anchors[i][1]) for i in range(len(anchors))]
    return anchors


def align_many(seqs: dict[str, list[Image.Image]], canvas: tuple[int, int] | None = None, pivot: tuple[int, int] | None = None,
               mode: str = "anchor", threshold: int = 8, padding: int = 4, smooth_x: bool = False) -> tuple[dict[str, list[Image.Image]], dict]:
    """Align several sequences onto ONE shared canvas and pivot.

    mode='none'          : keep every frame where it is (top-left), only pad to the shared canvas
    mode='foot'          : each frame's ground point (lowest opaque rows) lands on the pivot
                           (removes vertical motion, so don't use for jumps/attacks that lift the body)
    mode='bottom-center' : each frame's bbox bottom-centre lands on the pivot
    mode='anchor'        : the FIRST frame of each sequence defines one shift for the whole sequence,
                           so genuine motion inside the sequence (bobbing, lunging) is preserved
    """
    if not seqs or any(not v for v in seqs.values()):
        raise IsoAnimError("no frames to align")
    boxes: dict[str, list] = {}
    for k, fr in seqs.items():
        bx = [alpha_bbox(f, threshold) for f in fr]
        empties = [i for i, b in enumerate(bx) if b is None]
        if empties:
            raise IsoAnimError(f"{k}: frames {empties} are fully transparent; cannot align")
        boxes[k] = bx

    if mode == "none":
        size = canvas or (max(f.width for fr in seqs.values() for f in fr), max(f.height for fr in seqs.values() for f in fr))
        out = {k: [_place(f, size, (0, 0)) for f in fr] for k, fr in seqs.items()}
        return out, {"canvas": list(size), "pivot": list(pivot) if pivot else None, "mode": mode, "maxShift": 0, "shifts": {}}

    anchors = {k: _anchors(fr, boxes[k], mode, threshold, smooth_x) for k, fr in seqs.items()}
    if canvas is None or pivot is None:
        pairs = [(a, b) for k in seqs for a, b in zip(anchors[k], boxes[k])]
        left = max(a[0] - b[0] for a, b in pairs)
        right = max(b[2] - a[0] for a, b in pairs)
        up = max(a[1] - b[1] for a, b in pairs)
        down = max(b[3] - a[1] for a, b in pairs)
        pivot = (int(round(left)) + padding, int(round(up)) + padding)
        canvas = (pivot[0] + int(round(right)) + padding, pivot[1] + int(round(down)) + padding)

    out, shifts, maxshift = {}, {}, 0
    for k, fr in seqs.items():
        placed, sh = [], []
        for f, a in zip(fr, anchors[k]):
            dx, dy = round(pivot[0] - a[0]), round(pivot[1] - a[1])
            placed.append(_place(f, canvas, (dx, dy)))
            sh.append((dx, dy))
            maxshift = max(maxshift, abs(dx), abs(dy))
        out[k], shifts[k] = placed, sh
    return out, {"canvas": list(canvas), "pivot": list(pivot), "mode": mode, "maxShift": maxshift, "shifts": {k: [list(s) for s in v] for k, v in shifts.items()}}


def align_frames(frames: list[Image.Image], **kw) -> tuple[list[Image.Image], dict]:
    """Single-sequence convenience wrapper around align_many."""
    out, rep = align_many({"seq": frames}, **kw)
    return out["seq"], rep


def _place(img: Image.Image, canvas: tuple[int, int], offset: tuple[int, int]) -> Image.Image:
    """Composite `img` at `offset` on a transparent canvas, clipping anything outside."""
    c = Image.new("RGBA", canvas, (0, 0, 0, 0))
    img = img.convert("RGBA")
    dx, dy = offset
    sx, sy = max(0, -dx), max(0, -dy)
    ex, ey = min(img.width, canvas[0] - dx), min(img.height, canvas[1] - dy)
    if ex <= sx or ey <= sy:
        return c
    c.alpha_composite(img.crop((sx, sy, ex, ey)), (max(0, dx), max(0, dy)))
    return c
