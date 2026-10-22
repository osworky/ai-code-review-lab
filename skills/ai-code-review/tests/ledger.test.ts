import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  MIN_ROWS,
  auditEvent,
  buildReport,
  findingId,
  foldLedger,
  missedEvent,
  readEvents,
  recordReview,
  renderReport,
  resolutionEvent,
  wilson,
} from "../scripts/ledger.mjs"

// The ledger turns every review into rows: what the reviewer said, what a person decided and what it missed.

const finding = (overrides: Record<string, unknown> = {}) => ({
  rule_id: "magic-number",
  category: "style",
  severity: "advisory",
  location: { file: "lib/a.ts", line: 2 },
  message: "Valor sin nombre.",
  suggested_fix: "Darle un nombre.",
  ...overrides,
})
const meta = { diffHash: "d1", promptHash: "p1", model: "test-model" }

describe("wilson interval", () => {
  it("is empty for no rows and keeps its bounds inside 0 and 1", () => {
    expect(wilson(0, 0)).toEqual([0, 0])
    const [low, high] = wilson(25, 25)
    expect(high).toBe(1)
    expect(low).toBeGreaterThan(0.8)
  })

  it("matches the interval printed in the lab thermometers for 50 of 63", () => {
    // Arrange / Act
    const [low, high] = wilson(50, 63)

    // Assert
    expect(Math.round(low * 100)).toBe(68)
    expect(Math.round(high * 100)).toBe(88)
  })
})

describe("recordReview", () => {
  it("turns each finding into a row with a stable id and the versions that produced it", () => {
    // Arrange / Act
    const { added, skipped } = recordReview({ events: [], slug: "feat-x", meta, review: { findings: [finding(), finding({ rule_id: "other", location: { file: "lib/b.ts", line: 9 } })] }, at: "2026-01-01T00:00:00Z" })

    // Assert
    expect(skipped).toBe(false)
    expect(added).toHaveLength(2)
    expect(added[0]).toMatchObject({ type: "finding", slug: "feat-x", diffHash: "d1", promptHash: "p1", model: "test-model", category: "style", file: "lib/a.ts", line: 2 })
    expect(added[0].id).toBe(findingId("feat-x", "d1", finding()))
    expect(added[0].id).not.toBe(added[1].id)
  })

  it("does not record the same review of the same diff twice, but records a new diff of the same branch", () => {
    // Arrange
    const first = recordReview({ events: [], slug: "feat-x", meta, review: { findings: [finding()] } })

    // Act
    const again = recordReview({ events: first.added, slug: "feat-x", meta, review: { findings: [finding()] } })
    const newDiff = recordReview({ events: first.added, slug: "feat-x", meta: { ...meta, diffHash: "d2" }, review: { findings: [finding()] } })

    // Assert
    expect(again).toEqual({ added: [], skipped: true })
    expect(newDiff.skipped).toBe(false)
    expect(newDiff.added).toHaveLength(1)
  })

  it("keeps only the first 300 characters of a message", () => {
    const { added } = recordReview({ events: [], slug: "s", meta, review: { findings: [finding({ message: "x".repeat(500) })] } })
    expect(added[0].message).toHaveLength(300)
  })
})

describe("resolving findings", () => {
  const events = recordReview({ events: [], slug: "feat-x", meta, review: { findings: [finding()] } }).added

  it("accepts an id prefix and only the labels A, M and R", () => {
    // Arrange / Act
    const event = resolutionEvent({ events, id: events[0].id.slice(0, 4), label: "A", note: "se corrigió" })

    // Assert
    expect(event).toMatchObject({ type: "resolution", id: events[0].id, label: "A", note: "se corrigió" })
    expect(() => resolutionEvent({ events, id: events[0].id, label: "X" })).toThrow("--label must be one of A, M, R")
  })

  it("refuses an id that is not in the ledger", () => {
    expect(() => resolutionEvent({ events, id: "zzzz", label: "A" })).toThrow('no finding with id "zzzz"')
  })

  it("refuses a prefix that matches two findings", () => {
    // Arrange
    const two = recordReview({ events: [], slug: "s", meta, review: { findings: [finding(), finding({ rule_id: "other" })] } }).added

    // Act / Assert: an empty prefix matches every finding
    expect(() => resolutionEvent({ events: two, id: "", label: "A" })).toThrow("matches 2 findings")
  })

  it("the last label wins when someone changes their mind", () => {
    // Arrange
    const all = [...events, resolutionEvent({ events, id: events[0].id, label: "R" }), resolutionEvent({ events, id: events[0].id, label: "M" })]

    // Act
    const state = foldLedger(all)

    // Assert
    expect(state.findings[0].label).toBe("M")
  })
})

describe("missed defects and audits", () => {
  it("needs a known category, a note and a known source", () => {
    expect(missedEvent({ category: "security", note: "no vio la inyección", slug: "feat-x", source: "audit_sample" })).toMatchObject({ type: "missed", category: "security", source: "audit_sample" })
    expect(() => missedEvent({ category: "nope", note: "x" })).toThrow("--category must be one of")
    expect(() => missedEvent({ category: "security", note: "  " })).toThrow("--note must say")
    expect(() => missedEvent({ category: "security", note: "x", source: "guess" })).toThrow("--source must be")
  })

  it("an audit needs the slug", () => {
    expect(auditEvent({ slug: "feat-x" })).toMatchObject({ type: "audit", slug: "feat-x" })
    expect(() => auditEvent({ slug: "" })).toThrow("--slug is required")
  })
})

describe("report", () => {
  /** n findings of one category, all with the same label. */
  const rows = (category: string, label: string, n: number, slug = "s") => {
    const added = recordReview({
      events: [],
      slug,
      meta: { ...meta, diffHash: `${category}-${label}-${slug}` },
      review: { findings: Array.from({ length: n }, (_, i) => finding({ category, rule_id: `r${i}`, location: { file: "f.ts", line: i + 1 } })) },
    }).added
    return [...added, ...added.map((row) => ({ type: "resolution", id: row.id, label, note: "" }))]
  }

  it("says insufficient data below the minimum, per category and overall", () => {
    // Arrange
    const state = foldLedger([...rows("security", "A", 5), ...rows("style", "R", 2)])

    // Act
    const report = buildReport(state)

    // Assert
    expect(report.overall).toMatchObject({ n: 7, A: 5, R: 2, insufficient: true })
    expect(report.byCategory.security).toMatchObject({ n: 5, insufficient: true })
    expect(report.byCategory.performance).toMatchObject({ n: 0 })
    expect(renderReport(report)).toContain("datos insuficientes")
  })

  it("counts findings without a label as unresolved and leaves them out of the rates", () => {
    // Arrange
    const open = recordReview({ events: [], slug: "s", meta, review: { findings: [finding(), finding({ rule_id: "b" })] } }).added
    const state = foldLedger([...open, ...rows("security", "A", 3, "other")])

    // Act
    const report = buildReport(state)

    // Assert
    expect(report.findings).toBe(5)
    expect(report.unresolved).toBe(2)
    expect(report.overall.n).toBe(3)
  })

  it("is sufficient from the minimum number of rows", () => {
    const report = buildReport(foldLedger(rows("correctness", "A", MIN_ROWS)))
    expect(report.byCategory.correctness.insufficient).toBe(false)
    expect(report.overall.strict.value).toBe(1)
  })

  it("estimates recall only over audited pull requests", () => {
    // Arrange: two real findings in audited PR "a", one real finding in a PR nobody audited, and one missed defect in "a"
    const events = [
      ...rows("security", "A", 2, "a"),
      ...rows("security", "A", 1, "b"),
      { type: "audit", slug: "a" },
      missedEvent({ category: "security", note: "omitido", slug: "a", source: "audit_sample" }),
    ]

    // Act
    const report = buildReport(foldLedger(events))

    // Assert
    expect(report.auditedPullRequests).toBe(1)
    expect(report.auditedRecall).toMatchObject({ k: 2, n: 3, insufficient: true })
    expect(report.auditedRecall.value).toBeCloseTo(2 / 3)
  })

  it("has no recall without audits, and the report says why", () => {
    const text = renderReport(buildReport(foldLedger(rows("security", "A", 3))))
    expect(text).toContain("no hay recall")
    expect(text).toContain("no de una muestra aleatoria")
  })
})

describe("readEvents", () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns nothing for a missing file and names the line of a broken one", () => {
    // Arrange
    const file = path.join(dir, "ledger.jsonl")
    expect(readEvents(file)).toEqual([])
    fs.writeFileSync(file, '{"type":"audit","slug":"a"}\n{not json}\n')

    // Act / Assert
    expect(() => readEvents(file)).toThrow("line 2 is not valid JSON")
  })
})

describe("command line: merge records, then a person resolves and asks for the report", () => {
  const CLI = path.resolve(__dirname, "..", "scripts", "cli.mjs")
  let repo: string

  const run = (command: string, args: string[]) => spawnSync(command, args, { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } })
  const git = (...args: string[]) => {
    const result = run("git", args)
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  }
  const cli = (...args: string[]) => run("node", [CLI, ...args])
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-cli-"))
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "Test")
    write("lib/a.ts", "export const a = 1\nexport const b = 2\n")
    git("add", ".")
    git("commit", "-q", "-m", "base")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "-b", "feature/x")
    write("lib/a.ts", "export const a = 1\nexport const b = 3\nexport const c = 4\n")
    git("add", ".")
    git("commit", "-q", "-m", "change")
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  const reviewJson = JSON.stringify({ schema_version: 1, findings: [finding({ location: { file: "lib/a.ts", line: 2 } }), finding({ rule_id: "other-rule", category: "security", location: { file: "lib/a.ts", line: 3 } })] })

  const prepareAndMerge = () => {
    cli("prepare", "--base", "origin/main", "--model", "test-model")
    write(".review-work/typescript.review.json", reviewJson)
    return cli("merge", "--model", "test-model")
  }

  it("merge writes one ledger row per finding and does not duplicate them when it runs again", () => {
    // Arrange / Act
    const first = prepareAndMerge()
    const second = prepareAndMerge()

    // Assert
    expect(first.status).toBe(0)
    expect(first.stdout).toContain("ledger: 2 finding(s) recorded")
    expect(second.stdout).toContain("already recorded")
    expect(readEvents(path.join(repo, ".ai-review", "ledger.jsonl"))).toHaveLength(2)
  })

  it("--no-ledger leaves the ledger alone", () => {
    cli("prepare", "--base", "origin/main")
    write(".review-work/typescript.review.json", reviewJson)
    cli("merge", "--no-ledger")
    expect(fs.existsSync(path.join(repo, ".ai-review", "ledger.jsonl"))).toBe(false)
  })

  it("list shows what is open, resolve labels it by an id prefix, and the report counts it", () => {
    // Arrange
    prepareAndMerge()
    const listed = cli("ledger", "list", "--open").stdout
    const id = listed.split("\n")[0].trim().split(/\s+/)[0]

    // Act
    const resolved = cli("ledger", "resolve", "--id", id, "--label", "A", "--note", "se corrigió", "--by", "ana")
    const open = cli("ledger", "list", "--open").stdout
    const report = cli("ledger", "report").stdout

    // Assert
    expect(resolved.status).toBe(0)
    expect(open).toContain("1 finding(s) without a label")
    expect(report).toContain("Hallazgos registrados: 2. Sin etiqueta todavía: 1.")
    expect(report).toContain("Accionables (A): 1")
    expect(report).toContain("datos insuficientes")
  })

  it("rejects a wrong label or an unknown id with a clear message and exit code 2", () => {
    prepareAndMerge()
    const badLabel = cli("ledger", "resolve", "--id", "abc", "--label", "Z")
    const unknown = cli("ledger", "resolve", "--id", "zzzz", "--label", "A")

    expect(badLabel.status).toBe(2)
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('no finding with id "zzzz"')
    expect(unknown.stderr).not.toContain("    at ")
  })

  it("missed and audit rows feed the recall estimate", () => {
    // Arrange
    prepareAndMerge()
    const id = cli("ledger", "list").stdout.split("\n")[0].trim().split(/\s+/)[0]
    cli("ledger", "resolve", "--id", id, "--label", "A")
    cli("ledger", "audit", "--slug", "feature-x")
    const missed = cli("ledger", "missed", "--category", "security", "--note", "no vio la inyección", "--slug", "feature-x", "--source", "audit_sample")

    // Act
    const report = cli("ledger", "report").stdout

    // Assert
    expect(missed.status).toBe(0)
    expect(report).toContain("PR auditados por otra vía: 1")
    expect(report).toContain("El revisor vio 1 de los 2 defectos conocidos")
  })

  it("the project's own config and context change the review without touching the skill", () => {
    // Arrange
    write(".ai-review/config.json", JSON.stringify({ phase: "shadow", maxFindings: 3 }))
    cli("prepare", "--base", "origin/main")
    const planBefore = JSON.parse(fs.readFileSync(path.join(repo, ".review-work", "plan.json"), "utf8"))

    // Act
    write(".ai-review/context.md", "Mirar sobre todo el cobro.")
    cli("prepare", "--base", "origin/main")
    const planAfter = JSON.parse(fs.readFileSync(path.join(repo, ".review-work", "plan.json"), "utf8"))

    // Assert: the cache key moves with the context, the diff does not
    expect(planAfter.diffHash).toBe(planBefore.diffHash)
    expect(planAfter.cacheKey).not.toBe(planBefore.cacheKey)
  })
})
