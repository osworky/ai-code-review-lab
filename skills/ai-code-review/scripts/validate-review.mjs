// Deterministic validator for the reviewer's JSON output. No model is involved: it checks structure,
// required fields, closed value sets and, optionally, that every cited location exists in the diff.
//
//   node scripts/validate-review.mjs review.json [--diff diff.patch]
//
// Exit code 0 = valid, 1 = invalid (one error per line), 2 = usage error.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const categories = ["correctness", "security", "performance", "missing_tests", "style", "documentation"]
export const severities = ["blocker", "advisory", "info"]

const topLevelFields = ["schema_version", "findings"]
const findingFields = ["rule_id", "category", "severity", "location", "message", "suggested_fix"]
const locationFields = ["file", "line"]
const ruleIdPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0

/**
 * Reads a unified diff and returns, per file, the new-side line ranges of every hunk.
 * @param {string} diffText
 * @returns {Map<string, Array<[number, number]>>}
 */
export function parseDiffRanges(diffText) {
  const ranges = new Map()
  let file = null
  let oldLeft = 0
  let newLeft = 0
  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    // A line that is not a hunk line (space, + or -) ends the hunk even if the header promised more.
    if ((oldLeft > 0 || newLeft > 0) && !/^[ +\-\\]|^$/.test(line)) {
      oldLeft = 0
      newLeft = 0
    }
    if (oldLeft > 0 || newLeft > 0) {
      // Inside a hunk: its header says how many lines follow, so a line that looks like a file header is just text.
      if (line.startsWith("+")) newLeft--
      else if (line.startsWith("-")) oldLeft--
      else if (!line.startsWith("\\")) {
        oldLeft--
        newLeft--
      }
      continue
    }
    const header = /^\+\+\+ (?:b\/([^\t]+)|\/dev\/null)(?:\t.*)?$/.exec(line)
    if (header) {
      // A deleted file (+++ /dev/null) has nothing in the new version to cite.
      file = header[1] ?? null
      if (file && !ranges.has(file)) ranges.set(file, [])
      continue
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      const start = Number(hunk[2])
      const count = hunk[3] === undefined ? 1 : Number(hunk[3])
      newLeft = count
      // A pure deletion (+N,0) adds no line to the new file: there is nothing there to cite.
      if (file && count > 0) ranges.get(file).push([start, start + count - 1])
    }
  }
  return ranges
}

/**
 * @param {string} text raw content of the reviewer output
 * @param {{ diffRanges?: Map<string, Array<[number, number]>> }} [options]
 * @returns {{ ok: boolean, errors: string[], review?: object }}
 */
export function validateReview(text, options = {}) {
  const errors = []
  const fail = (message) => errors.push(message)

  if (typeof text !== "string" || !text.trim()) return { ok: false, errors: ["output is empty"] }
  if (/^\s*```/.test(text)) return { ok: false, errors: ["output must be bare JSON, not a Markdown code block"] }

  let review
  try {
    review = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`output is not valid JSON: ${error.message}`] }
  }

  if (!isObject(review)) return { ok: false, errors: ["top level must be a JSON object"] }

  for (const key of Object.keys(review)) {
    if (!topLevelFields.includes(key)) fail(`unknown top-level field "${key}"`)
  }
  if (review.schema_version !== 1) fail('"schema_version" must be the number 1')
  if (!Array.isArray(review.findings)) {
    fail('"findings" must be an array (use [] when there are no findings)')
    return { ok: false, errors }
  }

  review.findings.forEach((finding, index) => {
    const at = `findings[${index}]`
    if (!isObject(finding)) return fail(`${at} must be an object`)

    for (const key of Object.keys(finding)) {
      if (!findingFields.includes(key)) fail(`${at}: unknown field "${key}"`)
    }
    for (const key of findingFields) {
      if (!(key in finding)) fail(`${at}: missing required field "${key}"`)
    }

    if ("rule_id" in finding && !(typeof finding.rule_id === "string" && ruleIdPattern.test(finding.rule_id))) {
      fail(`${at}: "rule_id" must be lowercase kebab-case, e.g. "missing-authorization"`)
    }
    if ("category" in finding && !categories.includes(finding.category)) {
      fail(`${at}: "category" must be one of ${categories.join(", ")} (got ${JSON.stringify(finding.category)})`)
    }
    if ("severity" in finding && !severities.includes(finding.severity)) {
      fail(`${at}: "severity" must be one of ${severities.join(", ")} (got ${JSON.stringify(finding.severity)})`)
    }
    if ("message" in finding && !isNonEmptyString(finding.message)) fail(`${at}: "message" must be a non-empty string`)
    if ("suggested_fix" in finding && !isNonEmptyString(finding.suggested_fix)) {
      fail(`${at}: "suggested_fix" must be a non-empty string`)
    }

    if ("location" in finding) {
      const location = finding.location
      if (!isObject(location)) {
        fail(`${at}: "location" must be an object with "file" and "line"`)
        return
      }
      for (const key of Object.keys(location)) {
        if (!locationFields.includes(key)) fail(`${at}.location: unknown field "${key}"`)
      }
      for (const key of locationFields) {
        if (!(key in location)) fail(`${at}.location: missing required field "${key}"`)
      }
      if ("file" in location && !isNonEmptyString(location.file)) fail(`${at}.location: "file" must be a non-empty string`)
      if ("line" in location && !(Number.isInteger(location.line) && location.line >= 1)) {
        fail(`${at}.location: "line" must be an integer >= 1`)
      }

      const ranges = options.diffRanges
      if (ranges && isNonEmptyString(location.file) && Number.isInteger(location.line)) {
        const fileRanges = ranges.get(location.file)
        if (!fileRanges) fail(`${at}.location: file "${location.file}" is not part of the diff`)
        else if (!fileRanges.some(([from, to]) => location.line >= from && location.line <= to)) {
          fail(`${at}.location: line ${location.line} of "${location.file}" is outside every changed hunk`)
        }
      }
    }
  })

  return { ok: errors.length === 0, errors, review: errors.length === 0 ? review : undefined }
}

function main(argv) {
  const args = argv.slice(2)
  const diffIndex = args.indexOf("--diff")
  const diffValueIndex = diffIndex >= 0 ? diffIndex + 1 : -1
  const diffPath = diffIndex >= 0 ? args[diffValueIndex] : undefined
  const reviewPath = args.find((arg, i) => !arg.startsWith("--") && i !== diffValueIndex)
  if (!reviewPath || (diffIndex >= 0 && !diffPath)) {
    console.error("usage: node scripts/validate-review.mjs review.json [--diff diff.patch]")
    return 2
  }

  const diffRanges = diffPath ? parseDiffRanges(readFileSync(diffPath, "utf8")) : undefined
  const result = validateReview(readFileSync(reviewPath, "utf8"), { diffRanges })
  if (result.ok) {
    console.log(`OK: ${result.review.findings.length} finding(s)`)
    return 0
  }
  console.error(`INVALID (${result.errors.length} error(s)):`)
  result.errors.forEach((error) => console.error(`- ${error}`))
  return 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv))
}
