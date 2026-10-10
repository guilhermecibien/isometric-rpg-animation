"""Markdown / JSON report writers."""
from __future__ import annotations

from pathlib import Path

from .common import write_json
from .validate import Report


def to_markdown(rep: Report, previews: list[str] | None = None, integration: str | None = None) -> str:
    d = rep.to_dict()
    s = d["summary"]
    lines = [f"# Validation report: {rep.character}", "",
             f"**Result:** {'PASS' if s['ok'] else 'FAIL'}: {s['errors']} error(s), {s['warnings']} warning(s); {s['checksPassed']}/{s['checksRun']} checks clean.", "",
             f"> {d['disclaimer']}", "", "## Checks", "", "| Check | Kind | Status |", "|---|---|---|"]
    for c in d["checks"]:
        lines.append(f"| `{c['id']}`: {c['description']} | {c['kind']} | {'✅ passed' if c['passed'] else '❌ ' + str(c['problems']) + ' problem(s)'} |")
    problems = [f for f in rep.findings if f.severity in ("error", "warning")]
    lines += ["", "## Problems found", ""]
    lines += [f"- **{f.severity.upper()}** `{f.id}` {('(' + f.where + ') ') if f.where else ''}{f.message}" for f in problems] or ["None."]
    lines += ["", "## Automatic corrections applied", ""] + ([f"- {c}" for c in rep.corrections] or ["None."])
    pending = [f for f in rep.findings if f.severity != "info" or f.kind == "heuristic"]
    lines += ["", "## Pending / needs human review", ""]
    lines += [f"- ({f.kind}) {f.message}" for f in pending if f.severity in ("warning", "info")] or ["None."]
    lines += ["", "## Previews", ""] + ([f"- ![{p}]({p})" for p in (previews or [])] or ["No previews generated (run `isoanim preview`)."])
    lines += ["", "## Integration status", "", integration or "Not evaluated by this command (see the project diagnosis from the skill workflow).", ""]
    return "\n".join(lines)


def write_reports(rep: Report, out_dir: str | Path, previews: list[str] | None = None, integration: str | None = None) -> tuple[Path, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    j, md = out / "validation-report.json", out / "validation-report.md"
    write_json(j, rep.to_dict())
    md.write_text(to_markdown(rep, previews, integration), encoding="utf-8")
    return j, md
