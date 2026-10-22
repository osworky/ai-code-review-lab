"""Deterministic validator for the reviewer's JSON output (schema_version 1).

No model is involved: it checks structure, required fields, closed value sets and,
optionally, that every cited location exists in the diff.

    py scripts/validate_review.py review.json [--diff diff.patch]

Exit code 0 = valid, 1 = invalid (one error per line), 2 = usage error.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CATEGORIES = ["correctness", "security", "performance", "missing_tests", "style", "documentation"]
SEVERITIES = ["blocker", "advisory", "info"]

TOP_LEVEL_FIELDS = ["schema_version", "findings"]
FINDING_FIELDS = ["rule_id", "category", "severity", "location", "message", "suggested_fix"]
LOCATION_FIELDS = ["file", "line"]
RULE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")

Ranges = dict[str, list[tuple[int, int]]]


def _is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _is_line_number(value: object) -> bool:
    # bool is a subclass of int; a JSON true must not pass as a line number.
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def parse_diff_ranges(diff_text: str) -> Ranges:
    """Return, per file, the new-side line ranges of every hunk in a unified diff."""
    ranges: Ranges = {}
    current: str | None = None
    for line in diff_text.replace("\r\n", "\n").split("\n"):
        header = re.match(r"^\+\+\+ b/(.+)$", line)
        if header:
            current = header.group(1)
            ranges.setdefault(current, [])
            continue
        hunk = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
        if hunk and current:
            start = int(hunk.group(1))
            count = 1 if hunk.group(2) is None else int(hunk.group(2))
            ranges[current].append((start, start + max(count, 1) - 1))
    return ranges


def validate_review(text: str, diff_ranges: Ranges | None = None) -> tuple[bool, list[str], dict | None]:
    """Validate raw reviewer output. Returns (ok, errors, parsed review or None)."""
    if not isinstance(text, str) or not text.strip():
        return False, ["output is empty"], None
    if re.match(r"^\s*```", text):
        return False, ["output must be bare JSON, not a Markdown code block"], None

    try:
        review = json.loads(text)
    except json.JSONDecodeError as error:
        return False, [f"output is not valid JSON: {error}"], None

    if not isinstance(review, dict):
        return False, ["top level must be a JSON object"], None

    errors: list[str] = []
    for key in review:
        if key not in TOP_LEVEL_FIELDS:
            errors.append(f'unknown top-level field "{key}"')
    schema_version = review.get("schema_version")
    if schema_version != 1 or isinstance(schema_version, bool):
        errors.append('"schema_version" must be the number 1')
    findings = review.get("findings")
    if not isinstance(findings, list):
        errors.append('"findings" must be an array (use [] when there are no findings)')
        return False, errors, None

    for index, finding in enumerate(findings):
        at = f"findings[{index}]"
        if not isinstance(finding, dict):
            errors.append(f"{at} must be an object")
            continue

        for key in finding:
            if key not in FINDING_FIELDS:
                errors.append(f'{at}: unknown field "{key}"')
        for key in FINDING_FIELDS:
            if key not in finding:
                errors.append(f'{at}: missing required field "{key}"')

        if "rule_id" in finding and not (
            isinstance(finding["rule_id"], str) and RULE_ID_PATTERN.match(finding["rule_id"])
        ):
            errors.append(f'{at}: "rule_id" must be lowercase kebab-case, e.g. "missing-authorization"')
        if "category" in finding and finding["category"] not in CATEGORIES:
            errors.append(
                f'{at}: "category" must be one of {", ".join(CATEGORIES)} (got {json.dumps(finding["category"])})'
            )
        if "severity" in finding and finding["severity"] not in SEVERITIES:
            errors.append(
                f'{at}: "severity" must be one of {", ".join(SEVERITIES)} (got {json.dumps(finding["severity"])})'
            )
        if "message" in finding and not _is_non_empty_string(finding["message"]):
            errors.append(f'{at}: "message" must be a non-empty string')
        if "suggested_fix" in finding and not _is_non_empty_string(finding["suggested_fix"]):
            errors.append(f'{at}: "suggested_fix" must be a non-empty string')

        if "location" not in finding:
            continue
        location = finding["location"]
        if not isinstance(location, dict):
            errors.append(f'{at}: "location" must be an object with "file" and "line"')
            continue
        for key in location:
            if key not in LOCATION_FIELDS:
                errors.append(f'{at}.location: unknown field "{key}"')
        for key in LOCATION_FIELDS:
            if key not in location:
                errors.append(f'{at}.location: missing required field "{key}"')
        if "file" in location and not _is_non_empty_string(location["file"]):
            errors.append(f'{at}.location: "file" must be a non-empty string')
        if "line" in location and not _is_line_number(location["line"]):
            errors.append(f'{at}.location: "line" must be an integer >= 1')

        if diff_ranges is not None and _is_non_empty_string(location.get("file")) and _is_line_number(location.get("line")):
            file, line = location["file"], location["line"]
            if file not in diff_ranges:
                errors.append(f'{at}.location: file "{file}" is not part of the diff')
            elif not any(start <= line <= end for start, end in diff_ranges[file]):
                errors.append(f'{at}.location: line {line} of "{file}" is outside every changed hunk')

    return (not errors), errors, (review if not errors else None)


def main(argv: list[str]) -> int:
    args = argv[1:]
    diff_path: str | None = None
    if "--diff" in args:
        position = args.index("--diff")
        if position + 1 >= len(args):
            print("usage: validate_review.py review.json [--diff diff.patch]", file=sys.stderr)
            return 2
        diff_path = args[position + 1]
        del args[position : position + 2]
    if len(args) != 1:
        print("usage: validate_review.py review.json [--diff diff.patch]", file=sys.stderr)
        return 2

    diff_ranges = parse_diff_ranges(Path(diff_path).read_text(encoding="utf-8")) if diff_path else None
    ok, errors, review = validate_review(Path(args[0]).read_text(encoding="utf-8"), diff_ranges)
    if ok:
        print(f"OK: {len(review['findings'])} finding(s)")
        return 0
    print(f"INVALID ({len(errors)} error(s)):", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
