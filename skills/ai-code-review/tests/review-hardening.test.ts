import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { checkReviews, readRegular, stringOption } from "../scripts/cli.mjs"
import { decide, renderSummary, sanitize, sanitizePath } from "../scripts/policy.mjs"
import { parseDiffRanges } from "../scripts/validate-review.mjs"

// More regression tests from the second review of the procedure by itself.

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

const review = (line = 2) =>
  JSON.stringify({
    schema_version: 1,
    findings: [
      { rule_id: "x-rule", category: "style", severity: "advisory", location: { file: "lib/a.ts", line }, message: "m", suggested_fix: "f" },
    ],
  })

describe("check: a pull request too big to review", () => {
  it("says it was not reviewed instead of saying it was not needed", () => {
    // Arrange
    const config = { phase: "advisory", blockingRules: [], maxFindings: 15, maxVisible: 10, largeChangedLines: 200, maxDiffChars: 40, charsPerToken: 4 }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [], config })

    // Assert
    expect(result.summary).toContain("demasiado grande")
    expect(result.summary).toContain("no se revisó")
    expect(result.summary).not.toContain("no necesita revisión")
    expect(result.exitCode).toBe(0)
  })
})

describe("check: a review without the file that says what it was made for", () => {
  it("warns that it cannot tell whether the review is up to date", () => {
    // Arrange
    const file = { name: ".ai-review/reviews/x.json", text: review(), metaText: null }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [file] })

    // Assert
    expect(result.summary).toContain("No se puede comprobar si la revisión está al día")
  })

  it("warns the same when the meta file is corrupt or has no hash", () => {
    // Arrange
    const corrupt = { name: ".ai-review/reviews/x.json", text: review(), metaText: "{not json" }
    const noHash = { name: ".ai-review/reviews/y.json", text: review(), metaText: JSON.stringify({ complete: true }) }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [corrupt, noHash] })

    // Assert
    expect(result.summary.match(/No se puede comprobar si la revisión está al día/g)).toHaveLength(2)
  })
})

describe("check: a review file that is not a regular file", () => {
  it("is reported as invalid with the reason and its content is never used", () => {
    // Arrange
    const file = { name: ".ai-review/reviews/x.json", text: "", error: "the review file is not a regular file (a link or a folder): it is not read" }

    // Act
    const result = checkReviews({ diffText: tsDiff, reviewFiles: [file] })

    // Assert
    expect(result.summary).toContain("no es válida")
    expect(result.summary).toContain("not a regular file")
    expect(result.exitCode).toBe(0)
  })
})

describe("readRegular", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-regular-"))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("reads a regular file and refuses a folder", () => {
    // Arrange
    fs.writeFileSync(path.join(dir, "a.json"), "{}")
    fs.mkdirSync(path.join(dir, "folder"))

    // Act / Assert
    expect(readRegular(path.join(dir, "a.json"))).toBe("{}")
    expect(readRegular(path.join(dir, "folder"))).toBeNull()
  })

  it("refuses a symbolic link (when the system lets the test create one)", () => {
    // Arrange
    const target = path.join(dir, "secret.txt")
    fs.writeFileSync(target, "private")
    try {
      fs.symlinkSync(target, path.join(dir, "link.json"))
    } catch {
      return // creating links needs privileges on some systems; the folder case above covers the same branch
    }

    // Act / Assert
    expect(readRegular(path.join(dir, "link.json"))).toBeNull()
  })
})

describe("stringOption", () => {
  it("gives the fallback when the option is absent and the text when it has one", () => {
    expect(stringOption({}, "slug", "fallback")).toBe("fallback")
    expect(stringOption({ slug: "mine" }, "slug", "fallback")).toBe("mine")
  })

  it.each([true, "", "   "])("refuses the value %j with a clear message", (value) => {
    expect(() => stringOption({ slug: value }, "slug", "x")).toThrow("--slug needs a value")
  })

  it("is reported by the command line as a usage error, not a stack trace", () => {
    // Arrange
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "review-opt-"))
    const run = (command: string, args: string[]) => spawnSync(command, args, { cwd: repo, encoding: "utf8" })
    run("git", ["init", "-q", "-b", "main"])
    run("git", ["config", "user.email", "t@example.com"])
    run("git", ["config", "user.name", "T"])
    fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1\n")
    run("git", ["add", "."])
    run("git", ["commit", "-q", "-m", "base"])
    run("git", ["update-ref", "refs/remotes/origin/main", "HEAD"])

    // Act
    const result = run("node", [path.resolve(__dirname, "..", "scripts", "cli.mjs"), "prepare", "--base", "origin/main", "--slug"])

    // Assert
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("--slug needs a value")
    expect(result.stderr).not.toContain("at ")
    fs.rmSync(repo, { recursive: true, force: true })
  })
})

describe("paths with spaces in a diff", () => {
  it("keeps the real path when git adds a tab after a name that has a space", () => {
    // Arrange: git writes the tab after the path of the +++ line when the name contains a space
    const diff = "diff --git a/my docs/a b.ts b/my docs/a b.ts\n--- a/my docs/a b.ts\t\n+++ b/my docs/a b.ts\t\n@@ -1 +1,2 @@\n x\n+y\n"

    // Act
    const ranges = parseDiffRanges(diff)

    // Assert
    expect([...ranges.keys()]).toEqual(["my docs/a b.ts"])
    expect(ranges.get("my docs/a b.ts")).toEqual([[1, 2]])
  })
})

describe("sanitize and bare links", () => {
  it("breaks the link of a bare URL so GitHub does not make it clickable", () => {
    // Arrange / Act
    const clean = sanitize("see http://evil.example/x and https://other.example")

    // Assert
    expect(clean).not.toContain("://")
    expect(clean).toContain("http")
    expect(clean).toContain("evil.example/x")
  })
})

describe("a file path in the summary", () => {
  it("cannot close the code span, mention anyone or make a link", () => {
    // Arrange
    const file = "lib/a`@octocat [x](http://evil.example).ts"
    const dirty = { rule_id: "x-rule", category: "style", severity: "advisory", location: { file, line: 2 }, message: "m", suggested_fix: "f" }

    // Act
    const text = renderSummary(decide([dirty] as never, "advisory"))!

    // Assert
    const row = text.split(String.fromCharCode(10)).find((line) => line.includes("x-rule"))!
    expect(row.match(/`/g)).toHaveLength(4)
    expect(row).not.toMatch(/@octocat/)
    expect(row).not.toContain("](http")
    expect(row).not.toContain("://")
  })

  it("keeps an ordinary path as it is", () => {
    expect(sanitizePath("lib/a.ts")).toBe("lib/a.ts")
  })
})
