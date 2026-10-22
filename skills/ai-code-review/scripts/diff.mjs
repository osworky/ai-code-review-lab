// Reading a unified diff: files, hunks, counts, and the text the reviewer sees.
//
// The reviewer cites a line of the NEW version of a file. On a diff with several files, a model that counts lines
// by itself often numbers them across the whole patch, so `annotateFileDiff` writes the real number at the start
// of every line that exists in the new file.

/**
 * @typedef {{ path: string, status: "added" | "deleted" | "modified" | "renamed", binary: boolean, added: number, removed: number, text: string }} DiffFile
 */

/**
 * Splits a unified diff into one entry per file.
 * @param {string} diffText
 * @returns {DiffFile[]}
 */
export function splitDiff(diffText) {
  const text = diffText.replace(/\r\n/g, "\n")
  const chunks = text.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "))
  return chunks.map((chunk) => {
    const header = /^diff --git a\/(.+) b\/(.+)$/m.exec(chunk)
    const path = header ? header[2] : "unknown"
    const lines = chunk.split("\n")
    let status = "modified"
    if (/^new file mode/m.test(chunk)) status = "added"
    else if (/^deleted file mode/m.test(chunk)) status = "deleted"
    else if (/^rename from /m.test(chunk)) status = "renamed"
    const binary = /^Binary files /m.test(chunk) || /^GIT binary patch/m.test(chunk)
    // Inside a hunk the header says how many old and new lines follow, so a removed line whose text is "--"
    // (a YAML or Markdown separator) is a change, not a file header.
    let added = 0
    let removed = 0
    let oldLeft = 0
    let newLeft = 0
    for (const line of lines) {
      // A line that is not a hunk line (space, + or -) ends the hunk even if the header promised more.
      if ((oldLeft > 0 || newLeft > 0) && !/^[ +\-\\]|^$/.test(line)) {
        oldLeft = 0
        newLeft = 0
      }
      if (oldLeft <= 0 && newLeft <= 0) {
        const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
        if (hunk) {
          oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
          newLeft = hunk[2] === undefined ? 1 : Number(hunk[2])
        }
        continue
      }
      if (line.startsWith("+")) {
        added++
        newLeft--
      } else if (line.startsWith("-")) {
        removed++
        oldLeft--
      } else if (!line.startsWith("\\")) {
        oldLeft--
        newLeft--
      }
    }
    return { path, status, binary, added, removed, text: chunk.endsWith("\n") ? chunk : chunk + "\n" }
  })
}

/**
 * Same diff with the line number of the new file at the start of every context and added line ("  42| code").
 * Removed lines get blank padding: they do not exist in the new file and cannot be cited.
 * @param {string} fileDiffText the text of ONE file, as returned in `DiffFile.text`
 */
export function annotateFileDiff(fileDiffText) {
  const out = []
  let newLine = 0
  let inHunk = false
  const width = 5
  for (const line of fileDiffText.replace(/\r\n/g, "\n").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      newLine = Number(hunk[1])
      inHunk = true
      out.push(line)
      continue
    }
    if (!inHunk || line === "" || line.startsWith("\\ No newline")) {
      out.push(line)
      continue
    }
    if (line.startsWith("-")) {
      out.push(`${" ".repeat(width)}| ${line}`)
    } else {
      out.push(`${String(newLine).padStart(width)}| ${line}`)
      newLine++
    }
  }
  return out.join("\n")
}

/**
 * Removes what changes without the content changing: line endings and blob hashes.
 * @param {string} diffText
 */
export function normalizeDiff(diffText) {
  const kept = diffText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^(index |similarity index|rename from|rename to)/.test(line))
  return kept.join("\n").trim() + "\n"
}
