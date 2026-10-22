import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import route_review as rr  # noqa: E402

SCRIPT = str(ROOT / "scripts" / "route_review.py")


def file_diff(path, added=1, removed=0, index="index 1111111..2222222 100644"):
    body = "".join(f"+line {i}\n" for i in range(added)) + "".join(f"-old {i}\n" for i in range(removed))
    return (
        f"diff --git a/{path} b/{path}\n{index}\n--- a/{path}\n+++ b/{path}\n"
        f"@@ -1,{removed} +1,{added} @@\n{body}"
    )


def decide(diff, **kwargs):
    defaults = dict(prompt_version="v2", schema_version="1", model="model-a")
    return rr.decide(diff, **{**defaults, **kwargs})


class Routing(unittest.TestCase):
    def test_an_empty_diff_is_skipped(self):
        self.assertEqual(decide("")["route"], "skip")

    def test_only_documentation_goes_to_the_docs_route(self):
        result = decide(file_diff("README.md", 40) + file_diff("docs/guide.md", 5))
        self.assertEqual(result["route"], "docs")
        self.assertEqual(result["model_variable"], "REVIEW_MODEL_DOCS")

    def test_a_small_code_change_goes_to_the_small_route(self):
        result = decide(file_diff("lib/quote.ts", 20, 5))
        self.assertEqual((result["route"], result["model_variable"]), ("small", "REVIEW_MODEL_SMALL"))

    def test_the_large_threshold_is_inclusive(self):
        self.assertEqual(decide(file_diff("a.py", 199))["route"], "small")
        self.assertEqual(decide(file_diff("a.py", 200))["route"], "large")
        self.assertEqual(decide(file_diff("a.py", 150, 50))["route"], "large")

    def test_a_large_documentation_change_does_not_make_a_code_change_large(self):
        result = decide(file_diff("docs/big.md", 900) + file_diff("lib/a.ts", 10))
        self.assertEqual(result["route"], "small")

    def test_mixed_docs_and_code_is_never_the_docs_route(self):
        self.assertNotEqual(decide(file_diff("README.md") + file_diff("a.ts"))["route"], "docs")

    def test_unknown_file_types_count_as_code_for_size(self):
        self.assertEqual(decide(file_diff("data.bin", 250))["route"], "large")

    def test_a_diff_over_budget_is_not_sent_whole(self):
        result = decide(file_diff("a.ts", 5), config={"max_diff_chars": 40})
        self.assertEqual(result["route"], "over_budget")
        self.assertIsNone(result["model_variable"])

    def test_workflow_files_are_infra(self):
        result = decide(file_diff(".github/workflows/ci.yml", 3) + file_diff("Dockerfile", 2))
        self.assertEqual(result["kinds"], {"infra": 2})

    def test_counts_added_and_removed_lines_per_file(self):
        result = decide(file_diff("a.ts", 7, 3))
        self.assertEqual(result["files"][0]["added"], 7)
        self.assertEqual(result["files"][0]["removed"], 3)
        self.assertEqual(result["changed_lines"], 10)

    def test_file_headers_are_not_counted_as_changed_lines(self):
        result = decide(file_diff("a.ts", 1, 1))
        self.assertEqual(result["changed_lines"], 2)

    def test_a_binary_file_is_flagged(self):
        diff = "diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ\n"
        self.assertTrue(decide(diff)["files"][0]["binary"])


class HashAndCache(unittest.TestCase):
    base = file_diff("a.ts", 3)

    def test_the_hash_ignores_line_endings_and_blob_ids(self):
        crlf = self.base.replace("\n", "\r\n")
        other_blobs = file_diff("a.ts", 3, index="index 9999999..8888888 100644")
        self.assertEqual(rr.diff_hash(self.base), rr.diff_hash(crlf))
        self.assertEqual(rr.diff_hash(self.base), rr.diff_hash(other_blobs))

    def test_the_hash_changes_when_the_content_changes(self):
        self.assertNotEqual(rr.diff_hash(self.base), rr.diff_hash(file_diff("a.ts", 4)))
        self.assertNotEqual(rr.diff_hash(self.base), rr.diff_hash(file_diff("b.ts", 3)))

    def test_the_same_inputs_give_the_same_cache_key(self):
        self.assertEqual(decide(self.base)["cache_key"], decide(self.base)["cache_key"])

    def test_a_changed_prompt_schema_model_or_params_invalidates_the_cache(self):
        baseline = decide(self.base)["cache_key"]
        for change in [
            dict(prompt_version="v3"),
            dict(schema_version="2"),
            dict(model="model-b"),
            dict(params="temperature=0,seed=7"),
        ]:
            with self.subTest(change=change):
                self.assertNotEqual(decide(self.base, **change)["cache_key"], baseline)

    def test_a_cosmetic_diff_difference_keeps_the_same_cache_key(self):
        crlf = self.base.replace("\n", "\r\n")
        self.assertEqual(decide(self.base)["cache_key"], decide(crlf)["cache_key"])

    def test_key_fields_cannot_be_confused_by_concatenation(self):
        self.assertNotEqual(rr.cache_key("d", "ab", "c", "m"), rr.cache_key("d", "a", "bc", "m"))


class Configuration(unittest.TestCase):
    def test_the_shipped_config_matches_the_built_in_defaults(self):
        shipped = json.loads((ROOT / "config" / "routing.json").read_text(encoding="utf-8"))
        self.assertEqual(shipped, rr.DEFAULT_CONFIG)

    def test_the_token_estimate_is_labelled_as_a_heuristic(self):
        self.assertTrue(decide(file_diff("a.ts"))["token_estimate_is_a_heuristic"])


class CommandLine(unittest.TestCase):
    def test_prints_the_decision_as_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "d.patch")
            path.write_text(file_diff("a.ts", 5), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, SCRIPT, str(path), "--prompt-version", "v2", "--schema-version", "1", "--model", "m"],
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["route"], "small")

    def test_missing_arguments_return_2(self):
        for argv in [[], ["x.patch"], ["x.patch", "--prompt-version", "v2"]]:
            with self.subTest(argv=argv):
                self.assertEqual(subprocess.run([sys.executable, SCRIPT, *argv], capture_output=True, text=True).returncode, 2)

    @unittest.skipUnless((ROOT / "experiments" / "reviewer-seeded" / "runs" / "seeded-diff.patch").exists(), "the recorded run is private evidence that is not published")
    def test_the_recorded_seeded_diff_is_a_small_code_review(self):
        diff = (ROOT / "experiments" / "reviewer-seeded" / "runs" / "seeded-diff.patch").read_text(encoding="utf-8")
        result = decide(diff)
        self.assertEqual(result["route"], "small")
        self.assertEqual(result["kinds"], {"code": 4})


if __name__ == "__main__":
    unittest.main()
