"""Before changing the prompt or the model, check the candidate against the regression dataset.

    py scripts/regression_check.py --dataset dataset.json --baseline baseline.json --candidate candidate.json
                                   [--max-regressions 0]

dataset.json   [{"id": "case-1", "human_decision": "warn"}, ...]  what a person decided for each case
baseline.json  {"case-1": "warn", ...}                              what the current reviewer decides
candidate.json {"case-1": "block", ...}                             what the proposed reviewer decides

It reports, per case, whether the candidate is right where the baseline was wrong (fixed) and, above all,
wrong where the baseline was right (regression). The aim is that a change never breaks what already worked
and that a past mistake does not come back.

Exit code: 0 = no more regressions than allowed, 1 = too many regressions, 2 = usage error or inconsistent files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

DECISIONS = ["block", "warn", "pass"]


def load_dataset(raw: object) -> dict[str, str]:
    if not isinstance(raw, list):
        raise ValueError("the dataset must be a JSON array")
    dataset: dict[str, str] = {}
    for index, entry in enumerate(raw):
        if not (isinstance(entry, dict) and isinstance(entry.get("id"), str) and entry.get("human_decision") in DECISIONS):
            raise ValueError(f'dataset entry {index} needs a string "id" and a "human_decision" in {", ".join(DECISIONS)}')
        if entry["id"] in dataset:
            raise ValueError(f'duplicate id "{entry["id"]}" in the dataset')
        dataset[entry["id"]] = entry["human_decision"]
    return dataset


def load_decisions(raw: object, name: str, dataset: dict[str, str]) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError(f"{name} must be a JSON object of id to decision")
    for case_id, decision in raw.items():
        if decision not in DECISIONS:
            raise ValueError(f'{name}: "{case_id}" has the invalid decision {json.dumps(decision)}')
    missing = sorted(set(dataset) - set(raw))
    if missing:
        raise ValueError(f"{name} has no decision for: {', '.join(missing)}")
    unknown = sorted(set(raw) - set(dataset))
    if unknown:
        raise ValueError(f"{name} has decisions for cases that are not in the dataset: {', '.join(unknown)}")
    return raw


def compare(dataset: dict[str, str], baseline: dict[str, str], candidate: dict[str, str]) -> dict:
    regressions, fixed, still_wrong = [], [], []
    for case_id, human in dataset.items():
        was_right, is_right = baseline[case_id] == human, candidate[case_id] == human
        entry = {"id": case_id, "human": human, "baseline": baseline[case_id], "candidate": candidate[case_id]}
        if was_right and not is_right:
            regressions.append(entry)
        elif not was_right and is_right:
            fixed.append(entry)
        elif not was_right and not is_right:
            still_wrong.append(entry)
    n = len(dataset)
    return {
        "n": n,
        "baseline_agreement": sum(baseline[c] == h for c, h in dataset.items()) / n if n else None,
        "candidate_agreement": sum(candidate[c] == h for c, h in dataset.items()) / n if n else None,
        "regressions": regressions,
        "fixed": fixed,
        "still_wrong": still_wrong,
    }


def render(result: dict) -> str:
    def pct(value: float | None) -> str:
        return "n/a" if value is None else f"{value:.0%}"

    lines = [
        f"{result['n']} case(s): baseline agreement {pct(result['baseline_agreement'])}, candidate agreement {pct(result['candidate_agreement'])}",
        f"regressions: {len(result['regressions'])}, fixed: {len(result['fixed'])}, wrong in both: {len(result['still_wrong'])}",
    ]
    for entry in result["regressions"]:
        lines.append(f"- REGRESSION {entry['id']}: human {entry['human']}, baseline {entry['baseline']}, candidate {entry['candidate']}")
    for entry in result["fixed"]:
        lines.append(f"- fixed {entry['id']}: human {entry['human']}, baseline {entry['baseline']}, candidate {entry['candidate']}")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv[1:]
    options = {"--dataset": None, "--baseline": None, "--candidate": None, "--max-regressions": "0"}
    try:
        for name in options:
            if name in args:
                i = args.index(name)
                options[name] = args[i + 1]
                del args[i : i + 2]
        allowed = int(options["--max-regressions"])
    except (IndexError, ValueError):
        args = ["?"]
    if args or not all(options[k] for k in ("--dataset", "--baseline", "--candidate")):
        print("usage: regression_check.py --dataset f --baseline f --candidate f [--max-regressions N]", file=sys.stderr)
        return 2

    try:
        dataset = load_dataset(json.loads(Path(options["--dataset"]).read_text(encoding="utf-8")))
        baseline = load_decisions(json.loads(Path(options["--baseline"]).read_text(encoding="utf-8")), "baseline", dataset)
        candidate = load_decisions(json.loads(Path(options["--candidate"]).read_text(encoding="utf-8")), "candidate", dataset)
    except (ValueError, json.JSONDecodeError) as error:
        print(f"invalid input: {error}", file=sys.stderr)
        return 2

    result = compare(dataset, baseline, candidate)
    print(render(result))
    return 1 if len(result["regressions"]) > allowed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
