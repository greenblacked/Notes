import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { countCommandBlocks, loadAll, scoreNotes } from "./scan-unrated-notes.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const script = join(root, "scripts", "scan-unrated-notes.mjs")
const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const FENCE = "```"

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "scan-unrated-"))
  dirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

const note = (type, body, extra = "") =>
  `---\ntitle: T\ndescription: D\ntype: ${type}\ntags:\n  - x\ncreated: 2026-01-01\nmodified: 2026-01-01\ndraft: false\n${extra}---\n\n${body}\n`

test("countCommandBlocks counts runnable blocks, not prose or plain yaml", () => {
  const body = [
    `${FENCE}bash\nkubectl get pods\n${FENCE}`,
    `${FENCE}yaml\napiVersion: v1\nkind: Pod\n${FENCE}`,
    `${FENCE}yaml\nname: just a value\n${FENCE}`,
    `${FENCE}text\nno commands here\n${FENCE}`,
  ].join("\n\n")
  assert.equal(countCommandBlocks(body), 2)
  assert.equal(countCommandBlocks("No code at all."), 0)
})

test("a runbook with commands outranks a prose note", () => {
  const dir = tree({
    "runbooks/danger.md": note("runbook", `${FENCE}bash\ndocker rm -f x\n${FENCE}`),
    "tools/calm.md": note("tool", "A comparison, no code."),
  })
  const rows = scoreNotes(loadAll(dir))
  assert.equal(rows[0].path.endsWith("danger.md"), true)
  assert.ok(rows[0].score > rows[1].score)
  assert.equal(rows[0].destructive, true)
  assert.equal(rows[1].destructive, false)
})

test("notes with an evidence level and notes without a type are skipped", () => {
  const dir = tree({
    "a/rated.md": note("runbook", "body", "evidence: source-reviewed\n"),
    "a/index.md": "---\ntitle: Index\ntags:\n  - x\n---\n\nNo type.\n",
    "a/unrated.md": note("pattern", "body"),
  })
  const rows = scoreNotes(loadAll(dir))
  assert.deepEqual(
    rows.map((r) => r.path.split(/[\\/]/).pop()),
    ["unrated.md"],
  )
})

test("inbound links raise the score, including from an index", () => {
  const dir = tree({
    "index.md": "---\ntitle: I\ntags:\n  - x\n---\n\n[[target]]\n",
    "a/target.md": note("guide", "Body."),
  })
  const rows = scoreNotes(loadAll(dir))
  assert.equal(rows[0].inbound, 1)
  assert.equal(rows[0].score, 1 + 1)
})

test("the CLI prints a table and exits 0, and --top limits the rows", () => {
  const dir = tree({
    "a/one.md": note("runbook", `${FENCE}bash\necho hi\n${FENCE}`),
    "a/two.md": note("tool", "prose"),
  })
  const all = spawnSync(process.execPath, [script, "--content", dir], { encoding: "utf8" })
  assert.equal(all.status, 0, all.stderr)
  assert.match(all.stdout, /^score\ttype\tcmds/)
  assert.equal(all.stdout.trim().split("\n").length, 3)

  const one = spawnSync(process.execPath, [script, "--content", dir, "--top", "1"], {
    encoding: "utf8",
  })
  assert.equal(one.stdout.trim().split("\n").length, 2)
})

test("--json is valid JSON with a total and rows", () => {
  const dir = tree({ "a/one.md": note("runbook", `${FENCE}bash\necho hi\n${FENCE}`) })
  const r = spawnSync(process.execPath, [script, "--content", dir, "--json"], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  const parsed = JSON.parse(r.stdout)
  assert.equal(parsed.total, 1)
  assert.equal(parsed.rows[0].type, "runbook")
})

test("bad arguments exit 2", () => {
  const dir = tree({ "a/one.md": note("tool", "x") })
  for (const args of [["--top", "many"], ["--nope"]]) {
    const r = spawnSync(process.execPath, [script, "--content", dir, ...args], {
      encoding: "utf8",
    })
    assert.equal(r.status, 2, args.join(" "))
  }
})

test("the real content directory scans without failing", () => {
  const r = spawnSync(process.execPath, [script, "--content", "content", "--top", "5"], {
    cwd: root,
    encoding: "utf8",
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^score\ttype\tcmds/)
})
