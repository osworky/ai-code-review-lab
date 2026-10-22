import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compare_mutation import render_table, summarize  # noqa: E402


def report(**counts: int) -> dict:
    mutants = []
    for status, count in counts.items():
        mutants += [{"status": status.replace("_", "")}] * count
    return {"files": {"lib/quote.ts": {"mutants": mutants}}}


class Summaries(unittest.TestCase):
    def test_counts_killed_survived_and_uncovered(self):
        summary = summarize("B", report(Killed=230, Survived=124, NoCoverage=20))
        self.assertEqual(summary.total, 374)
        self.assertEqual(summary.surviving, 144)
        self.assertAlmostEqual(summary.survival_ratio, 144 / 374)
        self.assertAlmostEqual(summary.score, 230 / 374)

    def test_timeouts_count_as_killed(self):
        summary = summarize("x", report(Killed=8, Timeout=2, Survived=10))
        self.assertEqual(summary.killed, 10)

    def test_ignored_and_compile_errors_do_not_change_the_total(self):
        summary = summarize("x", report(Killed=9, Survived=1, Ignored=5, CompileError=3))
        self.assertEqual(summary.total, 10)
        self.assertAlmostEqual(summary.survival_ratio, 0.1)

    def test_an_unknown_status_is_an_error_not_a_guess(self):
        with self.assertRaises(ValueError):
            summarize("x", {"files": {"a.ts": {"mutants": [{"status": "Mystery"}]}}})

    def test_a_missing_file_is_reported(self):
        with self.assertRaises(KeyError):
            summarize("x", report(Killed=1), file="lib/other.ts")

    def test_a_report_without_mutants_does_not_divide_by_zero(self):
        summary = summarize("x", {"files": {}})
        self.assertEqual((summary.total, summary.survival_ratio, summary.score), (0, 0.0, 0.0))


class Table(unittest.TestCase):
    def test_matches_the_published_course_format_numbers(self):
        # Values measured in experiments/quote-v1: A 374/131, B 374/144, C 374/108.
        rows = render_table(
            [
                summarize("Ingenua (A)", report(Killed=243, Survived=123, NoCoverage=8)),
                summarize("Original (B)", report(Killed=230, Survived=124, NoCoverage=20)),
                summarize("Mutación (C)", report(Killed=266, Survived=89, NoCoverage=19)),
            ]
        ).splitlines()
        self.assertEqual(rows[2], "| Ingenua (A) | 374 | 131 | 35.0% | 64.97% |")
        self.assertEqual(rows[3], "| Original (B) | 374 | 144 | 38.5% | 61.50% |")
        self.assertEqual(rows[4], "| Mutación (C) | 374 | 108 | 28.9% | 71.12% |")


class CommandLine(unittest.TestCase):
    def test_prints_a_table_and_rejects_bad_usage(self):
        script = str(ROOT / "scripts" / "compare_mutation.py")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "a.json")
            path.write_text(json.dumps(report(Killed=3, Survived=1)), encoding="utf-8")
            ok = subprocess.run([sys.executable, script, f"A={path}"], capture_output=True, text=True)
            usage = subprocess.run([sys.executable, script], capture_output=True, text=True)

        self.assertEqual(ok.returncode, 0)
        self.assertIn("| A | 4 | 1 | 25.0% | 75.00% |", ok.stdout)
        self.assertEqual(usage.returncode, 2)


if __name__ == "__main__":
    unittest.main()
