"""Compare mutation-testing runs from Stryker JSON reports.

    py scripts/compare_mutation.py "Ingenua=a.json" "Original=b.json" "Mutacion=c.json" [--file lib/quote.ts]

Surviving = Survived + NoCoverage (a mutant no test detected). Ratio = surviving / total.
Mutation score = (Killed + Timeout) / (total - Ignored - CompileError). Ignored and compile
errors are excluded from the total so they do not distort the ratio.

This replaces asking a model to read the reports and build the table: a script gives the same
numbers every time and cannot invent them.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

KILLED = {"Killed", "Timeout"}
SURVIVING = {"Survived", "NoCoverage"}
EXCLUDED = {"Ignored", "CompileError", "RuntimeError"}


@dataclass(frozen=True)
class Summary:
    suite: str
    total: int
    killed: int
    survived: int
    no_coverage: int

    @property
    def surviving(self) -> int:
        return self.survived + self.no_coverage

    @property
    def survival_ratio(self) -> float:
        return self.surviving / self.total if self.total else 0.0

    @property
    def score(self) -> float:
        return self.killed / self.total if self.total else 0.0


def summarize(suite: str, report: dict, file: str | None = None) -> Summary:
    files = report.get("files", {})
    if file is not None:
        if file not in files:
            raise KeyError(f'file "{file}" is not in the report (has: {", ".join(sorted(files)) or "none"})')
        files = {file: files[file]}

    killed = survived = no_coverage = excluded = 0
    for entry in files.values():
        for mutant in entry.get("mutants", []):
            status = mutant.get("status")
            if status in KILLED:
                killed += 1
            elif status == "Survived":
                survived += 1
            elif status == "NoCoverage":
                no_coverage += 1
            elif status in EXCLUDED:
                excluded += 1
            else:
                raise ValueError(f'unknown mutant status "{status}"')
    return Summary(suite, killed + survived + no_coverage, killed, survived, no_coverage)


def render_table(summaries: list[Summary]) -> str:
    rows = ["| Suite | Mutantes totales | Sobrevivientes | Relación | Puntaje de mutación |", "|---|---|---|---|---|"]
    for item in summaries:
        rows.append(
            f"| {item.suite} | {item.total} | {item.surviving} | {item.survival_ratio:.1%} | {item.score:.2%} |"
        )
    return "\n".join(rows)


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # tables contain accents; do not depend on the console code page
    args = argv[1:]
    file: str | None = None
    if "--file" in args:
        position = args.index("--file")
        if position + 1 >= len(args):
            print('usage: compare_mutation.py "Suite=report.json" ... [--file path]', file=sys.stderr)
            return 2
        file = args[position + 1]
        del args[position : position + 2]

    pairs = [arg.split("=", 1) for arg in args]
    if not pairs or any(len(pair) != 2 or not all(pair) for pair in pairs):
        print('usage: compare_mutation.py "Suite=report.json" ... [--file path]', file=sys.stderr)
        return 2

    summaries = [
        summarize(suite, json.loads(Path(path).read_text(encoding="utf-8")), file) for suite, path in pairs
    ]
    print(render_table(summaries))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
