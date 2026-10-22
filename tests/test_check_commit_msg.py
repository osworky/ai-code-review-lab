import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from check_commit_msg import check_message, check_subject  # noqa: E402

SCRIPT = str(ROOT / "scripts" / "check_commit_msg.py")


class Subjects(unittest.TestCase):
    def test_accepts_conventional_subjects(self):
        for subject in [
            "feat: add router",
            "feat(scripts): add mutation comparison table",
            "fix(validator)!: reject boolean line numbers",
            "docs: explain the rubric",
            "chore(qa): freeze quote.ts as SUT",
            "test(review): cover the broken-output case",
            "revert: undo the shadow workflow",
        ]:
            with self.subTest(subject=subject):
                self.assertEqual(check_subject(subject), [])

    def test_rejects_non_conventional_subjects(self):
        for subject in [
            "WIP: seeded defects",
            "Estructura inicial del laboratorio",
            "feat add router",
            "feature: add router",
            "feat(Scripts): uppercase scope",
            "feat: ",
            "feat:no space",
            "",
        ]:
            with self.subTest(subject=subject):
                self.assertTrue(check_subject(subject))

    def test_rejects_a_trailing_period_and_an_overlong_subject(self):
        self.assertIn("period", check_subject("feat: add router.")[0])
        self.assertIn("limit", check_subject("feat: " + "x" * 80)[0])

    def test_accepts_subjects_generated_by_git(self):
        for subject in ["Merge branch 'main' into feature", 'Revert "feat: add router"', "fixup! feat: add router"]:
            with self.subTest(subject=subject):
                self.assertEqual(check_subject(subject), [])


class Messages(unittest.TestCase):
    def test_requires_a_blank_line_before_the_body(self):
        self.assertTrue(check_message("feat: add router\nbody right away"))
        self.assertEqual(check_message("feat: add router\n\nbody after a blank line"), [])

    def test_ignores_comment_lines_added_by_git(self):
        self.assertEqual(check_message("# Please enter the commit message\nfeat: add router\n"), [])

    def test_rejects_an_empty_message(self):
        self.assertEqual(check_message("\n  \n# only comments"), ["commit message is empty"])

    def test_accepts_a_body_with_trailers(self):
        message = "feat(prompts): add tour prompt\n\nCovers the legacy audit step.\n\nCo-Authored-By: Someone <a@b.c>\n"
        self.assertEqual(check_message(message), [])


class CommandLine(unittest.TestCase):
    def test_message_file_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            good, bad = Path(tmp, "good"), Path(tmp, "bad")
            good.write_text("feat: add router\n", encoding="utf-8")
            bad.write_text("added a router\n", encoding="utf-8")
            ok = subprocess.run([sys.executable, SCRIPT, str(good)], capture_output=True, text=True)
            broken = subprocess.run([sys.executable, SCRIPT, str(bad)], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        self.assertEqual(broken.returncode, 1)
        self.assertIn("not a Conventional Commit", broken.stderr)

    def test_stdin_mode_reports_every_bad_subject(self):
        result = subprocess.run(
            [sys.executable, SCRIPT, "--stdin"],
            input="feat: ok\nWIP stuff\nfix: also ok\nadded things\n",
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("2 commit(s) are not conventional", result.stderr)

    def test_stdin_mode_passes_when_all_are_conventional(self):
        result = subprocess.run(
            [sys.executable, SCRIPT, "--stdin"], input="feat: ok\nfix(x): ok\n", capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
