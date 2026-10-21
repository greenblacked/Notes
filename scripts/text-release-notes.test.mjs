import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/text-release-notes.sh",
)
const dir = mkdtempSync(join(tmpdir(), "text-notes-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const list = join(dir, "changed.tsv")
writeFileSync(list, "A\tcontent/a.md\nM\tcontent/dir/b.md\nD\tcontent/c.png\n")

const run = (...args) => spawnSync("bash", [script, ...args], { encoding: "utf8" })

test("the notes list the pull request and the changed notes", () => {
  const r = run("v0.6.0", "v0.6.1", "74", "text/fix-typo", list)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(
    r.stdout,
    [
      "Content-only release from pull request #74 (`text/fix-typo`), on top of v0.6.0. No code or configuration changed since v0.6.0; stage was not used.",
      "",
      "Notes changed:",
      "- added `content/a.md`",
      "- changed `content/dir/b.md`",
      "- removed `content/c.png`",
      "",
    ].join("\n"),
  )
})

test("bad arguments are rejected", () => {
  const bad = [
    ["0.6.0", "v0.6.1", "74", "text/x", list],
    ["v0.6.0", "v0.6", "74", "text/x", list],
    ["v0.6.0", "v0.6.1", "7a", "text/x", list],
    ["v0.6.0", "v0.6.1", "74", "feat/x", list],
    ["v0.6.0", "v0.6.1", "74", "text/Bad", list],
    ["v0.6.0", "v0.6.1", "74", "text/x", join(dir, "missing.tsv")],
    ["v0.6.0", "v0.6.1", "74", "text/x"],
  ]
  for (const args of bad) assert.equal(run(...args).status, 1, args.join(" "))
})

test("a line that is not a status and a path is rejected", () => {
  const odd = join(dir, "odd.tsv")
  writeFileSync(odd, "X\tcontent/a.md\n")
  assert.equal(run("v0.6.0", "v0.6.1", "74", "text/x", odd).status, 1)
})
