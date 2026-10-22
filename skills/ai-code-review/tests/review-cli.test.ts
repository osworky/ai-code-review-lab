import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

// The command line of the review procedure with real git, in a temporary repository: prepare, merge and check.

const CLI = path.resolve(__dirname, "..", "scripts", "cli.mjs")
let repo: string

const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } })
const git = (...args: string[]) => {
  const result = run("git", args)
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout
}
const cli = (...args: string[]) => run("node", [CLI, ...args])
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), text)
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "review-cli-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "Test")
  write("lib/a.ts", "export const a = 1\nexport const b = 2\n")
  git("add", ".")
  git("commit", "-q", "-m", "base")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  git("checkout", "-q", "-b", "feature/x")
  write("lib/a.ts", "export const a = 1\nexport const b = 3\nexport const c = 4\n")
  write("scripts/s.py", "import os\nprint(os.name)\n")
  git("add", ".")
  git("commit", "-q", "-m", "change")
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

const review = (findings: unknown[]) => JSON.stringify({ schema_version: 1, findings })
const finding = (file: string, line: number, overrides: Record<string, unknown> = {}) => ({
  rule_id: "magic-number",
  category: "style",
  severity: "advisory",
  location: { file, line },
  message: "Valor sin nombre.",
  suggested_fix: "Darle un nombre.",
  ...overrides,
})

describe("prepare", () => {
  it("splits the branch diff by reviewer and writes the annotated diffs and the plan", () => {
    // Arrange / Act
    const result = cli("prepare", "--base", "origin/main", "--model", "test-model")

    // Assert
    expect(result.status).toBe(0)
    const plan = JSON.parse(fs.readFileSync(path.join(repo, ".review-work", "plan.json"), "utf8"))
    expect(plan.route).toBe("small")
    expect(Object.keys(plan.buckets).sort()).toEqual(["python", "typescript"])
    expect(plan.slug).toBe("feature-x")
    expect(fs.readFileSync(path.join(repo, ".review-work", "typescript.diff"), "utf8")).toMatch(/^ {4}2\| \+export const b = 3$/m)
  })

  it("says nothing is needed when only documentation changed", () => {
    // Arrange
    git("checkout", "-q", "-b", "docs-only", "origin/main")
    write("docs/x.md", "# x\n")
    git("add", ".")
    git("commit", "-q", "-m", "docs")

    // Act
    const result = cli("prepare", "--base", "origin/main")

    // Assert
    expect(result.status).toBe(0)
    expect(JSON.parse(fs.readFileSync(path.join(repo, ".review-work", "plan.json"), "utf8"))).toMatchObject({ route: "docs", needsReview: false })
  })
})

describe("merge", () => {
  it("validates each bucket, joins them and writes the review and its meta file", () => {
    // Arrange
    cli("prepare", "--base", "origin/main", "--model", "test-model")
    write(".review-work/typescript.review.json", review([finding("lib/a.ts", 2)]))
    write(".review-work/python.review.json", review([finding("scripts/s.py", 1, { rule_id: "other-rule" })]))

    // Act
    const result = cli("merge", "--model", "test-model")

    // Assert
    expect(result.status).toBe(0)
    const merged = JSON.parse(fs.readFileSync(path.join(repo, ".ai-review/reviews/feature-x.json"), "utf8"))
    const meta = JSON.parse(fs.readFileSync(path.join(repo, ".ai-review/reviews/feature-x.meta.json"), "utf8"))
    expect(merged.findings).toHaveLength(2)
    expect(meta).toMatchObject({ complete: true, model: "test-model", route: "small" })
    expect(meta.buckets).toEqual({ typescript: { status: "valid", findings: 1 }, python: { status: "valid", findings: 1 } })
  })

  it("fails and writes nothing when a bucket is missing or invalid", () => {
    // Arrange
    cli("prepare", "--base", "origin/main")
    write(".review-work/typescript.review.json", review([finding("lib/a.ts", 99)])) // line outside the diff

    // Act
    const result = cli("merge")

    // Assert
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("typescript: invalid")
    expect(result.stdout).toContain("python: missing")
    expect(fs.existsSync(path.join(repo, ".ai-review/reviews/feature-x.json"))).toBe(false)
  })

  it("writes a partial review only when asked to, marking it incomplete", () => {
    // Arrange
    cli("prepare", "--base", "origin/main")
    write(".review-work/typescript.review.json", review([finding("lib/a.ts", 2)]))

    // Act
    const result = cli("merge", "--allow-partial")

    // Assert
    expect(result.status).toBe(0)
    expect(JSON.parse(fs.readFileSync(path.join(repo, ".ai-review/reviews/feature-x.meta.json"), "utf8")).complete).toBe(false)
  })

  it("prepare then reports the review as cached while nothing changed", () => {
    // Arrange: a complete review of the branch exists, committed with it
    cli("prepare", "--base", "origin/main", "--model", "m")
    write(".review-work/typescript.review.json", review([]))
    write(".review-work/python.review.json", review([]))
    cli("merge", "--model", "m")
    git("add", ".ai-review/reviews")
    git("commit", "-q", "-m", "review")

    // Act
    const again = cli("prepare", "--base", "origin/main", "--model", "m")

    // Assert
    expect(again.stdout).toContain("cached")
    expect(JSON.parse(fs.readFileSync(path.join(repo, ".review-work", "plan.json"), "utf8")).cached).toBe(true)
  })
})

describe("check", () => {
  it("asks for a review when the branch changes code and has none", () => {
    // Arrange / Act
    const result = cli("check", "--base", "origin/main")

    // Assert
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("no trae revisión adjunta")
  })

  it("validates the review that travels with the branch and does not block in the advisory phase", () => {
    // Arrange
    cli("prepare", "--base", "origin/main", "--model", "m")
    write(".review-work/typescript.review.json", review([finding("lib/a.ts", 2, { severity: "blocker", rule_id: "leak", category: "security" })]))
    write(".review-work/python.review.json", review([]))
    cli("merge", "--model", "m")
    git("add", ".ai-review/reviews")
    git("commit", "-q", "-m", "review")

    // Act
    const result = cli("check", "--base", "origin/main")

    // Assert
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No bloquea")
    expect(result.stdout).toContain("`lib/a.ts:2`")
    expect(result.stdout).not.toContain("desactualizada")
  })

  it("flags the review as outdated when the code changes after it", () => {
    // Arrange
    cli("prepare", "--base", "origin/main", "--model", "m")
    write(".review-work/typescript.review.json", review([]))
    write(".review-work/python.review.json", review([]))
    cli("merge", "--model", "m")
    git("add", ".ai-review/reviews")
    git("commit", "-q", "-m", "review")
    write("lib/a.ts", "export const a = 1\nexport const b = 9\nexport const c = 4\n")
    git("add", ".")
    git("commit", "-q", "-m", "later change")

    // Act
    const result = cli("check", "--base", "origin/main")

    // Assert
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("desactualizada")
  })

  it("blocks in the extended phase when the review has a blocker", () => {
    // Arrange
    cli("prepare", "--base", "origin/main", "--model", "m")
    write(".review-work/typescript.review.json", review([finding("lib/a.ts", 2, { severity: "blocker", rule_id: "leak", category: "security" })]))
    write(".review-work/python.review.json", review([]))
    cli("merge", "--model", "m")
    git("add", ".ai-review/reviews")
    git("commit", "-q", "-m", "review")

    // Act
    const result = cli("check", "--base", "origin/main", "--phase", "extended")

    // Assert
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("bloqueado")
  })

  it("writes the summary to the file it is given", () => {
    // Arrange
    const target = path.join(repo, "summary.md")

    // Act
    cli("check", "--base", "origin/main", "--summary", target)

    // Assert
    expect(fs.readFileSync(target, "utf8")).toContain("Revisión automática del PR")
  })
})

describe("usage", () => {
  it("fails with a usage message for an unknown command", () => {
    const result = cli("nope")
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("usage")
  })
})
