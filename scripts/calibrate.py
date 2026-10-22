"""Measure how well the reviewer's decisions agree with human decisions, from a history file.

    py scripts/calibrate.py history.json [--min-n 30] [--json report.json] [--seed 7] [--sources a,b]

The history is a JSON array; each entry records what the AI decided and what a person decided:
    {"id": "pr-12-1", "rule_id": "missing-tests", "category": "missing_tests",
     "ai_decision": "block", "human_decision": "warn", "labeler": "ana", "date": "2026-10-21"}
Decisions are "block", "warn" or "pass". Every false positive and false negative is simply a row where the
two disagree, so adding rows is how the dataset grows.

Beware of sampling bias: if rows are added only when the AI and the person disagreed (source "override"), the
agreement computed from them is far lower than the real one. Rates must be estimated from rows that were NOT
selected by disagreement (for example a random audit sample, source "audit_sample"); error-driven rows are for
regression checks. Use --sources to choose which rows count.

For each rule and category the script reports n, agreement, Cohen's kappa with a bootstrap interval,
precision and recall of "block", and then applies the thresholds of design/calibracion.md (section "Política de calibración"):
  - fewer than --min-n rows: "insufficient data", and no suggestion is made, however good or bad it looks
  - false-positive rate of "block" at or above 20 %: suggest demoting the rule to "warn"
  - kappa >= 0.70, precision >= 0.90 and interval lower bound >= 0.60: eligible for the blocking list

The thresholds are proposals, not standards. Exit code: 0 on success, 2 on usage errors or an invalid history.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

DECISIONS = ["block", "warn", "pass"]
REQUIRED = ["id", "rule_id", "category", "ai_decision", "human_decision"]

THRESHOLDS = {"kappa": 0.70, "precision": 0.90, "ci_lower": 0.60, "demote_fp_rate": 0.20}
BOOTSTRAP_RESAMPLES = 1000

Pair = tuple[str, str]


def validate_history(entries: object) -> list[str]:
    if not isinstance(entries, list):
        return ["the history must be a JSON array"]
    errors: list[str] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        at = f"entry {index}"
        if not isinstance(entry, dict):
            errors.append(f"{at} must be an object")
            continue
        for key in REQUIRED:
            if key not in entry:
                errors.append(f'{at}: missing required field "{key}"')
        for key in ("ai_decision", "human_decision"):
            if key in entry and entry[key] not in DECISIONS:
                errors.append(f'{at}: "{key}" must be one of {", ".join(DECISIONS)} (got {json.dumps(entry[key])})')
        for key in ("id", "rule_id", "category"):
            if key in entry and not (isinstance(entry[key], str) and entry[key].strip()):
                errors.append(f'{at}: "{key}" must be a non-empty string')
        identifier = entry.get("id")
        if isinstance(identifier, str):
            if identifier in seen:
                errors.append(f'{at}: duplicate id "{identifier}"')
            seen.add(identifier)
    return errors


def cohen_kappa(pairs: list[Pair], labels: list[str]) -> float | None:
    """Agreement corrected for chance. None when it is undefined (no rows, or chance agreement is 1)."""
    n = len(pairs)
    if n == 0:
        return None
    observed = sum(1 for a, b in pairs if a == b) / n
    expected = sum((sum(1 for a, _ in pairs if a == label) / n) * (sum(1 for _, b in pairs if b == label) / n) for label in labels)
    if expected == 1:
        return None
    return (observed - expected) / (1 - expected)


def bootstrap_interval(pairs: list[Pair], labels: list[str], seed: int, resamples: int = BOOTSTRAP_RESAMPLES) -> tuple[float, float] | None:
    """95 % percentile interval for kappa. Seeded, so the same input always gives the same interval."""
    if len(pairs) < 2:
        return None
    rng = random.Random(seed)
    values = []
    for _ in range(resamples):
        sample = [pairs[rng.randrange(len(pairs))] for _ in pairs]
        kappa = cohen_kappa(sample, labels)
        if kappa is not None:
            values.append(kappa)
    if len(values) < resamples // 2:
        return None
    values.sort()
    return values[int(0.025 * (len(values) - 1))], values[int(0.975 * (len(values) - 1))]


def block_metrics(pairs: list[Pair]) -> dict:
    """"block" against "not block": the decision that actually stops a merge."""
    tp = sum(1 for ai, human in pairs if ai == "block" and human == "block")
    fp = sum(1 for ai, human in pairs if ai == "block" and human != "block")
    fn = sum(1 for ai, human in pairs if ai != "block" and human == "block")
    tn = sum(1 for ai, human in pairs if ai != "block" and human != "block")
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "fp_rate": fp / (tp + fp) if tp + fp else None,
    }


def to_binary(pairs: list[Pair]) -> list[Pair]:
    return [("block" if a == "block" else "not_block", "block" if b == "block" else "not_block") for a, b in pairs]


def assess(pairs: list[Pair], min_n: int, seed: int) -> dict:
    n = len(pairs)
    binary = to_binary(pairs)
    metrics = block_metrics(pairs)
    kappa_binary = cohen_kappa(binary, ["block", "not_block"])
    interval = bootstrap_interval(binary, ["block", "not_block"], seed)
    result = {
        "n": n,
        "agreement": sum(1 for a, b in pairs if a == b) / n if n else None,
        "kappa_3class": cohen_kappa(pairs, DECISIONS),
        "kappa_block": kappa_binary,
        "kappa_block_ci": interval,
        **metrics,
        "status": "insufficient_data",
        "suggestion": None,
    }
    if n < min_n:
        result["suggestion"] = f"insufficient data: {n} row(s), at least {min_n} are needed before any suggestion"
        return result

    result["status"] = "assessed"
    if metrics["fp_rate"] is not None and metrics["fp_rate"] >= THRESHOLDS["demote_fp_rate"]:
        result["status"] = "demote"
        result["suggestion"] = (
            f"demote to warn: {metrics['fp']} of {metrics['tp'] + metrics['fp']} blocks "
            f"({metrics['fp_rate']:.0%}) were not blocks for the human"
        )
    elif (
        kappa_binary is not None
        and interval is not None
        and kappa_binary >= THRESHOLDS["kappa"]
        and metrics["precision"] is not None
        and metrics["precision"] >= THRESHOLDS["precision"]
        and interval[0] >= THRESHOLDS["ci_lower"]
    ):
        result["status"] = "eligible_to_block"
        result["suggestion"] = "eligible for the blocking list (a person decides)"
    return result


def analyze(entries: list[dict], min_n: int = 30, seed: int = 7, sources: set[str] | None = None) -> dict:
    if sources is not None:
        entries = [e for e in entries if e.get("source") in sources]

    def pairs_of(rows: list[dict]) -> list[Pair]:
        return [(row["ai_decision"], row["human_decision"]) for row in rows]

    overall = assess(pairs_of(entries), min_n, seed)
    if overall["status"] in {"demote", "eligible_to_block"}:
        # Suggestions are about one rule at a time; the whole history is context, not a rule.
        overall["status"], overall["suggestion"] = "assessed", None
    report = {"min_n": min_n, "sources": sorted(sources) if sources else None, "thresholds": THRESHOLDS, "overall": overall, "by_rule": {}, "by_category": {}}
    for field, bucket in (("rule_id", "by_rule"), ("category", "by_category")):
        for value in sorted({entry[field] for entry in entries}):
            report[bucket][value] = assess(pairs_of([e for e in entries if e[field] == value]), min_n, seed)
    return report


def _fmt(value: float | None, percent: bool = False) -> str:
    if value is None:
        return "n/a"
    return f"{value:.0%}" if percent else f"{value:.2f}"


def render(report: dict) -> str:
    lines = [f"min n = {report['min_n']}, sources = {', '.join(report['sources']) if report['sources'] else 'all rows'}", "", "| Group | n | Agreement | Kappa (block) | 95% interval | Precision | Recall | Status |", "|---|---|---|---|---|---|---|---|"]
    rows = [("overall", report["overall"])] + [(f"rule: {k}", v) for k, v in report["by_rule"].items()] + [(f"category: {k}", v) for k, v in report["by_category"].items()]
    for name, item in rows:
        interval = item["kappa_block_ci"]
        interval_text = f"{interval[0]:.2f} to {interval[1]:.2f}" if interval else "n/a"
        lines.append(
            f"| {name} | {item['n']} | {_fmt(item['agreement'], True)} | {_fmt(item['kappa_block'])} | {interval_text} | "
            f"{_fmt(item['precision'], True)} | {_fmt(item['recall'], True)} | {item['status']} |"
        )
    suggestions = [(name, item["suggestion"]) for name, item in rows if item["suggestion"] and name != "overall"]
    if suggestions:
        lines += ["", "Suggestions:"] + [f"- {name}: {text}" for name, text in suggestions]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv[1:]
    options = {"--min-n": "30", "--json": None, "--seed": "7", "--sources": ""}
    try:
        for name in options:
            if name in args:
                i = args.index(name)
                options[name] = args[i + 1]
                del args[i : i + 2]
        min_n, seed = int(options["--min-n"]), int(options["--seed"])
    except (IndexError, ValueError):
        args = []
    if len(args) != 1:
        print("usage: calibrate.py history.json [--min-n N] [--json report.json] [--seed N] [--sources a,b]", file=sys.stderr)
        return 2

    try:
        entries = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        print(f"the history is not valid JSON: {error}", file=sys.stderr)
        return 2
    errors = validate_history(entries)
    if errors:
        print("The history is not valid:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 2

    chosen = {name for name in options["--sources"].split(",") if name} or None
    present = {e.get("source") for e in entries}
    if chosen is None and "override" in present and len(present) > 1:
        print("WARNING: the history mixes error-driven rows (override) with other sources; rates computed from all rows are biased. Use --sources.", file=sys.stderr)
    report = analyze(entries, min_n, seed, chosen)
    if options["--json"]:
        Path(options["--json"]).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
