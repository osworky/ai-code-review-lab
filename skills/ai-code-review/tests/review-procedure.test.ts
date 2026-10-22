import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { checkReviews, mergeBucketReviews, promptHash, slugOf } from "../scripts/cli.mjs"
import { annotateFileDiff, normalizeDiff, splitDiff } from "../scripts/diff.mjs"
import { consolidate, decide, mergeReviews, renderSummary, sanitize } from "../scripts/policy.mjs"
import { cacheKey, classify, planReview, withoutReviewFiles } from "../scripts/route.mjs"

// The deterministic parts of the review procedure: no model is called here.

const finding = (overrides: Record<string, unknown> = {}) => ({
  rule_id: "missing-test",
  category: "missing_tests",
  severity: "advisory",
  location: { file: "lib/a.ts", line: 3 },
  message: "Falta un test.",
  suggested_fix: "Añadir un test.",
  ...overrides,
})

const tsDiff = `diff --git a/lib/a.ts b/lib/a.ts
index 1111111..2222222 100644
--- a/lib/a.ts
+++ b/lib/a.ts
@@ -1,3 +1,4 @@
 export const a = 1
-export const b = 2
+export const b = 3
+export const c = 4
 export const d = 5
`

const docsDiff = `diff --git a/docs/x.md b/docs/x.md
index 1111111..2222222 100644
--- a/docs/x.md
+++ b/docs/x.md
@@ -1 +1,2 @@
 # x
+more
`

const pyNew = `diff --git a/scripts/s.py b/scripts/s.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/scripts/s.py
@@ -0,0 +1,2 @@
+import os
+print(os.name)
`

const workflowNew = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/.github/workflows/ci.yml
@@ -0,0 +1,2 @@
+name: CI
+on: push
`

const options = { promptHash: "p1", schemaVersion: 1, model: "m1" }

describe("splitDiff", () => {
  it("returns one entry per file with status and counts", () => {
    // Arrange / Act
    const files = splitDiff(tsDiff + pyNew)

    // Assert
    expect(files.map((file) => [file.path, file.status, file.added, file.removed])).toEqual([
      ["lib/a.ts", "modified", 2, 1],
      ["scripts/s.py", "added", 2, 0],
    ])
  })

  it("detects deleted, renamed and binary files", () => {
    // Arrange
    const diff = `diff --git a/x.ts b/x.ts
deleted file mode 100644
--- a/x.ts
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`

    // Act
    const files = splitDiff(diff)

    // Assert
    expect(files.map((file) => [file.path, file.status, file.binary])).toEqual([
      ["x.ts", "deleted", false],
      ["new.ts", "renamed", false],
      ["img.png", "modified", true],
    ])
  })

  it("keeps CRLF diffs readable", () => {
    expect(splitDiff(tsDiff.replace(/\n/g, "\r\n"))[0].added).toBe(2)
  })

  it("returns nothing for an empty diff", () => {
    expect(splitDiff("")).toEqual([])
  })
})

describe("annotateFileDiff", () => {
  it("writes the number of the new file on every context and added line", () => {
    // Arrange
    const file = splitDiff(tsDiff)[0]

    // Act
    const text = annotateFileDiff(file.text)

    // Assert
    const body = text.split("\n").filter((line) => line.includes("| "))
    expect(body.map((line) => line.replace(/\s+/g, " ").trim())).toEqual([
      "1| export const a = 1",
      "| -export const b = 2",
      "2| +export const b = 3",
      "3| +export const c = 4",
      "4| export const d = 5",
    ])
  })

  it("starts every hunk at its own line, per file", () => {
    // Arrange: two files that both start at line 1 of their own
    const [first, second] = splitDiff(tsDiff + pyNew.replace("@@ -0,0 +1,2 @@", "@@ -0,0 +1,2 @@"))

    // Act
    const a = annotateFileDiff(first.text)
    const b = annotateFileDiff(second.text)

    // Assert
    expect(a).toContain("    1| ")
    expect(b).toContain("    1| +import os")
    expect(b).toContain("    2| +print(os.name)")
  })

  it("leaves the headers alone and does not number removed lines", () => {
    const text = annotateFileDiff(splitDiff(tsDiff)[0].text)
    expect(text).toContain("diff --git a/lib/a.ts b/lib/a.ts")
    expect(text).toContain("@@ -1,3 +1,4 @@")
    expect(text).toMatch(/^ {5}\| -export const b = 2$/m)
  })
})

describe("normalizeDiff", () => {
  it("ignores blob hashes and line endings", () => {
    expect(normalizeDiff(tsDiff.replace(/\n/g, "\r\n").replace("1111111..2222222", "aaaaaaa..bbbbbbb"))).toBe(normalizeDiff(tsDiff))
  })
})

describe("classify", () => {
  it.each([
    ["components/contact-form.tsx", "typescript"],
    ["lib/quote.ts", "typescript"],
    ["scripts/cli.mjs", "typescript"],
    ["scripts/make.py", "python"],
    [".github/workflows/e2e.yml", "infra"],
    ["lighthouserc.mobile.json", "other"],
    ["semgrep-rules/traslados.yml", "infra"],
    ["Dockerfile", "infra"],
    ["docs/readme.md", "docs"],
    ["package-lock.json", "skip"],
    ["public/images/x.webp", "skip"],
    [".ai-review/reviews/feature.json", "skip"],
    ["styles/app.css", "other"],
  ])("sends %s to %s", (file, expected) => {
    expect(classify(file)).toBe(expected)
  })
})

describe("planReview", () => {
  it("groups the files by reviewer and annotates their diffs", () => {
    // Arrange / Act
    const plan = planReview(tsDiff + pyNew + workflowNew + docsDiff, options)

    // Assert
    expect(Object.keys(plan.buckets).sort()).toEqual(["infra", "python", "typescript"])
    expect(plan.buckets.typescript.files).toEqual(["lib/a.ts"])
    expect(plan.buckets.python.diff).toContain("    1| +import os")
    expect(plan.docsFiles).toBe(1)
    expect(plan.needsReview).toBe(true)
  })

  it("takes the small route under the threshold and the large one above it", () => {
    // Arrange
    const big = `diff --git a/lib/big.ts b/lib/big.ts\nnew file mode 100644\n--- /dev/null\n+++ b/lib/big.ts\n@@ -0,0 +1,250 @@\n${Array.from({ length: 250 }, (_, i) => `+const v${i} = ${i}`).join("\n")}\n`

    // Act / Assert
    expect(planReview(tsDiff, options).route).toBe("small")
    expect(planReview(big, options).route).toBe("large")
  })

  it("needs no model for documentation only, an empty diff or skipped files", () => {
    expect(planReview(docsDiff, options)).toMatchObject({ route: "docs", needsReview: false })
    expect(planReview("", options)).toMatchObject({ route: "skip", needsReview: false })
    const lock = "diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1 +1 @@\n-a\n+b\n"
    expect(planReview(lock, options)).toMatchObject({ route: "skip", needsReview: false })
  })

  it("stops a diff that is too big for the budget", () => {
    // Arrange
    const plan = planReview(tsDiff, { ...options, config: { maxDiffChars: 40 } })

    // Assert
    expect(plan).toMatchObject({ route: "over_budget", needsReview: false })
  })

  it("does not review its own review files", () => {
    // Arrange
    const review = `diff --git a/.ai-review/reviews/x.json b/.ai-review/reviews/x.json\nnew file mode 100644\n--- /dev/null\n+++ b/.ai-review/reviews/x.json\n@@ -0,0 +1 @@\n+{}\n`

    // Act
    const plan = planReview(tsDiff + review, options)

    // Assert
    expect(plan.buckets.typescript.files).toEqual(["lib/a.ts"])
    expect(withoutReviewFiles(tsDiff + review)).toBe(tsDiff)
    expect(plan.diffHash).toBe(planReview(tsDiff, options).diffHash)
  })

  it("gives the same hash for the same content and another for another content", () => {
    // Arrange / Act
    const same = planReview(tsDiff.replace(/\n/g, "\r\n"), options)
    const other = planReview(tsDiff.replace("b = 3", "b = 9"), options)

    // Assert
    expect(same.diffHash).toBe(planReview(tsDiff, options).diffHash)
    expect(other.diffHash).not.toBe(same.diffHash)
  })
})

describe("cacheKey", () => {
  it("changes when the diff, the prompts, the schema or the model change", () => {
    // Arrange
    const base = cacheKey("d", "p", 1, "m")

    // Assert
    expect(cacheKey("d", "p", 1, "m")).toBe(base)
    expect(new Set([base, cacheKey("d2", "p", 1, "m"), cacheKey("d", "p2", 1, "m"), cacheKey("d", "p", 2, "m"), cacheKey("d", "p", 1, "m2"), cacheKey("d", "p", 1, "m", "x")]).size).toBe(6)
  })
})

describe("consolidate and mergeReviews", () => {
  it("removes duplicates keeping the most severe and sorts by severity", () => {
    // Arrange
    const list = [
      finding({ severity: "info" }),
      finding({ severity: "blocker" }),
      finding({ rule_id: "other-rule", location: { file: "lib/a.ts", line: 1 } }),
    ]

    // Act
    const result = consolidate(list as never)

    // Assert
    expect(result.map((item) => [item.rule_id, item.severity])).toEqual([
      ["missing-test", "blocker"],
      ["other-rule", "advisory"],
    ])
  })

  it("caps the merged list keeping the most severe", () => {
    // Arrange
    const reviews = [
      { findings: [finding({ rule_id: "a", severity: "info" }), finding({ rule_id: "b", severity: "blocker" })] },
      { findings: [finding({ rule_id: "c", severity: "advisory" })] },
    ]

    // Act
    const merged = mergeReviews(reviews as never, 2)

    // Assert
    expect(merged.review.findings.map((item) => item.rule_id)).toEqual(["b", "c"])
    expect(merged).toMatchObject({ droppedByCap: 1, duplicatesRemoved: 0 })
  })

  it("counts the duplicates between reviewers", () => {
    const merged = mergeReviews([{ findings: [finding()] }, { findings: [finding()] }] as never, 15)
    expect(merged).toMatchObject({ duplicatesRemoved: 1 })
    expect(merged.review.findings).toHaveLength(1)
  })
})

describe("decide (rollout phases)", () => {
  const blocker = finding({ rule_id: "leak", severity: "blocker" })
  const advisory = finding({ rule_id: "slow", severity: "advisory", location: { file: "lib/a.ts", line: 9 } })

  it("never blocks in shadow or advisory, but records what it would have done", () => {
    // Arrange / Act
    const shadow = decide([blocker] as never, "shadow")
    const advisoryPhase = decide([blocker] as never, "advisory")

    // Assert
    expect([shadow.verdict, advisoryPhase.verdict]).toEqual(["pass", "pass"])
    expect([shadow.wouldBlock, advisoryPhase.wouldBlock]).toEqual([true, true])
  })

  it("blocks only the listed rules in the partial phase", () => {
    expect(decide([blocker] as never, "partial", { blockingRules: ["leak"] }).verdict).toBe("block")
    expect(decide([blocker] as never, "partial", { blockingRules: ["other"] }).verdict).toBe("pass")
  })

  it("blocks every blocker in the extended phase, and never an advisory", () => {
    expect(decide([blocker] as never, "extended").verdict).toBe("block")
    expect(decide([advisory] as never, "extended").verdict).toBe("pass")
  })

  it("never hides a blocking finding behind the cap", () => {
    // Arrange
    const many = Array.from({ length: 12 }, (_, i) => finding({ rule_id: `r${i}`, location: { file: "lib/a.ts", line: i + 1 } }))

    // Act
    const decision = decide([blocker, ...many] as never, "extended", { maxVisible: 3 })

    // Assert
    expect(decision.visible).toHaveLength(3)
    expect(decision.visible[0].finding.rule_id).toBe("leak")
    expect(decision.suppressed).toBe(10)
  })

  it("rejects an unknown phase", () => {
    expect(() => decide([], "turbo")).toThrow(/phase must be one of/)
  })
})

describe("renderSummary", () => {
  it("shows nothing in shadow", () => {
    expect(renderSummary(decide([finding()] as never, "shadow"))).toBeNull()
  })

  it("says it does not block and lists the findings in advisory", () => {
    // Arrange
    const text = renderSummary(decide([finding({ severity: "blocker", rule_id: "leak" })] as never, "advisory"))!

    // Assert
    expect(text).toContain("consultiva")
    expect(text).toContain("No bloquea")
    expect(text).toContain("`lib/a.ts:3`")
  })

  it("says there are no findings when there are none", () => {
    expect(renderSummary(decide([], "advisory"))).toContain("Sin hallazgos")
  })

  it("neutralises mentions, HTML and links coming from the model", () => {
    // Arrange
    const dirty = finding({ message: "ping @user <img src=x> [click](http://evil)", suggested_fix: "ok" })

    // Act
    const text = renderSummary(decide([dirty] as never, "advisory"))!

    // Assert
    expect(text).not.toContain("<img")
    expect(text).not.toMatch(/@user/)
    expect(text).not.toContain("](http")
    expect(sanitize("a   b\n c")).toBe("a b c")
  })
})

describe("mergeBucketReviews", () => {
  const plan = { buckets: { typescript: {}, python: {} } }
  const goodTs = JSON.stringify({ schema_version: 1, findings: [finding()] })

  it("joins the valid reviews and reports the missing and the invalid ones", () => {
    // Arrange
    const reviews: Record<string, string | null> = { typescript: goodTs, python: null }

    // Act
    const result = mergeBucketReviews({ plan, allPatch: tsDiff + pyNew, readReview: (bucket: string) => reviews[bucket], maxFindings: 15 })

    // Assert
    expect(result.buckets).toEqual({ typescript: { status: "valid", findings: 1 }, python: { status: "missing", findings: 0 } })
    expect(result.complete).toBe(false)
    expect(result.review.findings).toHaveLength(1)
  })

  it("rejects a review that cites a line outside the diff", () => {
    // Arrange
    const bad = JSON.stringify({ schema_version: 1, findings: [finding({ location: { file: "lib/a.ts", line: 99 } })] })

    // Act
    const result = mergeBucketReviews({ plan: { buckets: { typescript: {} } }, allPatch: tsDiff, readReview: () => bad, maxFindings: 15 })

    // Assert
    const buckets = result.buckets as Record<string, { status: string; errors?: string[] }>
    expect(buckets.typescript.status).toBe("invalid")
    expect(buckets.typescript.errors?.[0]).toMatch(/outside every changed hunk/)
    expect(result.review.findings).toEqual([])
  })

  it("is complete when every bucket is valid", () => {
    const result = mergeBucketReviews({ plan: { buckets: { typescript: {} } }, allPatch: tsDiff, readReview: () => goodTs, maxFindings: 15 })
    expect(result.complete).toBe(true)
  })
})

describe("checkReviews (the CI step)", () => {
  const meta = (overrides = {}) => JSON.stringify({ diffHash: planReview(tsDiff, options).diffHash, complete: true, ...overrides })
  const file = (review: unknown, extra: Record<string, unknown> = {}) => ({ name: ".ai-review/reviews/x.json", text: JSON.stringify(review), metaText: meta(), ...extra })

  it("asks for a review when the PR changes code and brings none, without failing", () => {
    // Arrange / Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [] })

    // Assert
    expect(result.exitCode).toBe(0)
    expect(result.summary).toContain("no trae revisión adjunta")
  })

  it("does not ask for a review when only documentation changed", () => {
    const result = checkReviews({ diffText: docsDiff, reviewFiles: [] })
    expect(result.exitCode).toBe(0)
    expect(result.summary).toContain("no necesita revisión")
  })

  it("applies the phase to a valid review", () => {
    // Arrange
    const review = { schema_version: 1, findings: [finding({ severity: "blocker" })] }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [file(review)], phase: "advisory" })

    // Assert
    expect(result.exitCode).toBe(0)
    expect(result.summary).toContain("No bloquea")
    expect(result.results[0]).toMatchObject({ valid: true })
  })

  it("blocks only when the phase says so", () => {
    // Arrange
    const review = { schema_version: 1, findings: [finding({ severity: "blocker", rule_id: "leak" })] }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [file(review)], phase: "partial", config: { blockingRules: ["leak"], maxVisible: 10, phase: "partial" } as never })

    // Assert
    expect(result.exitCode).toBe(1)
  })

  it("warns about an invalid review without blocking", () => {
    // Arrange
    const review = { schema_version: 1, findings: [finding({ location: { file: "lib/a.ts", line: 99 } })] }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [file(review)] })

    // Assert
    expect(result.exitCode).toBe(0)
    expect(result.summary).toContain("no es válida")
    expect(result.summary).toContain("outside every changed hunk")
  })

  it("flags a review made for another version of the diff", () => {
    // Arrange
    const review = { schema_version: 1, findings: [] }
    const stale = file(review, { metaText: meta({ diffHash: "0".repeat(64) }) })

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [stale] })

    // Assert
    expect(result.summary).toContain("desactualizada")
  })

  it("flags an incomplete review and changed prompts", () => {
    // Arrange
    const review = { schema_version: 1, findings: [] }
    const odd = file(review, { metaText: meta({ complete: false, promptHash: "old" }) })

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [odd], currentPromptHash: "new" })

    // Assert
    expect(result.summary).toContain("incompleta")
    expect(result.summary).toContain("prompts cambiaron")
  })

  it("does not count the review files as part of the diff it validates against", () => {
    // Arrange
    const reviewDiff = `diff --git a/.ai-review/reviews/x.json b/.ai-review/reviews/x.json\nnew file mode 100644\n--- /dev/null\n+++ b/.ai-review/reviews/x.json\n@@ -0,0 +1 @@\n+{}\n`
    const review = { schema_version: 1, findings: [finding({ location: { file: ".ai-review/reviews/x.json", line: 1 } })] }

    // Act
    const result = checkReviews({ diffText: tsDiff + reviewDiff, reviewFiles: [file(review)] })

    // Assert
    expect(result.summary).toContain("no es válida")
  })

  it("rejects an unknown phase", () => {
    expect(() => checkReviews({ diffText: tsDiff, reviewFiles: [], phase: "turbo" })).toThrow(/phase must be one of/)
  })
})

describe("promptHash and slugOf", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-"))
    fs.mkdirSync(path.join(dir, "prompts"))
    fs.writeFileSync(path.join(dir, "review.schema.json"), "{}")
    fs.writeFileSync(path.join(dir, "rubric.md"), "rubric")
    fs.writeFileSync(path.join(dir, "prompts", "base.md"), "base")
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("changes when a prompt or the schema changes, and not otherwise", () => {
    // Arrange
    const before = promptHash(dir)

    // Act / Assert
    expect(promptHash(dir)).toBe(before)
    fs.writeFileSync(path.join(dir, "prompts", "base.md"), "base v2")
    const afterPrompt = promptHash(dir)
    expect(afterPrompt).not.toBe(before)
    fs.writeFileSync(path.join(dir, "review.schema.json"), '{"a":1}')
    expect(promptHash(dir)).not.toBe(afterPrompt)
  })

  it("changes when the rubric or the project context changes, and the context is optional", () => {
    // Arrange
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "review-project-"))
    const withoutContext = promptHash(dir, project)

    // Act
    fs.writeFileSync(path.join(dir, "rubric.md"), "rubric v2")
    const afterRubric = promptHash(dir, project)
    fs.mkdirSync(path.join(project, ".ai-review"))
    fs.writeFileSync(path.join(project, ".ai-review", "context.md"), "mirar el cobro")
    const withContext = promptHash(dir, project)
    fs.writeFileSync(path.join(project, ".ai-review", "context.md"), "mirar el cobro y los permisos")

    // Assert
    expect(afterRubric).not.toBe(withoutContext)
    expect(withContext).not.toBe(afterRubric)
    expect(promptHash(dir, project)).not.toBe(withContext)
    fs.rmSync(project, { recursive: true, force: true })
  })

  it("is the same with CRLF line endings", () => {
    // Arrange
    const lines = ["base", "more", ""]
    fs.writeFileSync(path.join(dir, "prompts", "base.md"), lines.join(String.fromCharCode(10)))
    const withLf = promptHash(dir)

    // Act
    fs.writeFileSync(path.join(dir, "prompts", "base.md"), lines.join(String.fromCharCode(13, 10)))

    // Assert
    expect(promptHash(dir)).toBe(withLf)
  })

  it.each([
    ["feat/Review Procedure", "feat-review-procedure"],
    ["  --x--  ", "x"],
    ["", "review"],
  ])("makes %j the name %j", (name, expected) => {
    expect(slugOf(name)).toBe(expected)
  })
})

describe("the files of the procedure", () => {
  it("ship a prompt for each reviewer the router can pick", () => {
    // Arrange
    const reviewers = ["typescript", "python", "infra", "other"]

    // Act
    const missing = ["base", ...reviewers].filter((name) => !fs.existsSync(path.join(__dirname, "..", "prompts", `${name}.md`)))

    // Assert
    expect(missing).toEqual([])
  })
})
