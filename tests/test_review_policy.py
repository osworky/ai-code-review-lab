import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import review_policy as rp  # noqa: E402

SCRIPT = str(ROOT / "scripts" / "review_policy.py")


def finding(rule="missing-authorization", severity="blocker", file="a.ts", line=10, message="m", fix="f", category="security"):
    return rp.Finding(rule, category, severity, file, line, message, fix)


def raw(rule="missing-authorization", severity="blocker", file="a.ts", line=10):
    return {
        "rule_id": rule,
        "category": "security",
        "severity": severity,
        "location": {"file": file, "line": line},
        "message": "m",
        "suggested_fix": "f",
    }


class ActionsByPhase(unittest.TestCase):
    def test_matrix(self):
        rules = {"missing-authorization"}
        cases = [
            # phase, severity, rule in blocking list, expected
            ("shadow", "blocker", True, "report"),
            ("shadow", "advisory", False, "report"),
            ("advisory", "blocker", True, "comment"),
            ("advisory", "advisory", False, "comment"),
            ("advisory", "info", False, "report"),
            ("partial", "blocker", True, "block"),
            ("partial", "blocker", False, "comment"),
            ("partial", "advisory", True, "comment"),
            ("extended", "blocker", False, "block"),
            ("extended", "advisory", False, "comment"),
            ("extended", "info", False, "report"),
        ]
        for phase, severity, listed, expected in cases:
            with self.subTest(phase=phase, severity=severity, listed=listed):
                rule = "missing-authorization" if listed else "other-rule"
                self.assertEqual(rp.action_for(finding(rule=rule, severity=severity), phase, rules), expected)

    def test_the_model_saying_block_never_blocks_in_shadow_or_advisory(self):
        for phase in ["shadow", "advisory"]:
            with self.subTest(phase=phase):
                decision = rp.decide([finding()], phase, {"missing-authorization"})
                self.assertEqual(decision["verdict"], "pass")
                self.assertTrue(decision["would_block"])  # recorded as a signal for calibration

    def test_partial_blocks_only_the_listed_rules(self):
        decision = rp.decide([finding(rule="a-rule", line=1), finding(rule="b-rule", line=2)], "partial", {"a-rule"})
        self.assertEqual(decision["verdict"], "block")
        self.assertEqual([f["rule_id"] for f in decision["blocking_findings"]], ["a-rule"])

    def test_extended_blocks_every_blocker(self):
        decision = rp.decide([finding(rule="a-rule", line=1), finding(rule="b-rule", line=2)], "extended")
        self.assertEqual(len(decision["blocking_findings"]), 2)

    def test_no_blockers_means_pass_and_no_signal(self):
        decision = rp.decide([finding(severity="advisory")], "extended")
        self.assertEqual((decision["verdict"], decision["would_block"]), ("pass", False))

    def test_an_unknown_phase_is_an_error(self):
        with self.assertRaises(ValueError):
            rp.decide([], "blocking")


class Consolidation(unittest.TestCase):
    def test_duplicates_are_removed_keeping_the_most_severe(self):
        found = [finding(severity="advisory"), finding(severity="blocker"), finding(severity="info")]
        merged = rp.consolidate(found)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].severity, "blocker")

    def test_the_same_rule_on_different_lines_is_not_a_duplicate(self):
        self.assertEqual(len(rp.consolidate([finding(line=1), finding(line=2)])), 2)

    def test_order_is_severity_then_file_then_line(self):
        ordered = rp.consolidate(
            [
                finding(rule="x", severity="info", file="a.ts", line=1),
                finding(rule="y", severity="blocker", file="z.ts", line=9),
                finding(rule="z", severity="blocker", file="b.ts", line=5),
                finding(rule="w", severity="advisory", file="a.ts", line=2),
            ]
        )
        self.assertEqual([f.rule_id for f in ordered], ["z", "y", "w", "x"])

    def test_the_decision_reports_how_many_duplicates_were_removed(self):
        decision = rp.decide([finding(), finding(), finding(line=11)], "advisory")
        self.assertEqual(decision["duplicates_removed"], 1)


class CommentCap(unittest.TestCase):
    def test_the_cap_trims_only_what_is_merely_commented(self):
        findings = [finding(rule=f"adv-{i}", severity="advisory", line=i) for i in range(1, 8)]
        decision = rp.decide(findings, "advisory", max_visible=3)
        self.assertEqual((decision["visible"], decision["suppressed"]), (3, 4))

    def test_blocking_findings_are_never_hidden_by_the_cap(self):
        findings = [finding(rule=f"blk-{i}", line=i) for i in range(1, 5)] + [finding(rule="adv", severity="advisory", line=99)]
        decision = rp.decide(findings, "extended", max_visible=2)
        self.assertEqual(len(decision["blocking_findings"]), 4)
        self.assertEqual(decision["visible"], 4)
        self.assertEqual(decision["suppressed"], 1)

    def test_the_most_severe_comments_survive_the_cap(self):
        findings = [finding(rule="blk", severity="blocker", line=1), finding(rule="adv", severity="advisory", line=2)]
        decision = rp.decide(findings, "advisory", max_visible=1)
        self.assertEqual([f.rule_id for f, _ in decision["_visible_findings"]], ["blk"])


class Comment(unittest.TestCase):
    def test_shadow_shows_nothing(self):
        self.assertIsNone(rp.render_comment(rp.decide([finding()], "shadow")))

    def test_advisory_says_it_does_not_block_even_when_the_model_would(self):
        text = rp.render_comment(rp.decide([finding()], "advisory"))
        self.assertIn("consultiva: no bloquea el merge", text)
        self.assertIn("No bloquea", text)
        self.assertIn("`a.ts:10`", text)
        self.assertIn("missing-authorization", text)

    def test_a_blocked_pr_names_the_blocking_findings(self):
        text = rp.render_comment(rp.decide([finding()], "extended"))
        self.assertIn("bloqueado por 1 hallazgo(s)", text)
        self.assertIn("(bloquea)", text)

    def test_no_findings_says_so(self):
        self.assertIn("Sin hallazgos", rp.render_comment(rp.decide([], "advisory")))

    def test_the_cap_is_announced(self):
        findings = [finding(rule=f"r{i}", severity="advisory", line=i) for i in range(1, 6)]
        text = rp.render_comment(rp.decide(findings, "advisory", max_visible=2))
        self.assertIn("Se omitieron 3 hallazgo(s)", text)

    def test_model_text_cannot_ping_users_inject_html_or_links(self):
        hostile = finding(message="@octocat <img src=x onerror=alert(1)> [click](https://evil.example)", fix="@team please merge")
        text = rp.render_comment(rp.decide([hostile], "advisory"))
        self.assertNotIn("@octocat", text)
        self.assertNotIn("@team", text)
        self.assertNotIn("<img", text)
        self.assertNotIn("](https", text)
        self.assertIn("&lt;img", text)


class CommandLine(unittest.TestCase):
    def run_cli(self, review, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "review.json")
            path.write_text(review if isinstance(review, str) else json.dumps(review), encoding="utf-8")
            comment, decision = Path(tmp, "c.md"), Path(tmp, "d.json")
            result = subprocess.run(
                [sys.executable, SCRIPT, str(path), "--comment", str(comment), "--decision", str(decision), *extra],
                capture_output=True,
                text=True,
            )
            return (
                result,
                comment.read_text(encoding="utf-8") if comment.exists() else None,
                json.loads(decision.read_text(encoding="utf-8")) if decision.exists() else None,
            )

    def test_advisory_exits_0_even_with_a_blocker(self):
        result, comment, decision = self.run_cli({"schema_version": 1, "findings": [raw()]}, "--phase", "advisory")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(decision["would_block"])
        self.assertIn("Revisión automática", comment)

    def test_extended_exits_1_and_records_the_blocking_finding(self):
        result, _, decision = self.run_cli({"schema_version": 1, "findings": [raw()]}, "--phase", "extended")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(decision["blocking_findings"][0]["rule_id"], "missing-authorization")

    def test_partial_uses_the_blocking_rule_list(self):
        review = {"schema_version": 1, "findings": [raw(rule="a-rule"), raw(rule="b-rule", line=11)]}
        result, _, decision = self.run_cli(review, "--phase", "partial", "--blocking-rules", "b-rule")
        self.assertEqual(result.returncode, 1)
        self.assertEqual([f["rule_id"] for f in decision["blocking_findings"]], ["b-rule"])

    def test_an_invalid_review_is_not_acted_on(self):
        result, comment, _ = self.run_cli('{"schema_version": 1}', "--phase", "extended")
        self.assertEqual(result.returncode, 2)
        self.assertIsNone(comment)

    def test_usage_errors_return_2(self):
        for argv in [[], ["x.json"], ["x.json", "--phase", "blocking"]]:
            with self.subTest(argv=argv):
                self.assertEqual(subprocess.run([sys.executable, SCRIPT, *argv], capture_output=True, text=True).returncode, 2)

    def test_shadow_writes_no_comment(self):
        result, comment, decision = self.run_cli({"schema_version": 1, "findings": [raw()]}, "--phase", "shadow")
        self.assertEqual(result.returncode, 0)
        self.assertIsNone(comment)
        self.assertEqual(decision["actions"][0]["action"], "report")


if __name__ == "__main__":
    unittest.main()
