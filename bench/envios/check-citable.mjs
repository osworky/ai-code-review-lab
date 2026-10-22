// Checks that every defect and decoy of the benchmark can be cited by a reviewer: the line its anchor sits on must be a
// changed line of the pull request's diff (a reviewer cannot cite a line the diff does not change).
//
//   node check-citable.mjs <repository made by build-repos.mjs> <resolved key>

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const { parseDiffRanges } = await import(pathToFileURL(path.join(here, "..", "..", "skills", "ai-code-review", "scripts", "validate-review.mjs")).href)

const [repo, keyFile] = process.argv.slice(2)
if (!repo || !keyFile) {
  console.error("usage: node check-citable.mjs <repository> <resolved key>")
  process.exit(2)
}
const key = JSON.parse(fs.readFileSync(keyFile, "utf8"))
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })

let bad = 0
for (let pr = 1; pr <= 6; pr++) {
  const ranges = parseDiffRanges(git("diff", "--no-color", `main...pr-${pr}`))
  for (const item of [...key.defects, ...key.decoys].filter((i) => i.pr === pr)) {
    const spans = ranges.get(item.file) ?? []
    const line = item.ranges[0].line
    const citable = spans.some(([from, to]) => line >= from && line <= to)
    const text = (git("show", `pr-${pr}:${item.file}`).split("\n")[line - 1] ?? "").trim().slice(0, 62)
    if (!citable) bad++
    console.log(`${citable ? "ok " : "NO "} ${item.id} pr-${pr} ${item.file}:${line} ${text}`)
  }
}
console.log(bad ? `${bad} anchor(s) on lines the diff does not change` : "every anchor sits on a changed line")
process.exit(bad ? 1 : 0)
