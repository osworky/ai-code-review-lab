import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { isCached, safeOutDir } from "../scripts/cli.mjs"
import { splitDiff } from "../scripts/diff.mjs"
import { parseDiffRanges } from "../scripts/validate-review.mjs"

// Regression tests for what the review of the procedure itself found in its own code.

describe("counting changed lines inside a hunk", () => {
  it("counts a removed '---' line and an added '+++' line as changes, not as file headers", () => {
    // Arrange: the removed line is the YAML separator "---", the added one starts with "++"
    const diff = `diff --git a/x.yml b/x.yml
--- a/x.yml
+++ b/x.yml
@@ -1,3 +1,3 @@
 a: 1
----
++++ extra
 b: 2
`

    // Act
    const [file] = splitDiff(diff)

    // Assert
    expect([file.added, file.removed]).toEqual([1, 1])
  })

  it("still ends a hunk that promises more lines than it has", () => {
    // Arrange
    const diff = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,9 +1,9 @@
+one
diff --git a/y.ts b/y.ts
--- a/y.ts
+++ b/y.ts
@@ -1 +1 @@
-old
+new
`

    // Act
    const files = splitDiff(diff)

    // Assert
    expect(files.map((file) => [file.path, file.added, file.removed])).toEqual([
      ["x.ts", 1, 0],
      ["y.ts", 1, 1],
    ])
  })
})

describe("the ranges the validator accepts", () => {
  it("do not include the line where a pure deletion happened", () => {
    // Arrange: lines 3 and 4 of the old file are removed; nothing is added to the new file
    const diff = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -3,2 +2,0 @@
-gone
-gone too
`

    // Act
    const ranges = parseDiffRanges(diff)

    // Assert
    expect(ranges.get("x.ts")).toEqual([])
  })

  it("forget a deleted file instead of attaching the next hunks to it", () => {
    // Arrange
    const diff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
diff --git a/keep.ts b/keep.ts
--- a/keep.ts
+++ b/keep.ts
@@ -1 +1,2 @@
 x
+y
`

    // Act
    const ranges = parseDiffRanges(diff)

    // Assert
    expect([...ranges.keys()]).toEqual(["keep.ts"])
    expect(ranges.get("keep.ts")).toEqual([[1, 2]])
  })

  it("do not take an added line that looks like a file header for another file", () => {
    // Arrange: the added line is "++ b/evil.ts", which in the diff reads "+++ b/evil.ts"
    const diff = `diff --git a/real.ts b/real.ts
--- a/real.ts
+++ b/real.ts
@@ -1,1 +1,2 @@
 keep
+++ b/evil.ts
`

    // Act
    const ranges = parseDiffRanges(diff)

    // Assert
    expect([...ranges.keys()]).toEqual(["real.ts"])
    expect(ranges.get("real.ts")).toEqual([[1, 2]])
  })

  it("keep the ranges of a normal diff with several hunks", () => {
    // Arrange
    const diff = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,2 +1,3 @@
 a
+b
 c
@@ -10,2 +11,2 @@
-d
+e
 f
`

    // Act / Assert
    expect(parseDiffRanges(diff).get("x.ts")).toEqual([
      [1, 3],
      [11, 12],
    ])
  })
})

describe("safeOutDir", () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "review-out-"))
  })

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
  })

  it.each([".", "./", "..", "../outside", "a/../..", ""])("refuses %j", (out) => {
    expect(() => safeOutDir(out, cwd)).toThrow()
  })

  it("refuses a path outside the current directory", () => {
    expect(() => safeOutDir(path.join(os.tmpdir(), "elsewhere"), cwd)).toThrow(/inside the current directory/)
  })

  it.each([undefined, true, 7, null])("refuses the value %j", (out) => {
    expect(() => safeOutDir(out, cwd)).toThrow(/needs a folder name/)
  })

  it("accepts a folder that does not exist yet and an empty one", () => {
    // Arrange
    fs.mkdirSync(path.join(cwd, "empty"))

    // Act / Assert
    expect(safeOutDir(".review-work", cwd)).toBe(path.join(cwd, ".review-work"))
    expect(safeOutDir("empty", cwd)).toBe(path.join(cwd, "empty"))
  })

  it("accepts a folder this command made before (it holds plan.json)", () => {
    // Arrange
    fs.mkdirSync(path.join(cwd, "work"))
    fs.writeFileSync(path.join(cwd, "work", "plan.json"), "{}")
    fs.writeFileSync(path.join(cwd, "work", "typescript.diff"), "x")

    // Act / Assert
    expect(safeOutDir("work", cwd)).toBe(path.join(cwd, "work"))
  })

  it("refuses a folder that has files this command did not write", () => {
    // Arrange
    fs.mkdirSync(path.join(cwd, "docs"))
    fs.writeFileSync(path.join(cwd, "docs", "precious.md"), "do not delete")

    // Act / Assert
    expect(() => safeOutDir("docs", cwd)).toThrow(/did not write/)
    expect(fs.readFileSync(path.join(cwd, "docs", "precious.md"), "utf8")).toBe("do not delete")
  })

  it("refuses an --out that is a file", () => {
    fs.writeFileSync(path.join(cwd, "file.txt"), "x")
    expect(() => safeOutDir("file.txt", cwd)).toThrow(/not a folder/)
  })
})

describe("prepare with a dangerous --out", () => {
  it("refuses '.' and leaves the files of the repository alone", () => {
    // Arrange
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "review-danger-"))
    const run = (command: string, args: string[]) => spawnSync(command, args, { cwd: repo, encoding: "utf8" })
    run("git", ["init", "-q", "-b", "main"])
    run("git", ["config", "user.email", "t@example.com"])
    run("git", ["config", "user.name", "T"])
    fs.writeFileSync(path.join(repo, "keep.ts"), "export const a = 1\n")
    run("git", ["add", "."])
    run("git", ["commit", "-q", "-m", "base"])
    run("git", ["update-ref", "refs/remotes/origin/main", "HEAD"])

    // Act
    const dot = run("node", [path.resolve(__dirname, "..", "scripts", "cli.mjs"), "prepare", "--base", "origin/main", "--out", "."])
    const bare = run("node", [path.resolve(__dirname, "..", "scripts", "cli.mjs"), "prepare", "--base", "origin/main", "--out"])

    // Assert
    expect(dot.status).not.toBe(0)
    expect(bare.status).not.toBe(0)
    expect(fs.existsSync(path.join(repo, "keep.ts"))).toBe(true)
    expect(fs.existsSync(path.join(repo, ".git"))).toBe(true)
    fs.rmSync(repo, { recursive: true, force: true })
  })
})

describe("isCached", () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-meta-"))
    file = path.join(dir, "x.meta.json")
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("is true only for a complete review with the same key", () => {
    // Arrange
    fs.writeFileSync(file, JSON.stringify({ cacheKey: "k", complete: true }))

    // Act / Assert
    expect(isCached(file, "k")).toBe(true)
    expect(isCached(file, "other")).toBe(false)
  })

  it("is false for a partial review, so the missing buckets are asked for again", () => {
    fs.writeFileSync(file, JSON.stringify({ cacheKey: "k", complete: false }))
    expect(isCached(file, "k")).toBe(false)
  })

  it("is false when the meta file is missing or corrupt, without failing", () => {
    expect(isCached(file, "k")).toBe(false)
    fs.writeFileSync(file, "{not json")
    expect(isCached(file, "k")).toBe(false)
  })
})
