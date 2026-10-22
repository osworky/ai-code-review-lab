// The ledger: one line of JSON per event, appended, never rewritten. It turns every review into data.
//
//   finding     what the reviewer said (written by `merge`)
//   resolution  what a person decided about one finding: A real and actionable, M real but minor, R noise
//   missed      a real defect the reviewer did not report (found later by a person, a test or an audit)
//   audit       a pull request that was audited in full by someone else, without looking at the reviewer's output
//
// Precision comes from the findings that have a label. Recall can only be estimated from the audited pull requests:
// the rest of the ledger holds what the reviewer raised, which is not a random sample of everything it could have said.

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const LEDGER_FILE = ".ai-review/ledger.jsonl"
export const LABELS = ["A", "M", "R"]
export const MIN_ROWS = 30
const CATEGORIES = ["correctness", "security", "performance", "missing_tests", "style", "documentation"]

/** 95 % Wilson score interval for k out of n. */
export function wilson(k, n) {
  if (n === 0) return [0, 0]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

export function readEvents(file = LEDGER_FILE) {
  if (!fs.existsSync(file)) return []
  const events = []
  for (const [index, line] of fs.readFileSync(file, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue
    try {
      events.push(JSON.parse(line))
    } catch {
      throw new Error(`${file} line ${index + 1} is not valid JSON: the ledger is append-only, fix or remove that line`)
    }
  }
  return events
}

export function appendEvents(events, file = LEDGER_FILE) {
  if (events.length === 0) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n")
}

/** A finding id is stable for the same review of the same diff, so recording twice is detected. */
export function findingId(slug, diffHash, finding) {
  const text = [slug, diffHash, finding.rule_id, finding.location.file, finding.location.line].join("\u001f")
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 10)
}

/**
 * The events to append for a merged review. Nothing is added when this slug and diff were already recorded.
 * @param {{ events: object[], slug: string, meta: { diffHash: string, promptHash?: string, model?: string }, review: { findings: any[] }, at?: string }} input
 */
export function recordReview({ events, slug, meta, review, at = new Date().toISOString() }) {
  const known = events.some((event) => event.type === "finding" && event.slug === slug && event.diffHash === meta.diffHash)
  if (known) return { added: [], skipped: true }
  const added = review.findings.map((finding) => ({
    type: "finding",
    id: findingId(slug, meta.diffHash, finding),
    slug,
    diffHash: meta.diffHash,
    promptHash: meta.promptHash ?? null,
    model: meta.model ?? null,
    at,
    rule_id: finding.rule_id,
    category: finding.category,
    severity: finding.severity,
    file: finding.location.file,
    line: finding.location.line,
    message: String(finding.message).slice(0, 300),
  }))
  return { added, skipped: false }
}

export function resolutionEvent({ events, id, label, note = "", by = null, at = new Date().toISOString() }) {
  if (!LABELS.includes(label)) throw new Error(`--label must be one of ${LABELS.join(", ")}`)
  const matches = events.filter((event) => event.type === "finding" && event.id.startsWith(id))
  if (matches.length === 0) throw new Error(`no finding with id "${id}" in the ledger`)
  if (matches.length > 1) throw new Error(`id "${id}" matches ${matches.length} findings: use more characters`)
  return { type: "resolution", id: matches[0].id, label, note, by, at }
}

export function missedEvent({ category, note, slug = null, file = null, line = null, source = "human_review", by = null, at = new Date().toISOString() }) {
  if (!CATEGORIES.includes(category)) throw new Error(`--category must be one of ${CATEGORIES.join(", ")}`)
  if (typeof note !== "string" || note.trim() === "") throw new Error("--note must say what the reviewer did not see")
  if (!["human_review", "post_merge", "audit_sample"].includes(source)) throw new Error("--source must be human_review, post_merge or audit_sample")
  return { type: "missed", category, note, slug, file, line, source, by, at }
}

export function auditEvent({ slug, note = "", by = null, at = new Date().toISOString() }) {
  if (typeof slug !== "string" || slug.trim() === "") throw new Error("--slug is required")
  return { type: "audit", slug, note, by, at }
}

/** The state of the ledger: each finding with its latest label, the missed defects and the audited pull requests. */
export function foldLedger(events) {
  const findings = new Map()
  const missed = []
  const audited = new Set()
  for (const event of events) {
    if (event.type === "finding") findings.set(event.id, { ...event, label: null, note: "" })
    else if (event.type === "resolution" && findings.has(event.id)) Object.assign(findings.get(event.id), { label: event.label, note: event.note })
    else if (event.type === "missed") missed.push(event)
    else if (event.type === "audit") audited.add(event.slug)
  }
  return { findings: [...findings.values()], missed, audited }
}

function rate(k, n) {
  if (n === 0) return { k, n, value: null, low: null, high: null }
  const [low, high] = wilson(k, n)
  return { k, n, value: k / n, low, high }
}

/**
 * The numbers of the ledger. Every rate carries its interval and, below MIN_ROWS, the word "insufficient".
 * @param {ReturnType<typeof foldLedger>} state
 */
export function buildReport(state) {
  const labelled = state.findings.filter((finding) => finding.label !== null)
  const count = (rows, label) => rows.filter((row) => row.label === label).length
  const summarize = (rows) => {
    const n = rows.length
    return {
      n,
      A: count(rows, "A"),
      M: count(rows, "M"),
      R: count(rows, "R"),
      strict: rate(count(rows, "A"), n),
      broad: rate(count(rows, "A") + count(rows, "M"), n),
      noise: rate(count(rows, "R"), n),
      insufficient: n < MIN_ROWS,
    }
  }
  const byCategory = {}
  for (const category of CATEGORIES) byCategory[category] = summarize(labelled.filter((finding) => finding.category === category))

  // Recall only over the pull requests that someone audited in full: there the reviewer's true positives and the
  // missed defects are both known.
  const inAudit = (slug) => state.audited.has(slug)
  const auditedTruePositives = labelled.filter((finding) => inAudit(finding.slug) && (finding.label === "A" || finding.label === "M")).length
  const auditedMissed = state.missed.filter((item) => item.slug && inAudit(item.slug)).length
  const recall = rate(auditedTruePositives, auditedTruePositives + auditedMissed)
  recall.insufficient = auditedTruePositives + auditedMissed < MIN_ROWS

  return {
    findings: state.findings.length,
    unresolved: state.findings.length - labelled.length,
    overall: summarize(labelled),
    byCategory,
    missed: state.missed.length,
    auditedPullRequests: state.audited.size,
    auditedRecall: recall,
  }
}

const pct = (r) => (r.value === null ? "n/a" : `${(100 * r.value).toFixed(0)} % (IC 95 % ${(100 * r.low).toFixed(0)} a ${(100 * r.high).toFixed(0)} %)`)

export function renderReport(report) {
  const lines = ["# Informe del registro de revisiones", ""]
  lines.push(`Hallazgos registrados: ${report.findings}. Sin etiqueta todavía: ${report.unresolved}. Defectos que el revisor no vio (anotados): ${report.missed}. PR auditados por otra vía: ${report.auditedPullRequests}.`, "")
  lines.push("## Precisión (solo hallazgos con etiqueta)", "")
  const o = report.overall
  lines.push(`n = ${o.n}${o.insufficient ? ` (**datos insuficientes**: menos de ${MIN_ROWS} filas)` : ""}`)
  lines.push(`- Accionables (A): ${o.A}, ${pct(o.strict)}`)
  lines.push(`- Accionables o menores (A + M): ${o.A + o.M}, ${pct(o.broad)}`)
  lines.push(`- Ruido (R): ${o.R}, ${pct(o.noise)}`, "")
  lines.push("| Categoría | n | A | M | R | Precisión amplia | Estado |", "|---|---|---|---|---|---|---|")
  for (const [category, row] of Object.entries(report.byCategory)) {
    lines.push(`| ${category} | ${row.n} | ${row.A} | ${row.M} | ${row.R} | ${row.n ? pct(row.broad) : "n/a"} | ${row.insufficient ? "datos insuficientes" : "suficiente"} |`)
  }
  lines.push("", "## Recall (solo PR auditados)", "")
  const r = report.auditedRecall
  lines.push(r.n === 0 ? "Sin PR auditados con hallazgos o defectos anotados: no hay recall." : `El revisor vio ${r.k} de los ${r.n} defectos conocidos en esos PR: ${pct(r)}${r.insufficient ? " (**datos insuficientes**)" : ""}.`, "")
  lines.push("## Cómo leerlo", "")
  lines.push("- La precisión sale de lo que el revisor **levantó**, no de una muestra aleatoria: describe cómo salieron esos hallazgos, no todo lo que podría decir. Las filas de un mismo PR no son independientes.")
  lines.push("- El recall solo se estima con los PR que alguien auditó por otra vía sin mirar la salida del revisor. Sin auditorías no hay falsos negativos medidos.")
  lines.push("- Un solo etiquetador y un solo modelo no generalizan a otros. Cambiar el prompt o el modelo reinicia la lectura de lo que viene después.")
  return lines.join("\n") + "\n"
}
