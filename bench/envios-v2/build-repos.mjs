// Builds a git repository from the benchmark: `main` is the clean base and `pr-1` ... `pr-N` are branches that each
// add the files of prs/pr-N on top of it. It also resolves the answer key: every anchor text becomes the line it sits
// on in the final file of its pull request, and the windows are checked not to overlap.
//
//   node build-repos.mjs <output dir>
//
// The resolved key is written NEXT TO the repository (<output dir>.key.json), never inside it, so a reviewer who can
// read the repository cannot read the answers.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(process.argv[2] ?? "")
if (!process.argv[2]) {
  console.error("usage: node build-repos.mjs <output dir>")
  process.exit(2)
}
if (fs.existsSync(out)) {
  console.error(`${out} already exists: choose a new folder`)
  process.exit(2)
}

const key = JSON.parse(fs.readFileSync(path.join(here, "answer-key.json"), "utf8"))
const git = (...args) => execFileSync("git", args, { cwd: out, encoding: "utf8" })

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(source, target)
    else fs.copyFileSync(source, target)
  }
}

// 1. Resolve the key against the files of each pull request.
const resolved = { defects: [], decoys: [] }
const used = new Map()
function locate(item, anchor, window) {
  const file = path.join(here, "prs", `pr-${item.pr}`, item.file)
  if (!fs.existsSync(file)) throw new Error(`${item.id}: ${item.file} is not in prs/pr-${item.pr}`)
  const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")
  const hits = lines.map((line, index) => (line.includes(anchor) ? index + 1 : 0)).filter(Boolean)
  if (hits.length !== 1) throw new Error(`${item.id}: the anchor "${anchor}" must appear exactly once in ${item.file} (found ${hits.length})`)
  const line = hits[0]
  return { line, from: Math.max(1, line + window[0]), to: line + window[1] }
}
for (const kind of ["defects", "decoys"]) {
  for (const item of key[kind]) {
    const ranges = [locate(item, item.anchor, item.window), ...(item.also ?? []).map((extra) => locate(item, extra.anchor, extra.window))]
    const slot = `${item.pr}:${item.file}`
    for (const range of ranges) {
      for (const other of used.get(slot) ?? []) {
        if (range.from <= other.to && other.from <= range.to) throw new Error(`${item.id} (lines ${range.from}-${range.to}) overlaps ${other.id} (lines ${other.from}-${other.to}) in ${item.file}`)
      }
    }
    used.set(slot, [...(used.get(slot) ?? []), ...ranges.map((range) => ({ id: item.id, ...range }))])
    resolved[kind].push({ ...item, ranges })
  }
}

// 2. Build the repository.
copyDir(path.join(here, "base"), out)
git("init", "-q", "-b", "main")
git("config", "user.email", "bench@example.com")
git("config", "user.name", "Bench")
git("add", "-A")
git("commit", "-q", "-m", "base: modulo de envios")
git("update-ref", "refs/remotes/origin/main", "HEAD")
const PR_COUNT = Math.max(...key.defects.map((d) => d.pr))
for (let n = 1; n <= PR_COUNT; n++) {
  git("checkout", "-q", "-b", `pr-${n}`, "main")
  copyDir(path.join(here, "prs", `pr-${n}`), out)
  // git can take a file for unchanged when it has the same size and was written within the same second as the index
  // (a line that is only reordered): forget the index so every file is read again.
  git("rm", "-r", "--cached", "-q", "--ignore-unmatch", ".")
  git("add", "-A")
  git("commit", "-q", "-m", `pr-${n}: cambio`)
}
git("checkout", "-q", "main")

fs.writeFileSync(`${out}.key.json`, JSON.stringify(resolved, null, 2) + "\n")
console.log(`repository: ${out}`)
console.log(`resolved key: ${out}.key.json (${resolved.defects.length} defects, ${resolved.decoys.length} decoys)`)
