#!/usr/bin/env python3
"""Generate the procedural demo character. Usage: generate_procedural_character.py --out DIR [--id hero] [--validate]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
from isoanim.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(["generate-demo", *sys.argv[1:]]))
