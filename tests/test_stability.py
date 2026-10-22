import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import stability as st  # noqa: E402

SCRIPT = str(ROOT / "scripts" / "stability.py")


def finding(rule="r", file="a.ts", line=1, severity="advisory", category="correctness"):
    return {
        "rule_id": rule,
        "category": category,
        "severity": severity,
        "location": {"file": file, "line": line},
        "message": "m",
        "suggested_fix": "f",
    }


def review(*findings):
    return {"schema_version": 1, "findings": list(findings)}


class Similarity(unittest.TestCase):
    def test_identical_runs_are_fully_stable(self):
        runs = [review(finding()), review(finding())]
        result = st.analyze(runs)
        self.assertEqual(result["mean_jaccard"], 1.0)
        self.assertTrue(result["blocker_verdict_stable"])
        self.assertEqual(len(result["reported_in_every_run"]), 1)

    def test_disjoint_runs_have_zero_similarity(self):
        result = st.analyze([review(finding(rule="a")), review(finding(rule="b"))])
        self.assertEqual(result["mean_jaccard"], 0.0)

    def test_partial_overlap(self):
        a = review(finding(rule="a"), finding(rule="b"))
        b = review(finding(rule="a"), finding(rule="c"))
        self.assertAlmostEqual(st.analyze([a, b])["mean_jaccard"], 1 / 3)

    def test_two_empty_reviews_agree_completely(self):
        self.assertEqual(st.analyze([review(), review()])["mean_jaccard"], 1.0)

    def test_an_empty_review_against_a_populated_one_disagrees(self):
        self.assertEqual(st.analyze([review(), review(finding())])["mean_jaccard"], 0.0)

    def test_the_mean_covers_every_pair(self):
        runs = [review(finding(rule="a")), review(finding(rule="a")), review(finding(rule="b"))]
        result = st.analyze(runs)
        self.assertEqual(len(result["pairs"]), 3)
        self.assertAlmostEqual(result["mean_jaccard"], 1 / 3)

    def test_findings_in_only_some_runs_are_listed_with_their_count(self):
        runs = [review(finding(rule="a"), finding(rule="b")), review(finding(rule="a")), review(finding(rule="a"))]
        result = st.analyze(runs)
        self.assertEqual(result["reported_in_every_run"], [("a.ts", 1, "a")])
        self.assertEqual(result["reported_in_some_runs"], [(("a.ts", 1, "b"), 1)])


class Granularity(unittest.TestCase):
    def test_a_different_line_is_a_different_finding_unless_loose(self):
        a, b = review(finding(line=10)), review(finding(line=12))
        self.assertEqual(st.analyze([a, b])["mean_jaccard"], 0.0)
        self.assertEqual(st.analyze([a, b], loose=True)["mean_jaccard"], 1.0)

    def test_loose_keeps_different_categories_apart(self):
        a, b = review(finding(category="security")), review(finding(category="style"))
        self.assertEqual(st.analyze([a, b], loose=True)["mean_jaccard"], 0.0)


class BlockerVerdict(unittest.TestCase):
    def test_a_blocker_in_only_one_run_makes_the_verdict_unstable(self):
        result = st.analyze([review(finding(severity="blocker")), review(finding())])
        self.assertFalse(result["blocker_verdict_stable"])

    def test_agreement_on_a_blocker_is_stable_even_if_lines_differ(self):
        a = review(finding(severity="blocker", line=1))
        b = review(finding(severity="blocker", line=2))
        self.assertTrue(st.analyze([a, b])["blocker_verdict_stable"])


class Usage(unittest.TestCase):
    def test_one_run_is_not_enough(self):
        with self.assertRaises(ValueError):
            st.analyze([review()])

    def test_the_report_names_what_is_unstable(self):
        text = st.render(st.analyze([review(finding(rule="a")), review(finding(rule="b"))]))
        self.assertIn("blocker verdict stable across runs: yes", text)
        self.assertIn("reported in only some runs: 2", text)

    def test_command_line_rejects_an_invalid_run_and_too_few_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            good, bad = Path(tmp, "good.json"), Path(tmp, "bad.json")
            good.write_text(json.dumps(review(finding())), encoding="utf-8")
            bad.write_text('{"schema_version": 1}', encoding="utf-8")
            ok = subprocess.run([sys.executable, SCRIPT, str(good), str(good)], capture_output=True, text=True)
            invalid = subprocess.run([sys.executable, SCRIPT, str(good), str(bad)], capture_output=True, text=True)
            few = subprocess.run([sys.executable, SCRIPT, str(good)], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        self.assertIn("mean Jaccard: 1.00", ok.stdout)
        self.assertEqual(invalid.returncode, 2)
        self.assertEqual(few.returncode, 2)


if __name__ == "__main__":
    unittest.main()
