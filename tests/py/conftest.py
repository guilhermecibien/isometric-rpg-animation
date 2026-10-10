import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))


@pytest.fixture(scope="session")
def hero(tmp_path_factory):
    from isoanim.generate import generate_character
    out = tmp_path_factory.mktemp("hero")
    return generate_character(out, "hero", only=["idle", "walk", "run", "attack", "death"])
