// Command line of the ai-code-review skill. Run it from the root of the repository you are reviewing.
//
//   node scripts/cli.mjs prepare [--base origin/main] [--out .review-work] [--model id]
//       splits the diff by reviewer, writes the annotated diff of each bucket and the plan
//   node scripts/cli.mjs merge [--out .review-work] [--slug name] [--model id] [--allow-partial] [--no-ledger]
//       validates the review of each bucket, joins them, writes .ai-review/reviews/<slug>.json (+ .meta.json)
//       and records every finding in the ledger (.ai-review/ledger.jsonl)
//   node scripts/cli.mjs check [--base origin/main] [--phase advisory] [--summary file]
//       CI: validates the review files of the pull request against its diff and applies the rollout phase
//   node scripts/cli.mjs ledger resolve --id <id> --label A|M|R [--note text] [--by name]
//   node scripts/cli.mjs ledger missed --category <category> --note text [--slug s] [--file f] [--line n] [--source human_review|post_merge|audit_sample]
//   node scripts/cli.mjs ledger audit --slug <slug> [--note text]
//   node scripts/cli.mjs ledger list [--open]
//   node scripts/cli.mjs ledger report [--out file.md]
//
// The model is called by the skill (see SKILL.md), never from here or from CI.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { REVIEWS_DIR, defaultConfig, hashText, planReview, reviewers, withoutReviewFiles } from "./route.mjs"
import { LEDGER_FILE, appendEvents, auditEvent, buildReport, foldLedger, missedEvent, readEvents, recordReview, renderReport, resolutionEvent } from "./ledger.mjs"
import { PHASES, decide, mergeReviews, renderSummary } from "./policy.mjs"
import { parseDiffRanges, validateReview } from "./validate-review.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
/** The root of the skill: where prompts/, rubric.md, review.schema.json and config.default.json live. */
const skillRoot = path.join(here, "..")
const SCHEMA_VERSION = 1

const PROJECT_DIR = ".ai-review"

/** The skill's defaults, then the overrides of the project being reviewed (`.ai-review/config.json`). */
export function loadConfig(dir = skillRoot, projectRoot = process.cwd()) {
  const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {})
  const defaults = read(path.join(dir, "config.default.json"))
  const project = read(path.join(projectRoot, PROJECT_DIR, "config.json"))
  return { ...defaultConfig, ...defaults, ...project }
}

/** The project's own context for the reviewers, or null. It is part of what shapes a review, so it is hashed. */
export function projectContext(projectRoot = process.cwd()) {
  const file = path.join(projectRoot, PROJECT_DIR, "context.md")
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null
}

/** One hash for everything that shapes a review: the prompts, the rubric, the schema and the project context. */
export function promptHash(skillDir = skillRoot, projectRoot = process.cwd()) {
  const promptsDir = path.join(skillDir, "prompts")
  const files = fs.existsSync(promptsDir) ? fs.readdirSync(promptsDir).filter((name) => name.endsWith(".md")).sort() : []
  const parts = files.map((name) => `${name}\n${fs.readFileSync(path.join(promptsDir, name), "utf8").replace(/\r\n/g, "\n")}`)
  const rubric = fs.readFileSync(path.join(skillDir, "rubric.md"), "utf8").replace(/\r\n/g, "\n")
  const schema = fs.readFileSync(path.join(skillDir, "review.schema.json"), "utf8").replace(/\r\n/g, "\n")
  return hashText([...parts, rubric, schema, projectContext(projectRoot) ?? ""].join("\n---\n"))
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
}

/** Reads a file only when it is a regular file: a symbolic link in a pull request could point at a file of the runner. */
export function readRegular(file) {
  const stat = fs.lstatSync(file)
  return stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(file, "utf8") : null
}

/** A text option must come with a value: a bare flag arrives as true. */
export function stringOption(options, name, fallback) {
  const value = options[name]
  if (value === undefined) return fallback
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${name} needs a value`)
  return value
}

export function slugOf(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "review"
}

/**
 * The folder prepare empties and rewrites. It must be a name inside the current directory, and a folder that already
 * has something in it must be one this command made before (it holds plan.json), so a wrong --out never deletes
 * someone else's files.
 * @param {unknown} out
 * @param {string} [cwd]
 */
export function safeOutDir(out, cwd = process.cwd()) {
  if (typeof out !== "string" || out.trim() === "") throw new Error("--out needs a folder name")
  const root = path.resolve(cwd)
  const target = path.resolve(root, out)
  const relative = path.relative(root, target)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`--out must be a folder inside the current directory, not "${out}"`)
  }
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new Error(`--out "${out}" exists and is not a folder`)
    if (fs.readdirSync(target).length > 0 && !fs.existsSync(path.join(target, "plan.json"))) {
      throw new Error(`--out "${out}" has files this command did not write (no plan.json): not deleting it`)
    }
  }
  return target
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue
    const name = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) options[name] = true
    else {
      options[name] = next
      i++
    }
  }
  return options
}

// ---------------------------------------------------------------------------------------------- prepare

/** A review is reusable when it is complete, was made for this same diff, prompts, schema and model, and can be read. */
export function isCached(metaFile, cacheKey) {
  if (!fs.existsSync(metaFile)) return false
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"))
    return meta.cacheKey === cacheKey && meta.complete === true
  } catch {
    return false
  }
}

function runPrepare(options) {
  const base = stringOption(options, "base", "origin/main")
  const out = path.relative(process.cwd(), safeOutDir(options.out ?? ".review-work"))
  const diffText = git(["-c", "core.quotePath=false", "diff", "--no-color", `${base}...HEAD`])
  const plan = planReview(diffText, {
    promptHash: promptHash(),
    schemaVersion: SCHEMA_VERSION,
    model: stringOption(options, "model", "unspecified"),
    config: loadConfig(),
  })

  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, "all.patch"), withoutReviewFiles(diffText))
  const summary = {}
  for (const [bucket, data] of Object.entries(plan.buckets)) {
    fs.writeFileSync(path.join(out, `${bucket}.diff`), data.diff)
    summary[bucket] = { files: data.files, changedLines: data.changedLines }
  }
  const slug = slugOf(stringOption(options, "slug", git(["rev-parse", "--abbrev-ref", "HEAD"]).trim()))
  const metaFile = path.join(REVIEWS_DIR, `${slug}.meta.json`)
  const cached = isCached(metaFile, plan.cacheKey)
  const { buckets: _ignored, ...rest } = plan
  fs.writeFileSync(path.join(out, "plan.json"), JSON.stringify({ ...rest, base, slug, cached, buckets: summary }, null, 2) + "\n")

  console.log(`route=${plan.route} (${plan.reason})`)
  console.log(`diff ${plan.diffHash.slice(0, 12)}, about ${plan.estimatedTokens} tokens (a heuristic)`)
  for (const [bucket, data] of Object.entries(summary)) console.log(`- ${bucket}: ${data.files.length} file(s), ${data.changedLines} changed line(s) -> ${path.join(out, bucket + ".diff")}`)
  if (plan.skipped.length) console.log(`skipped: ${plan.skipped.join(", ")}`)
  if (cached) console.log("cached: a review with the same diff, prompts, schema and model already exists; nothing to do")
  return 0
}

// ------------------------------------------------------------------------------------------------ merge

export function mergeBucketReviews({ plan, readReview, allPatch, maxFindings }) {
  const ranges = parseDiffRanges(allPatch)
  const valid = []
  const buckets = {}
  for (const bucket of Object.keys(plan.buckets)) {
    const text = readReview(bucket)
    if (text === null) {
      buckets[bucket] = { status: "missing", findings: 0 }
      continue
    }
    const result = validateReview(text, { diffRanges: ranges })
    if (!result.ok) {
      buckets[bucket] = { status: "invalid", findings: 0, errors: result.errors }
      continue
    }
    buckets[bucket] = { status: "valid", findings: result.review.findings.length }
    valid.push(result.review)
  }
  const merged = mergeReviews(valid, maxFindings)
  return { ...merged, buckets, complete: Object.values(buckets).every((item) => item.status === "valid") }
}

function runMerge(options) {
  const out = options.out === undefined ? ".review-work" : String(options.out)
  const plan = JSON.parse(fs.readFileSync(path.join(out, "plan.json"), "utf8"))
  const allPatch = fs.readFileSync(path.join(out, "all.patch"), "utf8")
  const config = loadConfig()
  const result = mergeBucketReviews({
    plan,
    allPatch,
    maxFindings: config.maxFindings,
    readReview: (bucket) => {
      const file = path.join(out, `${bucket}.review.json`)
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
    },
  })

  for (const [bucket, data] of Object.entries(result.buckets)) {
    console.log(`- ${bucket}: ${data.status}${data.status === "valid" ? ` (${data.findings} finding(s))` : ""}`)
    for (const error of data.errors ?? []) console.log(`    ${error}`)
  }
  if (!result.complete && !options["allow-partial"]) {
    console.error("Some reviews are missing or invalid: ask the reviewer again for those buckets (or use --allow-partial).")
    return 1
  }

  const slug = slugOf(stringOption(options, "slug", plan.slug))
  fs.mkdirSync(REVIEWS_DIR, { recursive: true })
  fs.writeFileSync(path.join(REVIEWS_DIR, `${slug}.json`), JSON.stringify(result.review, null, 2) + "\n")
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    diffHash: plan.diffHash,
    cacheKey: plan.cacheKey,
    promptHash: promptHash(),
    model: stringOption(options, "model", "unspecified"),
    base: plan.base,
    route: plan.route,
    createdAt: new Date().toISOString(),
    complete: result.complete,
    buckets: result.buckets,
    duplicatesRemoved: result.duplicatesRemoved,
    droppedByCap: result.droppedByCap,
  }
  fs.writeFileSync(path.join(REVIEWS_DIR, `${slug}.meta.json`), JSON.stringify(meta, null, 2) + "\n")
  console.log(`wrote ${REVIEWS_DIR}${slug}.json (${result.review.findings.length} finding(s), ${result.duplicatesRemoved} duplicate(s) removed, ${result.droppedByCap} dropped by the cap)`)
  if (!options["no-ledger"]) {
    const recorded = recordReview({ events: readEvents(), slug, meta, review: result.review })
    appendEvents(recorded.added)
    console.log(recorded.skipped ? "ledger: this review of this diff was already recorded" : `ledger: ${recorded.added.length} finding(s) recorded in ${LEDGER_FILE}`)
  }
  return 0
}

// ----------------------------------------------------------------------------------------------- check

/**
 * Validates the review files of a pull request against its diff and applies the rollout phase.
 * Everything comes in as data so it can be tested without git.
 * @param {{ diffText: string, reviewFiles: Array<{ name: string, text: string, metaText?: string | null }>, phase?: string, config?: object, currentPromptHash?: string }} input
 */
export function checkReviews({ diffText, reviewFiles, phase, config = defaultConfig, currentPromptHash }) {
  const effectivePhase = phase ?? config.phase
  if (!PHASES.includes(effectivePhase)) throw new Error(`phase must be one of ${PHASES.join(", ")}`)
  const cleanDiff = withoutReviewFiles(diffText)
  const plan = planReview(cleanDiff, { promptHash: currentPromptHash ?? "", schemaVersion: SCHEMA_VERSION, model: "check", config })
  const ranges = parseDiffRanges(cleanDiff)
  const lines = ["## Revisión automática del PR", ""]
  let exitCode = 0
  const results = []

  if (reviewFiles.length === 0) {
    lines.push(
      plan.route === "over_budget"
        ? `El diff de este PR es demasiado grande para revisarlo con IA (${plan.reason}): **no se revisó**. Conviene dividir el PR. No bloquea.`
        : plan.needsReview
          ? `Este PR cambia código (${plan.route}: ${plan.reason}) y **no trae revisión adjunta**. Ejecuta la skill ai-code-review en local y sube \`${REVIEWS_DIR}\`. No bloquea.`
          : `Este PR no necesita revisión con IA (${plan.reason}).`,
    )
    return { exitCode, summary: lines.join("\n") + "\n", results, plan }
  }

  for (const file of reviewFiles) {
    const validation = file.error ? { ok: false, errors: [file.error] } : validateReview(file.text, { diffRanges: ranges })
    const meta = file.metaText ? safeJson(file.metaText) : null
    lines.push(`### \`${file.name}\``, "")
    if (!validation.ok) {
      lines.push("**La revisión no es válida y no se aplica la política** (no bloquea):", "")
      for (const error of validation.errors.slice(0, 15)) lines.push(`- ${error}`)
      if (validation.errors.length > 15) lines.push(`- … y ${validation.errors.length - 15} más`)
      lines.push("")
      results.push({ name: file.name, valid: false, errors: validation.errors })
      continue
    }
    if (!meta?.diffHash) {
      lines.push("**No se puede comprobar si la revisión está al día** (falta el archivo `.meta.json` o su `diffHash`): se trata como desactualizada.", "")
    } else if (meta.diffHash !== plan.diffHash) {
      lines.push("**Revisión desactualizada:** el diff del PR cambió después de revisarlo (otro hash). Vuelve a ejecutar la skill ai-code-review.", "")
    }
    if (meta?.complete === false) lines.push("La revisión está **incompleta** (faltaban revisores).", "")
    if (currentPromptHash && meta?.promptHash && meta.promptHash !== currentPromptHash) {
      lines.push("Los prompts cambiaron desde esta revisión.", "")
    }
    const decision = decide(validation.review.findings, effectivePhase, { blockingRules: config.blockingRules, maxVisible: config.maxVisible })
    const text = renderSummary(decision)
    lines.push(
      text ?? `Fase \`${effectivePhase}\`: ${decision.counts.blocker} bloqueante(s), ${decision.counts.advisory} advertencia(s), ${decision.counts.info} info; solo se registra.`,
      "",
    )
    results.push({ name: file.name, valid: true, decision })
    if (decision.verdict === "block") exitCode = 1
  }
  return { exitCode, summary: lines.join("\n") + "\n", results, plan }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function runCheck(options) {
  const base = options.base ?? "origin/main"
  const config = loadConfig()
  const diffText = git(["-c", "core.quotePath=false", "diff", "--no-color", `${base}...HEAD`])
  const changed = git(["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`]).split("\n").filter(Boolean)
  const reviewFiles = changed
    .filter((name) => name.startsWith(REVIEWS_DIR) && name.endsWith(".json") && !name.endsWith(".meta.json"))
    .map((name) => ({
      name,
      text: readRegular(name) ?? "",
      error: readRegular(name) === null ? "the review file is not a regular file (a link or a folder): it is not read" : undefined,
      metaText: fs.existsSync(name.replace(/\.json$/, ".meta.json")) ? readRegular(name.replace(/\.json$/, ".meta.json")) : null,
    }))
  const result = checkReviews({ diffText, reviewFiles, phase: options.phase, config, currentPromptHash: promptHash() })
  const target = options.summary || process.env.GITHUB_STEP_SUMMARY
  if (target && target !== true) fs.appendFileSync(target, result.summary)
  console.log(result.summary)
  return result.exitCode
}

// -------------------------------------------------------------------------------------------- ledger

function optionalString(options, name) {
  return options[name] === undefined ? null : stringOption(options, name, "")
}

function runLedger(sub, options) {
  const events = readEvents()
  switch (sub) {
    case "resolve": {
      const event = resolutionEvent({
        events,
        id: stringOption(options, "id", ""),
        label: stringOption(options, "label", ""),
        note: optionalString(options, "note") ?? "",
        by: optionalString(options, "by"),
      })
      appendEvents([event])
      console.log(`ledger: finding ${event.id} labelled ${event.label}`)
      return 0
    }
    case "missed": {
      const line = optionalString(options, "line")
      const event = missedEvent({
        category: stringOption(options, "category", ""),
        note: stringOption(options, "note", ""),
        slug: optionalString(options, "slug"),
        file: optionalString(options, "file"),
        line: line === null ? null : Number(line),
        source: stringOption(options, "source", "human_review"),
        by: optionalString(options, "by"),
      })
      appendEvents([event])
      console.log(`ledger: missed defect recorded (${event.category}, source ${event.source})`)
      return 0
    }
    case "audit": {
      const event = auditEvent({ slug: stringOption(options, "slug", ""), note: optionalString(options, "note") ?? "" })
      appendEvents([event])
      console.log(`ledger: pull request ${event.slug} marked as audited`)
      return 0
    }
    case "list": {
      const state = foldLedger(events)
      const rows = state.findings.filter((finding) => !options.open || finding.label === null)
      for (const f of rows) console.log(`${f.id}  ${f.label ?? "-"}  ${f.severity.padEnd(8)} ${f.category.padEnd(13)} ${f.file}:${f.line}  ${f.rule_id}  (${f.slug})`)
      console.log(`${rows.length} finding(s)${options.open ? " without a label" : ""}`)
      return 0
    }
    case "report": {
      const text = renderReport(buildReport(foldLedger(events)))
      if (options.out && options.out !== true) fs.writeFileSync(String(options.out), text)
      console.log(text)
      return 0
    }
    default:
      console.error("usage: node scripts/cli.mjs ledger resolve|missed|audit|list|report [options]")
      return 2
  }
}

// ---------------------------------------------------------------------------------------------- main

function main(argv) {
  const [command, ...rest] = argv.slice(2)
  const options = parseArgs(rest)
  try {
    switch (command) {
      case "prepare":
        return runPrepare(options)
      case "merge":
        return runMerge(options)
      case "check":
        return runCheck(options)
      case "ledger":
        return runLedger(rest[0], parseArgs(rest.slice(1)))
      default:
        console.error("usage: node scripts/cli.mjs prepare|merge|check|ledger [options]   (see the header of this file)")
        return 2
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv))
}

export { reviewers }
