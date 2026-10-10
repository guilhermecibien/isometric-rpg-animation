#!/usr/bin/env python3
"""Validate the skill package: SKILL.md frontmatter, referenced files, agents/openai.yaml, manifest schema usage.

Usage: validate_skill.py [skill_dir]      Exit: 0 ok · 1 problems found · 2 bad usage
"""
import json
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def frontmatter(text: str):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    data = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            data[k.strip()] = v.strip()
    return data


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else ".").resolve()
    skill = root / "SKILL.md"
    if not skill.exists():
        print(f"error: {skill} not found", file=sys.stderr)
        return 2
    problems = []
    text = skill.read_text(encoding="utf-8")
    fm = frontmatter(text)
    if fm is None:
        problems.append("SKILL.md has no YAML frontmatter")
        fm = {}
    name, desc = fm.get("name", ""), fm.get("description", "")
    if not NAME_RE.match(name):
        problems.append(f"frontmatter name {name!r} must be lowercase-hyphen")
    if not desc:
        problems.append("frontmatter description is missing")
    elif len(desc) > 1024:
        problems.append(f"description is {len(desc)} chars (max 1024)")
    if len(text.splitlines()) > 500:
        problems.append("SKILL.md exceeds 500 lines: move detail into references/")
    for rel in sorted(set(re.findall(r"`((?:references|scripts|schemas|examples|agents|assets)/[\w./-]+)`", text))):
        if not (root / rel.rstrip("/")).exists() and "<" not in rel:
            problems.append(f"SKILL.md references missing path {rel}")
    yml = root / "agents/openai.yaml"
    if yml.exists():
        y = yml.read_text(encoding="utf-8")
        for key in ("interface:", "display_name:", "short_description:", "default_prompt:"):
            if key not in y:
                problems.append(f"agents/openai.yaml lacks {key}")
        if f"${name}" not in y:
            problems.append(f"agents/openai.yaml default_prompt should mention ${name}")
    for ref in (root / "references").glob("*.md"):
        for rel in re.findall(r"`((?:src|python|scripts|schemas|examples)/[\w./-]+\.\w+)`", ref.read_text(encoding="utf-8")):
            if not (root / rel).exists():
                problems.append(f"{ref.name} references missing file {rel}")
    try:
        json.loads((root / "schemas/character-manifest.schema.json").read_text())
    except Exception as e:  # noqa: BLE001
        problems.append(f"schema invalid: {e}")
    for p in problems:
        print("FAIL", p)
    print("skill OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
