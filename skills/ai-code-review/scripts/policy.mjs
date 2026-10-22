// What happens to a validated review in the current rollout phase. No model is involved: the same input always
// gives the same decision. The model's verdict is a signal; people decide what blocks, from measured agreement.
//
// Phases:
//   shadow    everything is recorded; nothing is shown and nothing blocks
//   advisory  findings are shown in a summary; nothing blocks, but `wouldBlock` is recorded for calibration
//   partial   only blocker findings whose rule_id is in `blockingRules` block
//   extended  every blocker finding blocks

export const PHASES = ["shadow", "advisory", "partial", "extended"]
const SEVERITY_RANK = { blocker: 0, advisory: 1, info: 2 }
const SEVERITY_LABEL = { blocker: "Bloqueante", advisory: "Advertencia", info: "Info" }

/** @typedef {{ rule_id: string, category: string, severity: "blocker" | "advisory" | "info", location: { file: string, line: number }, message: string, suggested_fix: string }} Finding */

const bySeverity = (a, b) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  a.location.file.localeCompare(b.location.file) ||
  a.location.line - b.location.line ||
  a.rule_id.localeCompare(b.rule_id)

/**
 * Drops duplicates (same file, line and rule) keeping the most severe, and sorts by severity.
 * @param {Finding[]} findings
 */
export function consolidate(findings) {
  const best = new Map()
  for (const finding of findings) {
    const key = `${finding.location.file}\u0000${finding.location.line}\u0000${finding.rule_id}`
    const current = best.get(key)
    if (!current || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[current.severity]) best.set(key, finding)
  }
  return [...best.values()].sort(bySeverity)
}

/**
 * Joins the reviews of several reviewers into one: consolidated, sorted, and capped (the most severe are kept).
 * @param {Array<{ findings: Finding[] }>} reviews
 * @param {number} maxFindings
 */
export function mergeReviews(reviews, maxFindings) {
  const all = reviews.flatMap((review) => review.findings)
  const consolidated = consolidate(all)
  return {
    review: { schema_version: 1, findings: consolidated.slice(0, maxFindings) },
    duplicatesRemoved: all.length - consolidated.length,
    droppedByCap: Math.max(consolidated.length - maxFindings, 0),
  }
}

/** @returns {"report" | "comment" | "block"} */
export function actionFor(finding, phase, blockingRules) {
  if (phase === "shadow") return "report"
  if (finding.severity === "info") return "report"
  if (finding.severity === "advisory") return "comment"
  if (phase === "extended") return "block"
  if (phase === "partial" && blockingRules.has(finding.rule_id)) return "block"
  return "comment"
}

/**
 * @param {Finding[]} findings
 * @param {string} phase
 * @param {{ blockingRules?: string[], maxVisible?: number }} [options]
 */
export function decide(findings, phase, options = {}) {
  if (!PHASES.includes(phase)) throw new Error(`phase must be one of ${PHASES.join(", ")}`)
  const blockingRules = new Set(options.blockingRules ?? [])
  const maxVisible = options.maxVisible ?? 10
  const consolidated = consolidate(findings)
  const actions = consolidated.map((finding) => ({ finding, action: actionFor(finding, phase, blockingRules) }))

  // Findings that block are never hidden by the cap; the cap only trims what is merely commented.
  const blocks = actions.filter((item) => item.action === "block")
  const comments = actions.filter((item) => item.action === "comment")
  const room = Math.max(maxVisible - blocks.length, 0)
  const visible = [...blocks, ...comments.slice(0, room)].sort((a, b) => bySeverity(a.finding, b.finding))

  return {
    phase,
    verdict: blocks.length > 0 ? "block" : "pass",
    // The signal the model would have given on its own; compared with human decisions to calibrate.
    wouldBlock: consolidated.some((finding) => finding.severity === "blocker"),
    blockingFindings: blocks.map(({ finding }) => ({ rule_id: finding.rule_id, file: finding.location.file, line: finding.location.line })),
    visible,
    suppressed: comments.length - Math.min(comments.length, room),
    duplicatesRemoved: findings.length - consolidated.length,
    counts: {
      blocker: consolidated.filter((f) => f.severity === "blocker").length,
      advisory: consolidated.filter((f) => f.severity === "advisory").length,
      info: consolidated.filter((f) => f.severity === "info").length,
    },
  }
}

/** The text comes from a model reading untrusted code: neutralise mentions, HTML and links. */
export function sanitize(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=\w)/g, "@\u200b")
    .replace(/\]\(/g, "]\u200b(")
    .replace(/:\/\//g, ":\u200b//")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
}

/** A path comes from the pull request, so it is untrusted too: no backtick may close the code span around it. */
export function sanitizePath(file) {
  return sanitize(file).replace(/`/g, "'")
}

/**
 * Prose for humans, built from the decision by code. The shadow phase shows nothing.
 * @param {ReturnType<typeof decide>} decision
 * @returns {string | null}
 */
export function renderSummary(decision) {
  if (decision.phase === "shadow") return null
  const heading = {
    advisory: "Revisión automática (consultiva: no bloquea el merge)",
    partial: "Revisión automática (bloqueo parcial)",
    extended: "Revisión automática (bloqueo ampliado)",
  }[decision.phase]
  const lines = [`### ${heading}`, ""]
  if (decision.verdict === "block") {
    lines.push(`**Este PR está bloqueado por ${decision.blockingFindings.length} hallazgo(s).**`)
  } else if (decision.wouldBlock) {
    lines.push("El revisor recomendaría bloquear este PR. **No bloquea**: su veredicto es una señal que se compara con la decisión humana.")
  } else if (decision.visible.length === 0) {
    lines.push("Sin hallazgos.")
  }
  lines.push("")
  for (const { finding, action } of decision.visible) {
    const marker = action === "block" ? "bloquea" : "no bloquea"
    lines.push(`- **${SEVERITY_LABEL[finding.severity]}** (${marker}) \`${sanitizePath(finding.location.file)}:${finding.location.line}\` · \`${finding.rule_id}\` · ${finding.category}`)
    lines.push(`  - ${sanitize(finding.message)}`)
    lines.push(`  - Sugerencia: ${sanitize(finding.suggested_fix)}`)
  }
  if (decision.suppressed > 0) {
    lines.push("", `_Se omitieron ${decision.suppressed} hallazgo(s) de menor prioridad por el tope de comentarios._`)
  }
  return lines.join("\n").trimEnd() + "\n"
}
