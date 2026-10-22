"""Measure how much a reviewer's output varies when it reviews the same diff several times.

    py scripts/stability.py run1.json run2.json run3.json [--loose]

A model is not deterministic: temperature 0 and a fixed seed reduce the noise but do not remove it.
This script quantifies what remains, so that decisions about blocking rest on rules whose verdict is stable.

Per pair of runs it reports:
  - Jaccard similarity of the findings (file, line, rule_id); with --loose the key is (file, category),
    which forgives a different line number or rule name for the same problem
  - whether both runs agree on "contains a blocker"
Across all runs it lists, for each finding key, how many runs reported it.

Exit code: 0 on success, 2 on usage errors or when a run is not a valid review.
"""

from __future__ import annotations

import json
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_review import validate_review  # noqa: E402


def keys(review: dict, loose: bool) -> set[tuple]:
    found = set()
    for finding in review["findings"]:
        location = finding["location"]
        if loose:
            found.add((location["file"], finding["category"]))
        else:
            found.add((location["file"], location["line"], finding["rule_id"]))
    return found


def has_blocker(review: dict) -> bool:
    return any(f["severity"] == "blocker" for f in review["findings"])


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0  # two empty reviews agree completely
    return len(a & b) / len(a | b)


def analyze(reviews: list[dict], loose: bool = False) -> dict:
    if len(reviews) < 2:
        raise ValueError("at least two runs are needed to measure stability")
    sets = [keys(r, loose) for r in reviews]
    pairs = [
        {
            "runs": [i + 1, j + 1],
            "jaccard": jaccard(sets[i], sets[j]),
            "blocker_agreement": has_blocker(reviews[i]) == has_blocker(reviews[j]),
        }
        for i, j in combinations(range(len(reviews)), 2)
    ]
    counts: dict[tuple, int] = {}
    for found in sets:
        for key in found:
            counts[key] = counts.get(key, 0) + 1
    return {
        "runs": len(reviews),
        "granularity": "file+category" if loose else "file+line+rule",
        "pairs": pairs,
        "mean_jaccard": sum(p["jaccard"] for p in pairs) / len(pairs),
        "blocker_verdict_stable": all(p["blocker_agreement"] for p in pairs),
        "reported_in_every_run": sorted(k for k, n in counts.items() if n == len(reviews)),
        "reported_in_some_runs": sorted((k, n) for k, n in counts.items() if n < len(reviews)),
    }


def render(result: dict) -> str:
    lines = [
        f"{result['runs']} runs, granularity {result['granularity']}",
        f"mean Jaccard: {result['mean_jaccard']:.2f}",
        f"blocker verdict stable across runs: {'yes' if result['blocker_verdict_stable'] else 'NO'}",
        f"reported in every run: {len(result['reported_in_every_run'])}",
        f"reported in only some runs: {len(result['reported_in_some_runs'])}",
    ]
    for key, count in result["reported_in_some_runs"]:
        lines.append(f"  - {key} ({count} of {result['runs']})")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv[1:]
    loose = "--loose" in args
    if loose:
        args.remove("--loose")
    if len(args) < 2:
        print("usage: stability.py run1.json run2.json [run3.json ...] [--loose]", file=sys.stderr)
        return 2

    reviews = []
    for path in args:
        ok, errors, review = validate_review(Path(path).read_text(encoding="utf-8"))
        if not ok:
            print(f"{path} is not a valid review: {'; '.join(errors)}", file=sys.stderr)
            return 2
        reviews.append(review)
    print(render(analyze(reviews, loose)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
