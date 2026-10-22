import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_review import parse_diff_ranges, validate_review  # noqa: E402

FINDING = {
    "rule_id": "missing-authorization",
    "category": "security",
    "severity": "blocker",
    "location": {"file": "app/api/route.ts", "line": 50},
    "message": "The client allowlist was removed.",
    "suggested_fix": "Restore the check.",
}

DIFF = "\n".join(
    [
        "diff --git a/lib/quote.ts b/lib/quote.ts",
        "--- a/lib/quote.ts",
        "+++ b/lib/quote.ts",
        "@@ -180,0 +182,6 @@ export function formatPrice() {",
        "+added",
        "diff --git a/app/api/route.ts b/app/api/route.ts",
        "--- a/app/api/route.ts",
        "+++ b/app/api/route.ts",
        "@@ -49,3 +50 @@ export async function POST() {",
        "+added",
    ]
)


def review(findings=None) -> str:
    return json.dumps({"schema_version": 1, "findings": [FINDING] if findings is None else findings})


def without(key: str) -> dict:
    return {k: v for k, v in FINDING.items() if k != key}


class ValidOutput(unittest.TestCase):
    def test_accepts_a_well_formed_finding(self):
        ok, errors, _ = validate_review(review())
        self.assertTrue(ok)
        self.assertEqual(errors, [])

    def test_accepts_an_empty_findings_list(self):
        ok, _, parsed = validate_review(review([]))
        self.assertTrue(ok)
        self.assertEqual(parsed["findings"], [])


class BrokenOutput(unittest.TestCase):
    def test_reports_exactly_which_field_is_missing(self):
        ok, errors, _ = validate_review(review([without("severity")]))
        self.assertFalse(ok)
        self.assertEqual(errors, ['findings[0]: missing required field "severity"'])

    def test_rejects_each_missing_required_field(self):
        for field in ["rule_id", "category", "location", "message", "suggested_fix"]:
            with self.subTest(field=field):
                ok, errors, _ = validate_review(review([without(field)]))
                self.assertFalse(ok)
                self.assertIn(f'"{field}"', "\n".join(errors))

    def test_rejects_values_outside_the_closed_sets(self):
        cases = [("category", "tests"), ("category", "Security"), ("severity", "high"), ("severity", "")]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                ok, errors, _ = validate_review(review([{**FINDING, field: value}]))
                self.assertFalse(ok)
                self.assertIn(f'"{field}" must be one of', errors[0])

    def test_rejects_lines_that_are_not_positive_integers(self):
        for line in [0, -3, 2.5, "50", None, True]:
            with self.subTest(line=line):
                finding = {**FINDING, "location": {"file": "a.ts", "line": line}}
                ok, errors, _ = validate_review(review([finding]))
                self.assertFalse(ok)
                self.assertIn('"line" must be an integer >= 1', "\n".join(errors))

    def test_rejects_malformed_rule_ids(self):
        for rule_id in ["MissingAuth", "missing_auth", "-x", ""]:
            with self.subTest(rule_id=rule_id):
                ok, errors, _ = validate_review(review([{**FINDING, "rule_id": rule_id}]))
                self.assertFalse(ok)
                self.assertIn("rule_id", errors[0])

    def test_rejects_unknown_fields(self):
        ok, errors, _ = validate_review(review([{**FINDING, "confidence": 0.9}]))
        self.assertEqual(errors, ['findings[0]: unknown field "confidence"'])

    def test_rejects_an_empty_message(self):
        ok, errors, _ = validate_review(review([{**FINDING, "message": "   "}]))
        self.assertIn('"message" must be a non-empty string', errors[0])

    def test_rejects_unusable_outputs(self):
        cases = {
            "not json": "the review looks fine",
            "markdown block": "```json\n" + review() + "\n```",
            "empty": "",
            "bare array": "[]",
            "wrong version": json.dumps({"schema_version": 2, "findings": []}),
            "missing findings": json.dumps({"schema_version": 1}),
        }
        for name, text in cases.items():
            with self.subTest(name=name):
                ok, errors, _ = validate_review(text)
                self.assertFalse(ok)
                self.assertTrue(errors)


class LocationsMustExistInTheDiff(unittest.TestCase):
    def test_parses_new_side_ranges(self):
        ranges = parse_diff_ranges(DIFF)
        self.assertEqual(ranges["lib/quote.ts"], [(182, 187)])
        self.assertEqual(ranges["app/api/route.ts"], [(50, 50)])

    def test_accepts_a_line_inside_a_changed_hunk(self):
        ok, _, _ = validate_review(review(), parse_diff_ranges(DIFF))
        self.assertTrue(ok)

    def test_rejects_a_file_that_is_not_in_the_diff(self):
        finding = {**FINDING, "location": {"file": "lib/other.ts", "line": 10}}
        _, errors, _ = validate_review(review([finding]), parse_diff_ranges(DIFF))
        self.assertEqual(errors, ['findings[0].location: file "lib/other.ts" is not part of the diff'])

    def test_rejects_an_invented_line(self):
        finding = {**FINDING, "location": {"file": "lib/quote.ts", "line": 999}}
        _, errors, _ = validate_review(review([finding]), parse_diff_ranges(DIFF))
        self.assertIn("outside every changed hunk", errors[0])


class RealReviewerRun(unittest.TestCase):
    """The recorded reviewer v2 run must stay valid against the diff it reviewed."""

    @unittest.skipUnless((ROOT / "experiments" / "reviewer-seeded" / "runs" / "seeded-diff.patch").exists(), "the recorded run is private evidence that is not published")
    def test_recorded_run_is_valid_and_grounded(self):
        runs = ROOT / "experiments" / "reviewer-seeded" / "runs"
        ranges = parse_diff_ranges((runs / "seeded-diff.patch").read_text(encoding="utf-8"))
        ok, errors, parsed = validate_review((runs / "v2-raw-review.json").read_text(encoding="utf-8"), ranges)
        self.assertTrue(ok, errors)
        self.assertEqual(len(parsed["findings"]), 8)


class CommandLine(unittest.TestCase):
    def test_exit_codes_and_messages(self):
        script = str(ROOT / "scripts" / "validate_review.py")
        with tempfile.TemporaryDirectory() as tmp:
            good, bad = Path(tmp, "good.json"), Path(tmp, "bad.json")
            good.write_text(review(), encoding="utf-8")
            bad.write_text(review([without("severity")]), encoding="utf-8")

            ok = subprocess.run([sys.executable, script, str(good)], capture_output=True, text=True)
            broken = subprocess.run([sys.executable, script, str(bad)], capture_output=True, text=True)
            usage = subprocess.run([sys.executable, script], capture_output=True, text=True)

        self.assertEqual(ok.returncode, 0)
        self.assertIn("OK: 1 finding(s)", ok.stdout)
        self.assertEqual(broken.returncode, 1)
        self.assertIn('missing required field "severity"', broken.stderr)
        self.assertEqual(usage.returncode, 2)


if __name__ == "__main__":
    unittest.main()
