#!/usr/bin/env python3
"""Run the isoanim CLI without installing the package: python scripts/isoanim.py <command> ..."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
from isoanim.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
