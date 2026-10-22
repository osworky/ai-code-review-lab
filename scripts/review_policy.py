"""Turn a validated reviewer JSON into a decision for the current rollout phase.

    py scripts/review_policy.py review.json --phase advisory [--blocking-rules a,b] [--max 10]
                                [--comment comment.md] [--decision decision.json]

The model's verdict is a signal, not an authority: what happens to each finding depends on the phase
and on an explicit list of rules allowed to block, both set by people from measured agreement. No model
is involved here, so the same input always produces the same decision.

Phases (see design/revisor-en-ci.md, section "Escalado de shadow a bloqueante"):
  shadow    everything is recorded; nothing is shown and nothing blocks
  advisory  findings are shown in a comment; nothing blocks, but "would_block" is recorded for calibration
  partial   only blocker findings whose rule_id is in --blocking-rules block
  extended  every blocker finding blocks

Exit code: 0 = the pull request may merge, 1 = it is blocked, 2 = usage error or invalid review.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_review import validate_review  # noqa: E402

PHASES = ["shadow", "advisory", "partial", "extended"]
SEVERITY_RANK = {"blocker": 0, "advisory": 1, "info": 2}
SEVERITY_LABEL = {"blocker": "Bloqueante", "advisory": "Advertencia", "info": "Info"}


@dataclass(frozen=True)
class Finding:
    rule_id: str
    category: str
    severity: str
    file: str
    line: int
    message: str
    suggested_fix: str

    @staticmethod
    def from_json(raw: dict) -> "Finding":
        return Finding(
            raw["rule_id"],
            raw["category"],
            raw["severity"],
            raw["location"]["file"],
            raw["location"]["line"],
            raw["message"],
            raw["suggested_fix"],
        )


def consolidate(findings: list[Finding]) -> list[Finding]:
    """Drop duplicates (same file, line and rule) keeping the most severe, and sort by severity."""
    best: dict[tuple[str, int, str], Finding] = {}
    for finding in findings:
        key = (finding.file, finding.line, finding.rule_id)
        if key not in best or SEVERITY_RANK[finding.severity] < SEVERITY_RANK[best[key].severity]:
            best[key] = finding
    return sorted(best.values(), key=lambda f: (SEVERITY_RANK[f.severity], f.file, f.line, f.rule_id))


def action_for(finding: Finding, phase: str, blocking_rules: set[str]) -> str:
    """report | comment | block"""
    if phase == "shadow":
        return "report"
    if finding.severity == "info":
        return "report"
    if finding.severity == "advisory":
        return "comment"
    # blocker
    if phase == "extended":
        return "block"
    if phase == "partial" and finding.rule_id in blocking_rules:
        return "block"
    return "comment"


def decide(findings: list[Finding], phase: str, blocking_rules: set[str] | None = None, max_visible: int = 10) -> dict:
    if phase not in PHASES:
        raise ValueError(f"phase must be one of {', '.join(PHASES)}")
    rules = blocking_rules or set()
    consolidated = consolidate(findings)
    actions = [(finding, action_for(finding, phase, rules)) for finding in consolidated]

    # Findings that block are never hidden by the cap; the cap only trims what is merely commented.
    blocks = [(f, a) for f, a in actions if a == "block"]
    comments = [(f, a) for f, a in actions if a == "comment"]
    room = max(max_visible - len(blocks), 0)
    visible = blocks + comments[:room]
    visible.sort(key=lambda item: (SEVERITY_RANK[item[0].severity], item[0].file, item[0].line, item[0].rule_id))
    suppressed = len(comments) - min(len(comments), room)

    return {
        "phase": phase,
        "verdict": "block" if blocks else "pass",
        # The signal the model would have given on its own; compared with human decisions to calibrate.
        "would_block": any(f.severity == "blocker" for f in consolidated),
        "blocking_findings": [{"rule_id": f.rule_id, "file": f.file, "line": f.line} for f, _ in blocks],
        "visible": len(visible),
        "suppressed": suppressed,
        "duplicates_removed": len(findings) - len(consolidated),
        "actions": [
            {"rule_id": f.rule_id, "file": f.file, "line": f.line, "severity": f.severity, "action": a}
            for f, a in actions
        ],
        "_visible_findings": visible,
    }


def sanitize(text: str) -> str:
    """The text comes from a model reading untrusted code: neutralise mentions, HTML and links."""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"@(?=\w)", "@​", text)  # no pings
    text = re.sub(r"\]\(", "]​(", text)  # no markdown links
    return " ".join(text.split())


def render_comment(decision: dict) -> str | None:
    """Prose for humans, built from the JSON by code. Shadow phase shows nothing."""
    if decision["phase"] == "shadow":
        return None
    visible: list[tuple[Finding, str]] = decision["_visible_findings"]
    action_by_key = {(a["file"], a["line"], a["rule_id"]): a["action"] for a in decision["actions"]}

    heading = {
        "advisory": "Revisión automática (consultiva: no bloquea el merge)",
        "partial": "Revisión automática (bloqueo parcial)",
        "extended": "Revisión automática (bloqueo ampliado)",
    }[decision["phase"]]
    lines = [f"### {heading}", ""]

    if decision["verdict"] == "block":
        lines.append(f"**Este PR está bloqueado por {len(decision['blocking_findings'])} hallazgo(s).**")
    elif decision["would_block"]:
        lines.append("El revisor recomendaría bloquear este PR. **No bloquea**: su veredicto es una señal que se compara con la decisión humana.")
    elif not visible:
        lines.append("Sin hallazgos.")
    lines.append("")

    for finding, _ in visible:
        marker = "bloquea" if action_by_key[(finding.file, finding.line, finding.rule_id)] == "block" else "no bloquea"
        lines.append(f"- **{SEVERITY_LABEL[finding.severity]}** ({marker}) `{finding.file}:{finding.line}` · `{finding.rule_id}` · {finding.category}")
        lines.append(f"  - {sanitize(finding.message)}")
        lines.append(f"  - Sugerencia: {sanitize(finding.suggested_fix)}")

    if decision["suppressed"]:
        lines.append("")
        lines.append(f"_Se omitieron {decision['suppressed']} hallazgo(s) de menor prioridad por el tope de comentarios._")
    return "\n".join(lines).rstrip() + "\n"


def public_decision(decision: dict) -> dict:
    return {key: value for key, value in decision.items() if not key.startswith("_")}


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv[1:]
    options = {"--phase": None, "--blocking-rules": "", "--max": "10", "--comment": None, "--decision": None}
    try:
        for name in options:
            if name in args:
                i = args.index(name)
                options[name] = args[i + 1]
                del args[i : i + 2]
        max_visible = int(options["--max"])
    except (IndexError, ValueError):
        args = []
    if len(args) != 1 or options["--phase"] not in PHASES:
        print(f"usage: review_policy.py review.json --phase {'|'.join(PHASES)} [--blocking-rules a,b] [--max N] [--comment f] [--decision f]", file=sys.stderr)
        return 2

    ok, errors, review = validate_review(Path(args[0]).read_text(encoding="utf-8"))
    if not ok:
        print("The review is not valid; the policy is not applied:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 2

    rules = {rule for rule in options["--blocking-rules"].split(",") if rule}
    decision = decide([Finding.from_json(f) for f in review["findings"]], options["--phase"], rules, max_visible)

    comment = render_comment(decision)
    if options["--comment"] and comment is not None:
        Path(options["--comment"]).write_text(comment, encoding="utf-8")
    if options["--decision"]:
        Path(options["--decision"]).write_text(json.dumps(public_decision(decision), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"phase={decision['phase']} verdict={decision['verdict']} would_block={decision['would_block']} visible={decision['visible']} suppressed={decision['suppressed']}")
    return 1 if decision["verdict"] == "block" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
