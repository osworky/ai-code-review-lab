// Scores the reviews of the benchmark against the resolved answer key, with no human judgement.
//
//   node score.mjs <resolved key> <folder with pr-1.json ... pr-6.json> [--json out.json]
//
// A finding HITS a defect when it cites the defect's file and a line inside its window. A finding that lands inside a
// decoy's window is a false alarm on a harmless change. Anything else is "excess": it may be a real problem nobody
// planted, so it is listed for a person to label, not counted as a mistake.

import fs from "node:fs"
import path from "node:path"

const [keyFile, reviewsDir, ...rest] = process.argv.slice(2)
if (!keyFile || !reviewsDir) {
  console.error("usage: node score.mjs <resolved key> <reviews dir> [--json out.json]")
  process.exit(2)
}
const key = JSON.parse(fs.readFileSync(keyFile, "utf8"))
const jsonOut = rest[0] === "--json" ? rest[1] : null

const inWindow = (finding, item) => finding.location.file === item.file && item.ranges.some((r) => finding.location.line >= r.from && finding.location.line <= r.to)

const perDefect = key.defects.map((d) => ({ id: d.id, pr: d.pr, category: d.category, origin: d.origin, kind: d.kind, hit: false, by: [] }))
const decoyAlarms = []
const excess = []
let findings = 0

for (let pr = 1; pr <= 6; pr++) {
  const file = path.join(reviewsDir, `pr-${pr}.json`)
  if (!fs.existsSync(file)) continue
  const review = JSON.parse(fs.readFileSync(file, "utf8"))
  for (const finding of review.findings) {
    findings++
    const defect = key.defects.find((d) => d.pr === pr && inWindow(finding, d))
    if (defect) {
      const row = perDefect.find((r) => r.id === defect.id)
      row.hit = true
      row.by.push(finding.rule_id)
      continue
    }
    const decoy = key.decoys.find((d) => d.pr === pr && inWindow(finding, d))
    if (decoy) decoyAlarms.push({ decoy: decoy.id, pr, rule_id: finding.rule_id, severity: finding.severity, at: `${finding.location.file}:${finding.location.line}` })
    else excess.push({ pr, rule_id: finding.rule_id, category: finding.category, severity: finding.severity, at: `${finding.location.file}:${finding.location.line}`, message: String(finding.message).slice(0, 200) })
  }
}

const rate = (rows) => ({ hits: rows.filter((r) => r.hit).length, of: rows.length })
const by = (field) => Object.fromEntries([...new Set(perDefect.map((r) => r[field]))].map((v) => [v, rate(perDefect.filter((r) => r[field] === v))]))

const summary = {
  findings,
  recall: rate(perDefect),
  byCategory: by("category"),
  byOrigin: by("origin"),
  byKind: by("kind"),
  decoyAlarms: { alarms: decoyAlarms.length, of: key.decoys.length },
  excess: excess.length,
  missed: perDefect.filter((r) => !r.hit).map((r) => r.id),
  perDefect,
  decoyDetail: decoyAlarms,
  excessDetail: excess,
}

const fmt = (r) => `${r.hits} de ${r.of}`
console.log(`Hallazgos: ${findings}`)
console.log(`Recall: ${fmt(summary.recall)}`)
console.log(`Por categoria: ${Object.entries(summary.byCategory).map(([k, v]) => `${k} ${fmt(v)}`).join(" | ")}`)
console.log(`Por origen:    ${Object.entries(summary.byOrigin).map(([k, v]) => `${k} ${fmt(v)}`).join(" | ")}`)
console.log(`Por tipo:      ${Object.entries(summary.byKind).map(([k, v]) => `${k} ${fmt(v)}`).join(" | ")}`)
console.log(`Alarmas en cambios inofensivos: ${summary.decoyAlarms.alarms} (de ${summary.decoyAlarms.of} cambios inofensivos)`)
console.log(`Exceso (a etiquetar): ${summary.excess}`)
console.log(`No vistos: ${summary.missed.join(", ") || "ninguno"}`)
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2) + "\n")
