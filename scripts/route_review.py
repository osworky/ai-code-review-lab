"""Decide how a pull request should be reviewed, before any model is called.

    py scripts/route_review.py diff.patch --prompt-version v2 --schema-version 1 --model <id>
                               [--config config/routing.json]

Everything here is deterministic: the same diff and settings always give the same decision.
It answers, without a model:
  - which files changed and of what kind (docs, code, infra, other)
  - which route the PR takes: skip | docs | small | large | over_budget
  - a hash of the diff and a cache key that also covers the prompt, schema and model, so a changed
    prompt or model never reuses an old verdict
  - a rough token estimate (characters / 4) to enforce a budget cap

Which model each route uses is NOT decided here: the output names an environment variable per route,
and people set its value. Exit code: 0 on success, 2 on usage errors.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

DEFAULT_CONFIG = {
    "large_changed_lines": 200,
    "max_diff_chars": 120_000,
    "chars_per_token": 4,
    "extensions": {
        "docs": [".md", ".mdx", ".txt", ".rst"],
        "code": [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".sql"],
        "infra": [".yml", ".yaml", ".tf", ".toml", ".dockerfile"],
    },
    "model_variables": {
        "docs": "REVIEW_MODEL_DOCS",
        "small": "REVIEW_MODEL_SMALL",
        "large": "REVIEW_MODEL_LARGE",
    },
}


@dataclass
class ChangedFile:
    path: str
    kind: str = "other"
    added: int = 0
    removed: int = 0
    binary: bool = False

    @property
    def changed(self) -> int:
        return self.added + self.removed


@dataclass
class Diff:
    files: list[ChangedFile] = field(default_factory=list)


def classify(path: str, extensions: dict[str, list[str]]) -> str:
    name = PurePosixPath(path).name.lower()
    suffix = PurePosixPath(path).suffix.lower()
    if name == "dockerfile":
        return "infra"
    for kind, suffixes in extensions.items():
        if suffix in suffixes:
            return kind
    return "other"


def parse_diff(text: str, extensions: dict[str, list[str]]) -> Diff:
    diff = Diff()
    current: ChangedFile | None = None
    in_hunk = False
    for line in text.replace("\r\n", "\n").split("\n"):
        header = re.match(r"^diff --git a/(.+) b/(.+)$", line)
        if header:
            current = ChangedFile(path=header.group(2))
            current.kind = classify(current.path, extensions)
            diff.files.append(current)
            in_hunk = False
            continue
        if current is None:
            continue
        if line.startswith("Binary files "):
            current.binary = True
        elif line.startswith("@@"):
            in_hunk = True
        elif in_hunk and line.startswith("+") and not line.startswith("+++"):
            current.added += 1
        elif in_hunk and line.startswith("-") and not line.startswith("---"):
            current.removed += 1
    return diff


def normalize_diff(text: str) -> str:
    """Drop what changes without the content changing: line endings and blob hashes."""
    kept = [
        line
        for line in text.replace("\r\n", "\n").split("\n")
        if not line.startswith(("index ", "similarity index", "rename from", "rename to"))
    ]
    return "\n".join(kept).strip() + "\n"


def diff_hash(text: str) -> str:
    return hashlib.sha256(normalize_diff(text).encode("utf-8")).hexdigest()


def cache_key(diff_digest: str, prompt_version: str, schema_version: str, model: str, params: str = "") -> str:
    """A cached verdict is reusable only if the diff, prompt, schema, model and parameters all match."""
    material = "\x1f".join([diff_digest, prompt_version, schema_version, model, params])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def route(diff: Diff, config: dict, estimated_tokens: int, max_tokens: int) -> tuple[str, str]:
    if not diff.files:
        return "skip", "the diff changes no files"
    if estimated_tokens > max_tokens:
        return "over_budget", f"about {estimated_tokens} tokens exceed the {max_tokens} budget"
    if all(f.kind == "docs" for f in diff.files):
        return "docs", "only documentation changed"
    changed = sum(f.changed for f in diff.files if f.kind != "docs")
    if changed >= config["large_changed_lines"]:
        return "large", f"{changed} changed lines in code or other files (threshold {config['large_changed_lines']})"
    return "small", f"{changed} changed lines in code or other files (threshold {config['large_changed_lines']})"


def decide(diff_text: str, prompt_version: str, schema_version: str, model: str, config: dict | None = None, params: str = "") -> dict:
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    diff = parse_diff(diff_text, cfg["extensions"])
    digest = diff_hash(diff_text)
    estimated_tokens = -(-len(normalize_diff(diff_text)) // cfg["chars_per_token"])
    max_tokens = cfg["max_diff_chars"] // cfg["chars_per_token"]
    chosen, reason = route(diff, cfg, estimated_tokens, max_tokens)
    kinds: dict[str, int] = {}
    for item in diff.files:
        kinds[item.kind] = kinds.get(item.kind, 0) + 1
    return {
        "route": chosen,
        "reason": reason,
        "model_variable": cfg["model_variables"].get(chosen),
        "diff_hash": digest,
        "cache_key": cache_key(digest, prompt_version, schema_version, model, params),
        "estimated_tokens": estimated_tokens,
        "token_estimate_is_a_heuristic": True,
        "files": [
            {"path": f.path, "kind": f.kind, "added": f.added, "removed": f.removed, "binary": f.binary} for f in diff.files
        ],
        "kinds": kinds,
        "changed_lines": sum(f.changed for f in diff.files),
    }


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv[1:]
    options = {"--prompt-version": None, "--schema-version": None, "--model": None, "--config": None, "--params": ""}
    try:
        for name in options:
            if name in args:
                i = args.index(name)
                options[name] = args[i + 1]
                del args[i : i + 2]
    except IndexError:
        args = []
    if len(args) != 1 or not all(options[k] for k in ["--prompt-version", "--schema-version", "--model"]):
        print("usage: route_review.py diff.patch --prompt-version V --schema-version N --model ID [--config file] [--params text]", file=sys.stderr)
        return 2
    config = json.loads(Path(options["--config"]).read_text(encoding="utf-8")) if options["--config"] else None
    decision = decide(
        Path(args[0]).read_text(encoding="utf-8"),
        options["--prompt-version"],
        options["--schema-version"],
        options["--model"],
        config,
        options["--params"],
    )
    print(json.dumps(decision, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
