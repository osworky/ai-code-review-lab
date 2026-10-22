// Decides how a pull request is reviewed before any model is called. No model is involved: the same diff and
// settings always give the same plan.
//
//   - which files changed and which reviewer each one goes to (typescript, python, infra, other)
//   - which size route the PR takes: skip | docs | small | large | over_budget
//   - a hash of the diff and a cache key that also covers the prompts, the schema and the model, so changing any
//     of them never reuses an old verdict
//   - a rough token estimate (characters / 4) to cap the cost

import { createHash } from "node:crypto"
import path from "node:path"

import { annotateFileDiff, normalizeDiff, splitDiff } from "./diff.mjs"

export const reviewers = ["typescript", "python", "infra", "other"]

/** Review files live here; they are the output of a review, never its input. */
export const REVIEWS_DIR = ".ai-review/reviews/"

const SKIPPED_NAMES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json"])
const SKIPPED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".svg", ".woff", ".woff2", ".pdf", ".xlsx", ".mp4"])
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst"])
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"])
const INFRA_EXTENSIONS = new Set([".yml", ".yaml", ".tf", ".toml"])

export const defaultConfig = {
  phase: "advisory",
  blockingRules: [],
  maxFindings: 15,
  maxVisible: 10,
  largeChangedLines: 200,
  maxDiffChars: 120000,
  charsPerToken: 4,
}

/**
 * @param {string} filePath
 * @returns {"skip" | "docs" | "typescript" | "python" | "infra" | "other"}
 */
export function classify(filePath) {
  const posix = filePath.replace(/\\/g, "/")
  const name = path.posix.basename(posix).toLowerCase()
  const ext = path.posix.extname(posix).toLowerCase()
  if (posix.startsWith(REVIEWS_DIR)) return "skip"
  if (SKIPPED_NAMES.has(name) || SKIPPED_EXTENSIONS.has(ext)) return "skip"
  if (DOC_EXTENSIONS.has(ext)) return "docs"
  if (ext === ".py") return "python"
  if (name === "dockerfile" || posix.startsWith(".github/workflows/") || INFRA_EXTENSIONS.has(ext)) return "infra"
  if (TYPESCRIPT_EXTENSIONS.has(ext)) return "typescript"
  return "other"
}

export function hashText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** A cached verdict is reusable only when the diff, prompts, schema, model and parameters all match. */
export function cacheKey(diffHash, promptHash, schemaVersion, model, params = "") {
  return hashText([diffHash, promptHash, String(schemaVersion), model, params].join("\u001f"))
}

/**
 * Removes the review files from a diff: a review judges the code, not itself.
 * @param {string} diffText
 */
export function withoutReviewFiles(diffText) {
  return splitDiff(diffText)
    .filter((file) => !file.path.startsWith(REVIEWS_DIR))
    .map((file) => file.text)
    .join("")
}

/**
 * @param {string} diffText
 * @param {{ promptHash: string, schemaVersion: number, model: string, params?: string, config?: Partial<typeof defaultConfig> }} options
 */
export function planReview(diffText, options) {
  const config = { ...defaultConfig, ...(options.config ?? {}) }
  const cleanDiff = withoutReviewFiles(diffText)
  const files = splitDiff(cleanDiff)
  const normalized = normalizeDiff(cleanDiff)
  const diffHash = hashText(normalized)
  const estimatedTokens = Math.ceil(normalized.length / config.charsPerToken)
  const maxTokens = Math.floor(config.maxDiffChars / config.charsPerToken)

  /** @type {Record<string, { files: string[], changedLines: number, diff: string }>} */
  const buckets = {}
  const skipped = []
  let docs = 0
  let changedNonDocs = 0
  for (const file of files) {
    const kind = classify(file.path)
    if (kind === "skip" || file.binary) {
      skipped.push(file.path)
      continue
    }
    if (kind === "docs") {
      docs++
      continue
    }
    buckets[kind] ??= { files: [], changedLines: 0, diff: "" }
    buckets[kind].files.push(file.path)
    buckets[kind].changedLines += file.added + file.removed
    buckets[kind].diff += annotateFileDiff(file.text)
    if (!buckets[kind].diff.endsWith("\n")) buckets[kind].diff += "\n"
    changedNonDocs += file.added + file.removed
  }

  let route
  let reason
  if (Object.keys(buckets).length === 0) {
    route = docs > 0 ? "docs" : "skip"
    reason = docs > 0 ? "only documentation changed" : "the diff changes no reviewable files"
  } else if (estimatedTokens > maxTokens) {
    route = "over_budget"
    reason = `about ${estimatedTokens} tokens exceed the ${maxTokens} budget`
  } else if (changedNonDocs >= config.largeChangedLines) {
    route = "large"
    reason = `${changedNonDocs} changed lines in code or other files (threshold ${config.largeChangedLines})`
  } else {
    route = "small"
    reason = `${changedNonDocs} changed lines in code or other files (threshold ${config.largeChangedLines})`
  }

  return {
    route,
    reason,
    diffHash,
    cacheKey: cacheKey(diffHash, options.promptHash, options.schemaVersion, options.model, options.params ?? ""),
    estimatedTokens,
    tokenEstimateIsAHeuristic: true,
    buckets,
    skipped,
    docsFiles: docs,
    // Whether a model should be called at all.
    needsReview: route === "small" || route === "large",
  }
}
