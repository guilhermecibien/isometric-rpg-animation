#!/usr/bin/env python3
"""Validate and safely split AI sprite strips using their transparent gutters."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def transparent_columns(image: Image.Image, threshold: int) -> list[bool]:
    alpha = image.convert("RGBA").getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    return [all(pixels[x, y] <= threshold for y in range(height)) for x in range(width)]


def longest_run(flags: list[bool], start: int, end: int) -> tuple[int, int]:
    best_start = best_end = run_start = -1
    for index in range(start, end):
        if flags[index]:
            if run_start < 0:
                run_start = index
        elif run_start >= 0:
            if index - run_start > best_end - best_start:
                best_start, best_end = run_start, index
            run_start = -1
    if run_start >= 0 and end - run_start > best_end - best_start:
        best_start, best_end = run_start, end
    return best_start, best_end


def find_gutters(flags: list[bool], width: int, cols: int, search_px: int, min_gutter: int) -> tuple[list[tuple[int, int]], list[tuple[int, int, int]]]:
    gutters, failures = [], []
    for boundary_number in range(1, cols):
        expected = round(width * boundary_number / cols)
        start = max(0, expected - search_px)
        end = min(width, expected + search_px + 1)
        gutter_start, gutter_end = longest_run(flags, start, end)
        gutter_width = max(0, gutter_end - gutter_start)
        if gutter_width < min_gutter:
            failures.append((boundary_number, expected, gutter_width))
        else:
            gutters.append((gutter_start, gutter_end))
            print(f"boundary {boundary_number}/{cols}: gutter {gutter_width}px at x={gutter_start}..{gutter_end - 1}")
    return gutters, failures


def split_at_gutters(image: Image.Image, gutters: list[tuple[int, int]], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    edges = [0] + [end for _, end in gutters]
    ends = [start for start, _ in gutters] + [image.width]
    for index, (left, right) in enumerate(zip(edges, ends)):
        image.crop((left, 0, right, image.height)).save(out_dir / f"{index}.png")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--cols", type=int, required=True)
    parser.add_argument("--min-gutter", type=int, default=24)
    parser.add_argument("--search-px", type=int, default=48)
    parser.add_argument("--alpha-threshold", type=int, default=8)
    parser.add_argument("--out-dir", help="Write gutter-separated frames as 0.png, 1.png, ... after a successful check")
    args = parser.parse_args()
    if args.cols < 2 or args.min_gutter < 1 or args.search_px < 0:
        parser.error("--cols must be at least 2; --min-gutter at least 1; --search-px non-negative")

    image = Image.open(Path(args.sheet)).convert("RGBA")
    flags = transparent_columns(image, args.alpha_threshold)
    width = image.width
    gutters, failures = find_gutters(flags, width, args.cols, args.search_px, args.min_gutter)
    if failures:
        for number, expected, width_found in failures:
            print(f"FAIL boundary {number}/{args.cols} near x={expected}: transparent gutter {width_found}px, need {args.min_gutter}px")
        return 1
    print(f"PASS: {args.sheet} has safe transparent gutters for {args.cols} cells")
    if args.out_dir:
        split_at_gutters(image, gutters, Path(args.out_dir))
        print(f"wrote {args.cols} frames to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
