"""Audit a dependency manifest against the real package registry.

    py scripts/audit_dependencies.py npm package.json [--out report.json] [--young-days 30] [--strict]
    py scripts/audit_dependencies.py pypi requirements.txt [--out report.json]

The registry, not a model, decides whether a package exists. For packages that do exist the script
exposes metadata as evidence (first publication date, number of versions, linked repository), because
checking existence alone is not enough once an attacker has registered an invented name.

Exit codes:
  0  every dependency exists (young packages are reported as warnings unless --strict)
  1  at least one dependency does not exist (or is young, with --strict)
  2  usage error
  3  nothing was proven missing, but some dependencies could not be checked (network or registry error)
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

NPM_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
NON_REGISTRY_SPEC = re.compile(r"^(git[+:]|git@|https?:|file:|link:|workspace:|github:|npm:|\.{0,2}/)")


class FetchError(Exception):
    """The registry could not be queried (network failure, timeout, unexpected status)."""


# fetch(url) -> (http status, parsed JSON body or None); raises FetchError when the answer cannot be trusted.
Fetch = Callable[[str], "tuple[int, dict | None]"]


@dataclass(frozen=True)
class Dependency:
    name: str
    spec: str
    section: str


@dataclass(frozen=True)
class Result:
    package: str
    spec: str
    section: str
    status: str  # ok | missing | young | unverified | skipped
    exists: bool | None
    first_published: str | None = None
    versions: int | None = None
    repository: str | None = None
    reason: str | None = None


def parse_package_json(text: str) -> list[Dependency]:
    data = json.loads(text)
    dependencies: list[Dependency] = []
    for section in NPM_SECTIONS:
        entries = data.get(section) or {}
        if not isinstance(entries, dict):
            raise ValueError(f'"{section}" must be an object')
        dependencies += [Dependency(name, str(spec), section) for name, spec in entries.items()]
    return dependencies


def normalize_pypi_name(name: str) -> str:
    """PEP 503 normalisation."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_requirements(text: str) -> list[Dependency]:
    dependencies: list[Dependency] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        line = raw.split(" #")[0].strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("-r", "-c", "--", "-e", "-f", "-i")):
            dependencies.append(Dependency(line, "", "requirements-option"))
            continue
        if re.match(r"^(git\+|https?://|file:|\.{0,2}/)", line):
            dependencies.append(Dependency(line, "", "requirements-url"))
            continue
        match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([^;]*)", line)
        if match:
            dependencies.append(Dependency(match.group(1), match.group(3).strip(), "requirements"))
    return dependencies


def _age_in_days(first_published: str | None, now: datetime) -> int | None:
    if not first_published:
        return None
    try:
        published = datetime.fromisoformat(first_published.replace("Z", "+00:00"))
    except ValueError:
        return None
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return (now - published).days


def _repository_url(value: object) -> str | None:
    if isinstance(value, dict):
        value = value.get("url")
    return value if isinstance(value, str) and value else None


def _npm_evidence(body: dict) -> tuple[str | None, int | None, str | None]:
    times = body.get("time") or {}
    versions = body.get("versions") or {}
    return times.get("created"), len(versions), _repository_url(body.get("repository"))


def _pypi_evidence(body: dict) -> tuple[str | None, int | None, str | None]:
    releases = body.get("releases") or {}
    uploads = sorted(
        file["upload_time_iso_8601"]
        for files in releases.values()
        for file in files
        if isinstance(file, dict) and file.get("upload_time_iso_8601")
    )
    urls = (body.get("info") or {}).get("project_urls") or {}
    repository = next((u for k, u in urls.items() if k.lower() in {"source", "repository", "homepage", "source code"}), None)
    return (uploads[0] if uploads else None), len(releases), repository


def registry_url(ecosystem: str, name: str) -> str:
    if ecosystem == "npm":
        return "https://registry.npmjs.org/" + urllib.parse.quote(name, safe="@").replace("/", "%2F")
    return f"https://pypi.org/pypi/{urllib.parse.quote(normalize_pypi_name(name))}/json"


def audit_dependency(
    dependency: Dependency, ecosystem: str, fetch: Fetch, now: datetime, young_days: int
) -> Result:
    base = dict(package=dependency.name, spec=dependency.spec, section=dependency.section)

    if dependency.section in {"requirements-option", "requirements-url"} or NON_REGISTRY_SPEC.match(dependency.spec):
        return Result(**base, status="skipped", exists=None, reason="not resolved from the registry by name")

    try:
        status, body = fetch(registry_url(ecosystem, dependency.name))
    except FetchError as error:
        return Result(**base, status="unverified", exists=None, reason=str(error))

    if status == 404:
        return Result(**base, status="missing", exists=False, reason="the registry has no package with this name")
    if status != 200 or body is None:
        return Result(**base, status="unverified", exists=None, reason=f"unexpected registry answer: HTTP {status}")

    first_published, versions, repository = (_npm_evidence if ecosystem == "npm" else _pypi_evidence)(body)
    age = _age_in_days(first_published, now)
    if age is not None and age < young_days:
        return Result(
            **base,
            status="young",
            exists=True,
            first_published=first_published,
            versions=versions,
            repository=repository,
            reason=f"first published {age} day(s) ago (threshold: {young_days})",
        )
    return Result(
        **base, status="ok", exists=True, first_published=first_published, versions=versions, repository=repository
    )


def audit(
    dependencies: list[Dependency], ecosystem: str, fetch: Fetch, now: datetime | None = None, young_days: int = 30
) -> list[Result]:
    moment = now or datetime.now(timezone.utc)
    return [audit_dependency(dependency, ecosystem, fetch, moment, young_days) for dependency in dependencies]


def exit_code(results: list[Result], strict: bool = False) -> int:
    if any(r.status == "missing" for r in results):
        return 1
    if strict and any(r.status == "young" for r in results):
        return 1
    if any(r.status == "unverified" for r in results):
        return 3
    return 0


def http_fetch(url: str) -> tuple[int, dict | None]:
    request = urllib.request.Request(url, headers={"User-Agent": "ai-qa-lab-dependency-audit/1", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return 404, None
        raise FetchError(f"registry answered HTTP {error.code}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        raise FetchError(f"could not query the registry: {error}") from error


def render_summary(results: list[Result]) -> str:
    counts: dict[str, int] = {}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    lines = [f"{len(results)} dependencies: " + ", ".join(f"{n} {s}" for s, n in sorted(counts.items()))]
    for result in results:
        if result.status not in {"ok"}:
            lines.append(f"- {result.status.upper()} {result.package} ({result.section}): {result.reason}")
    return "\n".join(lines)


def main(argv: list[str], fetch: Fetch = http_fetch) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv[1:]
    out: str | None = None
    young_days = 30
    strict = False
    try:
        if "--out" in args:
            i = args.index("--out")
            out = args[i + 1]
            del args[i : i + 2]
        if "--young-days" in args:
            i = args.index("--young-days")
            young_days = int(args[i + 1])
            del args[i : i + 2]
    except (IndexError, ValueError):
        args = []
    if "--strict" in args:
        strict = True
        args.remove("--strict")

    if len(args) != 2 or args[0] not in {"npm", "pypi"}:
        print("usage: audit_dependencies.py npm|pypi <manifest> [--out report.json] [--young-days N] [--strict]", file=sys.stderr)
        return 2

    ecosystem, manifest = args
    text = Path(manifest).read_text(encoding="utf-8")
    dependencies = parse_package_json(text) if ecosystem == "npm" else parse_requirements(text)
    results = audit(dependencies, ecosystem, fetch, young_days=young_days)

    report = {"ecosystem": ecosystem, "manifest": manifest, "results": [asdict(r) for r in results]}
    if out:
        Path(out).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(render_summary(results))
    return exit_code(results, strict)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
