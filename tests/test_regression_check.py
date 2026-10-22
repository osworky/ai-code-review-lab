import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import regression_check as rc  # noqa: E402

SCRIPT = str(ROOT / "scripts" / "regression_check.py")

DATASET = {"c1": "block", "c2": "warn", "c3": "pass", "c4": "block"}


class Comparison(unittest.TestCase):
    def test_classifies_regressions_fixes_and_cases_wrong_in_both(self):
        baseline = {"c1": "block", "c2": "block", "c3": "pass", "c4": "warn"}
        candidate = {"c1": "warn", "c2": "warn", "c3": "pass", "c4": "warn"}
        result = rc.compare(DATASET, baseline, candidate)
        self.assertEqual([e["id"] for e in result["regressions"]], ["c1"])
        self.assertEqual([e["id"] for e in result["fixed"]], ["c2"])
        self.assertEqual([e["id"] for e in result["still_wrong"]], ["c4"])

    def test_a_change_that_only_improves_has_no_regressions(self):
        baseline = {"c1": "pass", "c2": "pass", "c3": "pass", "c4": "pass"}
        candidate = dict(DATASET)
        result = rc.compare(DATASET, baseline, candidate)
        self.assertEqual(result["regressions"], [])
        self.assertEqual(result["candidate_agreement"], 1.0)
        self.assertEqual(result["baseline_agreement"], 0.25)

    def test_a_better_average_can_still_hide_a_regression(self):
        # Candidate fixes two cases and breaks one: agreement rises, but the break is still reported.
        baseline = {"c1": "block", "c2": "pass", "c3": "block", "c4": "pass"}
        candidate = {"c1": "warn", "c2": "warn", "c3": "pass", "c4": "block"}
        result = rc.compare(DATASET, baseline, candidate)
        self.assertGreater(result["candidate_agreement"], result["baseline_agreement"])
        self.assertEqual([e["id"] for e in result["regressions"]], ["c1"])

    def test_the_course_example_a_policy_tweak_turns_a_false_positive_into_a_fix(self):
        # Missing test: the AI blocked, the human only warned. Demoting the rule to warn fixes it.
        result = rc.compare({"missing-test": "warn"}, {"missing-test": "block"}, {"missing-test": "warn"})
        self.assertEqual(len(result["fixed"]), 1)


class Loading(unittest.TestCase):
    def test_the_dataset_must_be_well_formed(self):
        for raw in [{}, [{"id": "a"}], [{"id": "a", "human_decision": "maybe"}], [{"id": "a", "human_decision": "pass"}] * 2]:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    rc.load_dataset(raw)

    def test_decisions_must_cover_exactly_the_dataset(self):
        with self.assertRaisesRegex(ValueError, "no decision for: c2"):
            rc.load_decisions({"c1": "block"}, "baseline", {"c1": "block", "c2": "warn"})
        with self.assertRaisesRegex(ValueError, "not in the dataset: zz"):
            rc.load_decisions({"c1": "block", "zz": "pass"}, "candidate", {"c1": "block"})
        with self.assertRaisesRegex(ValueError, "invalid decision"):
            rc.load_decisions({"c1": "maybe"}, "candidate", {"c1": "block"})


class CommandLine(unittest.TestCase):
    def run_cli(self, baseline, candidate, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            files = {}
            for name, content in (("dataset", [{"id": k, "human_decision": v} for k, v in DATASET.items()]), ("baseline", baseline), ("candidate", candidate)):
                files[name] = Path(tmp, f"{name}.json")
                files[name].write_text(json.dumps(content), encoding="utf-8")
            return subprocess.run(
                [sys.executable, SCRIPT, "--dataset", str(files["dataset"]), "--baseline", str(files["baseline"]), "--candidate", str(files["candidate"]), *extra],
                capture_output=True,
                text=True,
            )

    def test_exit_0_when_nothing_regresses(self):
        result = self.run_cli(dict(DATASET), dict(DATASET))
        self.assertEqual(result.returncode, 0)
        self.assertIn("regressions: 0", result.stdout)

    def test_exit_1_and_names_the_broken_case_on_a_regression(self):
        broken = {**DATASET, "c1": "pass"}
        result = self.run_cli(dict(DATASET), broken)
        self.assertEqual(result.returncode, 1)
        self.assertIn("REGRESSION c1", result.stdout)

    def test_a_regression_budget_can_be_allowed_explicitly(self):
        broken = {**DATASET, "c1": "pass"}
        self.assertEqual(self.run_cli(dict(DATASET), broken, "--max-regressions", "1").returncode, 0)

    def test_inconsistent_files_and_bad_usage_return_2(self):
        self.assertEqual(self.run_cli({"c1": "block"}, dict(DATASET)).returncode, 2)
        self.assertEqual(subprocess.run([sys.executable, SCRIPT], capture_output=True, text=True).returncode, 2)


if __name__ == "__main__":
    unittest.main()
