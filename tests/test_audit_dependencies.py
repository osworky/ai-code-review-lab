import io
import json
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import audit_dependencies as ad  # noqa: E402

NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)


def npm_body(created="2015-01-01T00:00:00.000Z", versions=5, repository="git+https://github.com/x/y.git"):
    return {"time": {"created": created}, "versions": {f"1.0.{i}": {} for i in range(versions)}, "repository": {"url": repository}}


def pypi_body(uploads=("2019-05-01T10:00:00Z", "2020-01-01T10:00:00Z")):
    releases = {f"{i}.0": [{"upload_time_iso_8601": upload}] for i, upload in enumerate(uploads)}
    return {"releases": releases, "info": {"project_urls": {"Source": "https://github.com/x/y"}}}


def fake_registry(table):
    """Return a fetch function answering from a url -> (status, body) or Exception table."""

    def fetch(url):
        answer = table.get(url, (404, None))
        if isinstance(answer, Exception):
            raise answer
        return answer

    return fetch


class Parsing(unittest.TestCase):
    def test_package_json_reads_every_dependency_section(self):
        text = json.dumps(
            {
                "dependencies": {"next": "^16.0.0", "@radix-ui/react-slot": "1.2.4"},
                "devDependencies": {"vitest": "^3.0.0"},
                "optionalDependencies": {"fsevents": "*"},
            }
        )
        names = [(d.name, d.section) for d in ad.parse_package_json(text)]
        self.assertEqual(
            names,
            [
                ("next", "dependencies"),
                ("@radix-ui/react-slot", "dependencies"),
                ("vitest", "devDependencies"),
                ("fsevents", "optionalDependencies"),
            ],
        )

    def test_package_json_with_no_dependencies_is_empty(self):
        self.assertEqual(ad.parse_package_json("{}"), [])

    def test_package_json_rejects_a_malformed_section(self):
        with self.assertRaises(ValueError):
            ad.parse_package_json(json.dumps({"dependencies": ["next"]}))

    def test_requirements_handles_comments_extras_markers_and_pins(self):
        text = "\n".join(
            [
                "# runtime",
                "requests==2.31.0  # http client",
                "uvicorn[standard]>=0.30; python_version >= '3.10'",
                "Django_Rest.Framework",
                "",
                "-r other.txt",
                "git+https://github.com/x/y.git#egg=y",
            ]
        )
        found = [(d.name, d.spec, d.section) for d in ad.parse_requirements(text)]
        self.assertEqual(
            found,
            [
                ("requests", "==2.31.0", "requirements"),
                ("uvicorn", ">=0.30", "requirements"),
                ("Django_Rest.Framework", "", "requirements"),
                ("-r other.txt", "", "requirements-option"),
                ("git+https://github.com/x/y.git#egg=y", "", "requirements-url"),
            ],
        )

    def test_pypi_names_are_normalised_like_pep_503(self):
        self.assertEqual(ad.normalize_pypi_name("Django_Rest.Framework"), "django-rest-framework")


class RegistryUrls(unittest.TestCase):
    def test_npm_urls_encode_scoped_packages(self):
        self.assertEqual(ad.registry_url("npm", "next"), "https://registry.npmjs.org/next")
        self.assertEqual(ad.registry_url("npm", "@types/node"), "https://registry.npmjs.org/@types%2Fnode")

    def test_pypi_urls_use_the_normalised_name(self):
        self.assertEqual(
            ad.registry_url("pypi", "Django_Rest.Framework"), "https://pypi.org/pypi/django-rest-framework/json"
        )


class Auditing(unittest.TestCase):
    def audit_one(self, dependency, ecosystem, table, young_days=30):
        return ad.audit([dependency], ecosystem, fake_registry(table), now=NOW, young_days=young_days)[0]

    def test_an_invented_package_is_missing(self):
        # The course scenario: request_ai_utils does not exist and nobody noticed.
        result = self.audit_one(ad.Dependency("request_ai_utils", "", "requirements"), "pypi", {})
        self.assertEqual((result.status, result.exists), ("missing", False))

    def test_an_established_package_is_ok_and_carries_evidence(self):
        url = ad.registry_url("npm", "left-pad")
        result = self.audit_one(
            ad.Dependency("left-pad", "^1.0.0", "dependencies"), "npm", {url: (200, npm_body(versions=7))}
        )
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.versions, 7)
        self.assertEqual(result.first_published, "2015-01-01T00:00:00.000Z")
        self.assertEqual(result.repository, "git+https://github.com/x/y.git")

    def test_a_package_registered_days_ago_is_young_even_though_it_exists(self):
        # Existence alone is not enough: an attacker may already have registered the invented name.
        url = ad.registry_url("npm", "request-ai-utils")
        body = npm_body(created="2026-10-18T00:00:00.000Z", versions=1, repository=None)
        result = self.audit_one(ad.Dependency("request-ai-utils", "*", "dependencies"), "npm", {url: (200, body)})
        self.assertEqual((result.status, result.exists), ("young", True))
        self.assertIn("3 day(s) ago", result.reason)

    def test_the_young_threshold_is_configurable(self):
        url = ad.registry_url("npm", "pkg")
        body = npm_body(created="2026-09-01T00:00:00Z")
        dependency = ad.Dependency("pkg", "*", "dependencies")
        self.assertEqual(self.audit_one(dependency, "npm", {url: (200, body)}, young_days=30).status, "ok")
        self.assertEqual(self.audit_one(dependency, "npm", {url: (200, body)}, young_days=90).status, "young")

    def test_pypi_evidence_uses_the_earliest_upload(self):
        url = ad.registry_url("pypi", "requests")
        body = pypi_body(("2020-01-01T10:00:00Z", "2019-05-01T10:00:00Z"))
        result = self.audit_one(ad.Dependency("requests", "", "requirements"), "pypi", {url: (200, body)})
        self.assertEqual(result.first_published, "2019-05-01T10:00:00Z")
        self.assertEqual(result.versions, 2)
        self.assertEqual(result.repository, "https://github.com/x/y")

    def test_a_network_failure_is_unverified_never_missing(self):
        url = ad.registry_url("npm", "react")
        result = self.audit_one(ad.Dependency("react", "*", "dependencies"), "npm", {url: ad.FetchError("timeout")})
        self.assertEqual((result.status, result.exists), ("unverified", None))

    def test_an_unexpected_status_is_unverified(self):
        url = ad.registry_url("npm", "react")
        result = self.audit_one(ad.Dependency("react", "*", "dependencies"), "npm", {url: (500, None)})
        self.assertEqual(result.status, "unverified")

    def test_non_registry_sources_are_skipped_not_judged(self):
        specs = ["git+https://github.com/x/y.git", "file:../local", "workspace:*", "https://example.com/p.tgz", "github:x/y"]
        for spec in specs:
            with self.subTest(spec=spec):
                result = self.audit_one(ad.Dependency("thing", spec, "dependencies"), "npm", {})
                self.assertEqual(result.status, "skipped")


class ExitCodes(unittest.TestCase):
    def result(self, status):
        return ad.Result("p", "*", "dependencies", status, None)

    def test_matrix(self):
        cases = [
            (["ok", "ok"], False, 0),
            (["ok", "skipped"], False, 0),
            (["ok", "young"], False, 0),
            (["ok", "young"], True, 1),
            (["ok", "missing"], False, 1),
            (["unverified", "ok"], False, 3),
            (["missing", "unverified"], False, 1),
            ([], False, 0),
        ]
        for statuses, strict, expected in cases:
            with self.subTest(statuses=statuses, strict=strict):
                self.assertEqual(ad.exit_code([self.result(s) for s in statuses], strict), expected)


class CommandLine(unittest.TestCase):
    def run_main(self, argv, fetch):
        buffer = io.StringIO()
        with redirect_stdout(buffer), redirect_stderr(io.StringIO()):
            code = ad.main(["audit_dependencies.py", *argv], fetch=fetch)
        return code, buffer.getvalue()

    def test_reports_a_missing_dependency_and_writes_the_json(self):
        registry = fake_registry({ad.registry_url("npm", "next"): (200, npm_body())})
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp, "package.json")
            manifest.write_text(json.dumps({"dependencies": {"next": "^16", "request-ai-utils": "*"}}), encoding="utf-8")
            report = Path(tmp, "report.json")
            code, output = self.run_main(["npm", str(manifest), "--out", str(report)], registry)
            written = json.loads(report.read_text(encoding="utf-8"))

        self.assertEqual(code, 1)
        self.assertIn("MISSING request-ai-utils", output)
        self.assertEqual([r["package"] for r in written["results"]], ["next", "request-ai-utils"])
        self.assertEqual(written["results"][1]["exists"], False)

    def test_usage_errors_return_2(self):
        for argv in [[], ["npm"], ["gems", "x"], ["npm", "x", "--young-days", "abc"]]:
            with self.subTest(argv=argv):
                code, _ = self.run_main(argv, fake_registry({}))
                self.assertEqual(code, 2)


class HttpFetch(unittest.TestCase):
    """The real fetch is exercised with a mocked urlopen: tests never touch the network."""

    def test_404_means_the_package_does_not_exist(self):
        error = urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error):
            self.assertEqual(ad.http_fetch("https://registry.npmjs.org/nope"), (404, None))

    def test_other_http_errors_cannot_be_trusted(self):
        error = urllib.error.HTTPError("u", 503, "Unavailable", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error), self.assertRaises(ad.FetchError):
            ad.http_fetch("https://registry.npmjs.org/x")

    def test_network_failures_are_fetch_errors(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            with self.assertRaises(ad.FetchError):
                ad.http_fetch("https://registry.npmjs.org/x")


if __name__ == "__main__":
    unittest.main()
