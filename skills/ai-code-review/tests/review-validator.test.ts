import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { parseDiffRanges, validateReview } from "../scripts/validate-review.mjs"

// The validator must fail on broken reviews; a validator that never fails is useless.

const finding = {
  rule_id: "missing-authorization",
  category: "security",
  severity: "blocker",
  location: { file: "app/api/conversion-events/route.ts", line: 50 },
  message: "The client allowlist was removed, so any caller can write events.",
  suggested_fix: "Restore the clientId and landingId check.",
}

const review = (findings: unknown[] = [finding]) => JSON.stringify({ schema_version: 1, findings })

function without(key: string) {
  const copy: Record<string, unknown> = { ...finding }
  delete copy[key]
  return copy
}

const diff = [
  "diff --git a/lib/quote.ts b/lib/quote.ts",
  "--- a/lib/quote.ts",
  "+++ b/lib/quote.ts",
  "@@ -180,0 +182,6 @@ export function formatPrice() {",
  "+added",
  "diff --git a/app/api/conversion-events/route.ts b/app/api/conversion-events/route.ts",
  "--- a/app/api/conversion-events/route.ts",
  "+++ b/app/api/conversion-events/route.ts",
  "@@ -49,3 +50 @@ export async function POST() {",
  "+added",
].join("\n")

describe("review JSON validator: valid output", () => {
  it("accepts a well-formed finding", () => {
    // Arrange
    const text = review()

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("accepts an empty findings list when there is nothing to report", () => {
    // Arrange
    const text = review([])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(true)
  })
})

describe("review JSON validator: broken output", () => {
  it("reports exactly which field is missing (severity removed on purpose)", () => {
    // Arrange
    const text = review([without("severity")])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['findings[0]: missing required field "severity"'])
  })

  it.each(["rule_id", "category", "location", "message", "suggested_fix"])("rejects a finding without %s", (field) => {
    // Arrange
    const text = review([without(field)])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain(`"${field}"`)
  })

  it.each([
    ["category", "tests"],
    ["category", "Security"],
    ["severity", "high"],
    ["severity", ""],
  ])("rejects %s = %j, which is outside the closed set", (field, value) => {
    // Arrange
    const text = review([{ ...finding, [field]: value }])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain(`"${field}" must be one of`)
  })

  it.each([0, -3, 2.5, "50", null])("rejects the line %j", (line) => {
    // Arrange
    const text = review([{ ...finding, location: { file: "a.ts", line } }])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain('"line" must be an integer >= 1')
  })

  it.each(["MissingAuth", "missing_auth", "-x", ""])("rejects the rule_id %j", (ruleId) => {
    // Arrange
    const text = review([{ ...finding, rule_id: ruleId }])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain("rule_id")
  })

  it("rejects fields that are not in the schema", () => {
    // Arrange
    const text = review([{ ...finding, confidence: 0.9 }])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.errors).toEqual(['findings[0]: unknown field "confidence"'])
  })

  it("rejects an empty message", () => {
    // Arrange
    const text = review([{ ...finding, message: "   " }])

    // Act
    const result = validateReview(text)

    // Assert
    expect(result.errors[0]).toContain('"message" must be a non-empty string')
  })

  it.each([
    ["not JSON at all", "the review looks fine"],
    ["a Markdown code block", "```json\n" + review() + "\n```"],
    ["an empty string", ""],
    ["a bare array", "[]"],
    ["the wrong schema_version", JSON.stringify({ schema_version: 2, findings: [] })],
    ["a missing findings key", JSON.stringify({ schema_version: 1 })],
  ])("rejects %s", (_label, text) => {
    // Arrange
    const output = text

    // Act
    const result = validateReview(output)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe("review JSON validator: locations must exist in the diff", () => {
  it("parses the new-side ranges of every hunk", () => {
    // Arrange
    const text = diff

    // Act
    const ranges = parseDiffRanges(text)

    // Assert
    expect(ranges.get("lib/quote.ts")).toEqual([[182, 187]])
    expect(ranges.get("app/api/conversion-events/route.ts")).toEqual([[50, 50]])
  })

  it("accepts a line inside a changed hunk", () => {
    // Arrange
    const diffRanges = parseDiffRanges(diff)

    // Act
    const result = validateReview(review(), { diffRanges })

    // Assert
    expect(result.ok).toBe(true)
  })

  it("rejects a file that is not in the diff", () => {
    // Arrange
    const diffRanges = parseDiffRanges(diff)
    const text = review([{ ...finding, location: { file: "lib/other.ts", line: 10 } }])

    // Act
    const result = validateReview(text, { diffRanges })

    // Assert
    expect(result.errors).toEqual(['findings[0].location: file "lib/other.ts" is not part of the diff'])
  })

  it("rejects a line outside every changed hunk (an invented location)", () => {
    // Arrange
    const diffRanges = parseDiffRanges(diff)
    const text = review([{ ...finding, location: { file: "lib/quote.ts", line: 999 } }])

    // Act
    const result = validateReview(text, { diffRanges })

    // Assert
    expect(result.errors[0]).toContain("line 999")
    expect(result.errors[0]).toContain("outside every changed hunk")
  })
})

describe("review JSON validator: command line", () => {
  const script = join(__dirname, "..", "scripts", "validate-review.mjs")

  it("exits 0 on a valid file and 1 with a clear message on a broken one", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "review-"))
    const good = join(dir, "good.json")
    const bad = join(dir, "bad.json")
    writeFileSync(good, review())
    writeFileSync(bad, review([without("severity")]))

    // Act
    const ok = execFileSync("node", [script, good]).toString()
    const broken = spawnSync("node", [script, bad], { encoding: "utf8" })

    // Assert
    expect(ok).toContain("OK: 1 finding(s)")
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain('missing required field "severity"')
  })
})
