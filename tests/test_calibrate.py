import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import calibrate as cal  # noqa: E402

SCRIPT = str(ROOT / "scripts" / "calibrate.py")


def entry(i, rule="r", category="c", ai="block", human="block"):
    return {"id": f"e{i}", "rule_id": rule, "category": category, "ai_decision": ai, "human_decision": human}


def rows(count, **kwargs):
    return [entry(i, **kwargs) for i in range(count)]


class HistoryValidation(unittest.TestCase):
    def test_accepts_the_shipped_synthetic_example(self):
        data = json.loads((ROOT / "data" / "history.example.json").read_text(encoding="utf-8"))
        self.assertEqual(cal.validate_history(data), [])

    def test_reports_missing_fields_bad_decisions_and_duplicates(self):
        broken = [entry(1), {"id": "e1", "rule_id": "r", "category": "c", "ai_decision": "maybe", "human_decision": "block"}, {"id": "x"}]
        errors = "\n".join(cal.validate_history(broken))
        self.assertIn('duplicate id "e1"', errors)
        self.assertIn('"ai_decision" must be one of', errors)
        self.assertIn('missing required field "rule_id"', errors)

    def test_rejects_something_that_is_not_an_array(self):
        self.assertEqual(cal.validate_history({"id": 1}), ["the history must be a JSON array"])


class Kappa(unittest.TestCase):
    def test_textbook_value(self):
        # 2x2: both yes 20, both no 15, ai yes/human no 5, ai no/human yes 10 -> kappa 0.4
        pairs = [("yes", "yes")] * 20 + [("no", "no")] * 15 + [("yes", "no")] * 5 + [("no", "yes")] * 10
        self.assertAlmostEqual(cal.cohen_kappa(pairs, ["yes", "no"]), 0.4)

    def test_perfect_agreement_is_one(self):
        pairs = [("a", "a")] * 5 + [("b", "b")] * 5
        self.assertEqual(cal.cohen_kappa(pairs, ["a", "b"]), 1.0)

    def test_a_reviewer_that_always_says_the_same_thing_scores_zero_despite_high_agreement(self):
        # 95 % of cases are "pass"; always answering "pass" agrees 95 % but carries no information.
        pairs = [("pass", "pass")] * 95 + [("pass", "block")] * 5
        self.assertEqual(cal.cohen_kappa(pairs, ["block", "pass"]), 0.0)

    def test_it_is_undefined_when_chance_agreement_is_total_or_there_is_no_data(self):
        self.assertIsNone(cal.cohen_kappa([("a", "a")] * 4, ["a", "b"]))
        self.assertIsNone(cal.cohen_kappa([], ["a", "b"]))

    def test_the_bootstrap_interval_is_reproducible_and_needs_data(self):
        pairs = [("block", "block")] * 20 + [("not_block", "not_block")] * 15 + [("block", "not_block")] * 5 + [("not_block", "block")] * 10
        labels = ["block", "not_block"]
        first = cal.bootstrap_interval(pairs, labels, seed=7)
        self.assertEqual(first, cal.bootstrap_interval(pairs, labels, seed=7))
        self.assertLess(first[0], 0.4)
        self.assertGreater(first[1], 0.4)
        self.assertIsNone(cal.bootstrap_interval(pairs[:1], labels, seed=7))


class BlockMetrics(unittest.TestCase):
    def test_false_positives_and_negatives_are_counted_against_block(self):
        pairs = [("block", "block")] * 3 + [("block", "warn")] * 2 + [("warn", "block")] * 1 + [("pass", "pass")] * 4
        metrics = cal.block_metrics(pairs)
        self.assertEqual((metrics["tp"], metrics["fp"], metrics["fn"], metrics["tn"]), (3, 2, 1, 4))
        self.assertAlmostEqual(metrics["precision"], 3 / 5)
        self.assertAlmostEqual(metrics["recall"], 3 / 4)
        self.assertAlmostEqual(metrics["fp_rate"], 2 / 5)

    def test_precision_is_undefined_when_the_ai_never_blocks(self):
        self.assertIsNone(cal.block_metrics([("pass", "pass")])["precision"])


class Assessment(unittest.TestCase):
    def test_a_handful_of_perfect_cases_is_not_evidence(self):
        # The course example: a few cases already show ~100 % agreement. Not enough to conclude anything.
        result = cal.assess([("block", "block"), ("pass", "pass"), ("block", "block"), ("pass", "pass")], min_n=30, seed=7)
        self.assertEqual(result["agreement"], 1.0)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIn("insufficient data", result["suggestion"])

    def test_no_suggestion_of_any_kind_below_min_n_even_for_a_terrible_rule(self):
        result = cal.assess([("block", "pass")] * 10, min_n=30, seed=7)
        self.assertEqual(result["status"], "insufficient_data")

    def test_a_rule_with_many_false_blocks_is_demoted(self):
        pairs = [("block", "block")] * 6 + [("block", "warn")] * 4 + [("pass", "pass")] * 20
        result = cal.assess(pairs, min_n=30, seed=7)
        self.assertEqual(result["status"], "demote")
        self.assertIn("demote to warn", result["suggestion"])
        self.assertIn("4 of 10", result["suggestion"])

    def test_a_consistently_agreeing_rule_with_enough_data_is_eligible(self):
        pairs = [("block", "block")] * 20 + [("pass", "pass")] * 20
        result = cal.assess(pairs, min_n=30, seed=7)
        self.assertEqual(result["status"], "eligible_to_block")
        self.assertEqual(result["kappa_block"], 1.0)

    def test_high_precision_but_low_kappa_is_not_eligible(self):
        # AI blocks rarely and correctly, but misses most of what the human blocks.
        pairs = [("block", "block")] * 5 + [("pass", "block")] * 20 + [("pass", "pass")] * 15
        result = cal.assess(pairs, min_n=30, seed=7)
        self.assertEqual(result["status"], "assessed")
        self.assertIsNone(result["suggestion"])

    def test_the_analysis_groups_by_rule_and_category(self):
        data = rows(3, rule="a", category="x") + [entry(10 + i, rule="b", category="x") for i in range(2)]
        report = cal.analyze(data, min_n=2)
        self.assertEqual(sorted(report["by_rule"]), ["a", "b"])
        self.assertEqual(report["by_category"]["x"]["n"], 5)
        self.assertEqual(report["overall"]["n"], 5)

    def test_the_overall_row_never_carries_a_rule_level_suggestion(self):
        pairs = [entry(i, ai="block", human="warn") for i in range(20)] + [entry(100 + i, ai="pass", human="pass") for i in range(20)]
        report = cal.analyze(pairs, min_n=30)
        self.assertEqual(report["overall"]["status"], "assessed")
        self.assertIsNone(report["overall"]["suggestion"])
        self.assertEqual(report["by_rule"]["r"]["status"], "demote")

    def test_the_report_is_deterministic(self):
        data = rows(15, rule="a") + rows(15, rule="a", ai="pass", human="pass")
        for i, item in enumerate(data):
            item["id"] = f"u{i}"
        self.assertEqual(cal.analyze(data, seed=3), cal.analyze(data, seed=3))


class SamplingBias(unittest.TestCase):
    def history(self):
        sampled = [dict(entry(i), source="audit_sample") for i in range(30)]  # 30 agreements
        overrides = [dict(entry(100 + i, human="warn"), source="override") for i in range(30)]  # 30 disagreements
        return sampled + overrides

    def test_rows_chosen_because_of_a_disagreement_drag_agreement_down(self):
        everything = cal.analyze(self.history(), min_n=30)
        sampled_only = cal.analyze(self.history(), min_n=30, sources={"audit_sample"})
        self.assertEqual(everything["overall"]["agreement"], 0.5)
        self.assertEqual(sampled_only["overall"]["agreement"], 1.0)
        self.assertEqual(sampled_only["overall"]["n"], 30)
        self.assertEqual(sampled_only["sources"], ["audit_sample"])

    def test_the_command_line_warns_when_sources_are_mixed_and_not_chosen(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "h.json")
            path.write_text(json.dumps(self.history()), encoding="utf-8")
            mixed = subprocess.run([sys.executable, SCRIPT, str(path)], capture_output=True, text=True)
            chosen = subprocess.run([sys.executable, SCRIPT, str(path), "--sources", "audit_sample"], capture_output=True, text=True)
        self.assertIn("WARNING", mixed.stderr)
        self.assertNotIn("WARNING", chosen.stderr)
        self.assertIn("sources = audit_sample", chosen.stdout)


class CommandLine(unittest.TestCase):
    def run_cli(self, history, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "h.json")
            path.write_text(history if isinstance(history, str) else json.dumps(history), encoding="utf-8")
            out = Path(tmp, "r.json")
            result = subprocess.run([sys.executable, SCRIPT, str(path), "--json", str(out), *extra], capture_output=True, text=True)
            return result, (json.loads(out.read_text(encoding="utf-8")) if out.exists() else None)

    def test_prints_a_table_and_writes_the_json(self):
        data = json.loads((ROOT / "data" / "history.example.json").read_text(encoding="utf-8"))
        result, report = self.run_cli(data, "--min-n", "2")
        self.assertEqual(result.returncode, 0)
        self.assertIn("| rule: missing-tests |", result.stdout)
        self.assertEqual(report["overall"]["n"], 8)

    def test_with_the_default_minimum_the_example_is_insufficient(self):
        data = json.loads((ROOT / "data" / "history.example.json").read_text(encoding="utf-8"))
        result, report = self.run_cli(data)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["overall"]["status"], "insufficient_data")

    def test_an_invalid_history_is_rejected(self):
        result, report = self.run_cli([{"id": "x"}])
        self.assertEqual(result.returncode, 2)
        self.assertIsNone(report)

    def test_not_json_and_bad_usage_return_2(self):
        self.assertEqual(self.run_cli("not json")[0].returncode, 2)
        self.assertEqual(subprocess.run([sys.executable, SCRIPT], capture_output=True, text=True).returncode, 2)


if __name__ == "__main__":
    unittest.main()
