import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  EVIDENCE_LEVELS,
  checkNote,
  isoDay,
  loadNotes,
  parseNote,
  reviewQueue,
} from "./check-notes.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const script = join(root, "scripts", "check-notes.mjs")
const TODAY = "2026-10-20"
const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const FENCE = "```"
const SECTION_TEXT = {
  "Sources checked": "- [Docs](https://example.com/docs): the flags, checked {R}.",
  "Not verified": "- Nothing was run.",
  Environment: "Linux with the tool installed.",
  Prerequisites: "A backup.",
  "Expected results": "Exit code 0.",
  "Failure conditions": "Exit code not 0.",
  "Cleanup and rollback": "Restore the backup.",
  "Lab run": `Host: Linux.\n\n${FENCE}bash\ntool --version\n${FENCE}\n\n${FENCE}text\ntool 1.0\n${FENCE}`,
  "Operational check": "Checked on a real system, 2026-10-20.",
}

/** A note's source. `fm` overrides frontmatter lines, `sections` lists the `###` names to emit. */
function note({
  fm = {},
  sections = ["Sources checked", "Not verified"],
  extra = "",
  after = "",
} = {}) {
  const base = {
    title: "Example",
    description: "An example note.",
    type: "guide",
    tags: "[patterns]",
    created: "2025-12-01",
    modified: "2026-10-20",
    draft: false,
    evidence: "source-reviewed",
    reviewed: "2026-10-20",
    "review-due": "2027-04-20",
    ...fm,
  }
  const front = Object.entries(base)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
  const subs = sections
    .map(
      (s) =>
        `### ${s}\n\n${SECTION_TEXT[s].replaceAll("{R}", String(base.reviewed).replaceAll('"', ""))}\n`,
    )
    .join("\n")
  return `---\n${front}\n---\n\nIntro.\n\n${extra}\n## Evidence\n\n${subs}\n${after}`
}

const problems = (text, today = TODAY) => checkNote(parseNote("x.md", text), { today })
const has = (list, re) => list.some((p) => re.test(p))

const RUNBOOK = [
  "Sources checked",
  "Not verified",
  "Environment",
  "Prerequisites",
  "Expected results",
  "Failure conditions",
  "Cleanup and rollback",
]
const LAB = [...RUNBOOK, "Lab run"]
const NOTE_TYPES = ["adr", "pattern", "tool", "standard", "runbook", "guide", "reference", "note"]

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "check-notes-"))
  dirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

function run(dir, ...args) {
  return spawnSync(process.execPath, [script, "--content", dir, "--today", TODAY, ...args], {
    encoding: "utf8",
  })
}

test("a valid source-reviewed note passes", () => {
  assert.deepEqual(problems(note()), [])
})

test("a valid lab-tested runbook passes", () => {
  const text = note({ fm: { type: "runbook", evidence: "lab-tested" }, sections: LAB })
  assert.deepEqual(problems(text), [])
})

test("an unknown evidence value fails", () => {
  assert.ok(has(problems(note({ fm: { evidence: "tested" } })), /`evidence` must be one of/))
  assert.ok(has(problems(note({ fm: { evidence: "Lab-Tested" } })), /`evidence` must be one of/))
})

test("reviewed, review-due and destructive without evidence fail", () => {
  for (const field of ["reviewed: 2026-10-20", "review-due: 2027-04-20", "destructive: true"]) {
    const text = `---\ntitle: X\ntype: guide\n${field}\n---\n\nBody.\n`
    assert.ok(has(problems(text), /without `evidence`/), field)
  }
})

test("a missing reviewed date fails", () => {
  assert.ok(has(problems(note({ fm: { reviewed: undefined } })), /`reviewed` is missing/))
})

test("an impossible date fails", () => {
  assert.ok(has(problems(note({ fm: { reviewed: "2026-02-30" } })), /`reviewed` is missing or not/))
  assert.ok(
    has(problems(note({ fm: { "review-due": "2027-13-01" } })), /`review-due` is missing or not/),
  )
})

test("reviewed in the future fails", () => {
  const text = note({ fm: { reviewed: "2026-10-21", "review-due": "2027-04-20" } })
  assert.ok(has(problems(text), /after today/))
})

test("reviewed before created fails", () => {
  const text = note({ fm: { created: "2026-10-21", modified: "2026-10-22" } })
  assert.ok(has(problems(text, "2026-10-25"), /before `created`/))
})

test("review-due before reviewed fails, and so does more than 366 days later", () => {
  assert.ok(has(problems(note({ fm: { "review-due": "2026-10-19" } })), /not after `reviewed`/))
  assert.ok(has(problems(note({ fm: { "review-due": "2026-10-20" } })), /not after `reviewed`/))
  assert.ok(has(problems(note({ fm: { "review-due": "2027-10-22" } })), /more than 366 days/))
  assert.deepEqual(problems(note({ fm: { "review-due": "2027-10-21" } })), [])
})

test("a missing Not verified section fails", () => {
  assert.ok(has(problems(note({ sections: ["Sources checked"] })), /Not verified/))
})

test("Sources checked without an https link fails", () => {
  const text = note().replace("https://example.com/docs", "http://example.com/docs")
  assert.ok(has(problems(text), /no https:\/\/ link/))
})

test("the reviewed date missing from the Evidence section fails", () => {
  const text = note().replace("checked 2026-10-20", "checked recently")
  assert.ok(has(problems(text), /does not contain the reviewed date/))
})

test("a runbook missing Cleanup and rollback fails", () => {
  const sections = RUNBOOK.filter((s) => s !== "Cleanup and rollback")
  assert.ok(has(problems(note({ fm: { type: "runbook" }, sections })), /Cleanup and rollback/))
})

test("lab-tested without Lab run, or with Lab run but no fence, fails", () => {
  const fm = { evidence: "lab-tested" }
  assert.ok(has(problems(note({ fm, sections: RUNBOOK })), /`### Lab run` is missing/))
  const text = note({ fm, sections: LAB }).replace(/```[\s\S]*?```/g, "no code here")
  assert.ok(has(problems(text), /Lab run` needs two fenced/))
})

test("Lab run needs both a command block and an output block", () => {
  const oneFence = `Host: Linux.\n\n${FENCE}bash\ntool --version\n${FENCE}`
  const twoFences = SECTION_TEXT["Lab run"]
  const withLab = (text, lab) => text.replace(twoFences, lab)
  for (const evidence of ["lab-tested", "operationally-verified"]) {
    const sections = evidence === "lab-tested" ? LAB : [...LAB, "Operational check"]
    const fm = { evidence, verified: "2026-10-20" }
    const text = note({ fm, sections })
    assert.deepEqual(problems(text), [], evidence)
    assert.ok(has(problems(withLab(text, oneFence)), /Lab run` needs two fenced/), evidence)
  }
})

test("an optional Lab run on source-reviewed follows the same two-block rule", () => {
  const text = note({ sections: ["Sources checked", "Not verified", "Lab run"] })
  assert.deepEqual(problems(text), [])
  const one = text.replace(SECTION_TEXT["Lab run"], "Host: Linux.\n\n```bash\ntool\n```")
  assert.ok(has(problems(one), /Lab run` needs two fenced/))
  assert.deepEqual(problems(note()), [], "no Lab run at all stays valid")
})

test("frontmatter that is opened but never closed is a parse error", () => {
  const text = "---\ntitle: X\ntype: guide\nevidence: source-reviewed\n\nBody.\n"
  assert.ok(has(problems(text), /frontmatter does not parse: it is not closed/))
  const dir = tree({ "a.md": text })
  const r = run(dir)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /::error file=.*a\.md::frontmatter does not parse: it is not closed/)
})

test("the position of the Evidence section is not enforced, the count is", () => {
  const text = note()
  const moved = text.replace(/\n## Evidence[\s\S]*$/, (ev) => `${ev}\n## Sources\n\n- x\n`)
  assert.deepEqual(problems(moved), [])
  assert.ok(has(problems(`${text}\n## Evidence\n\nAgain.\n`), /more than one `## Evidence`/))
  const doc = readFileSync(join(root, "content/standards/writing-notes.md"), "utf8")
  assert.match(doc, /does not enforce its position/)
})

test("a note with no frontmatter at all is not a parse error", () => {
  assert.equal(parseNote("x.md", "Just a body.\n").parseError, undefined)
})

test("destructive without a warning or danger callout fails", () => {
  const fm = { destructive: "true" }
  assert.ok(has(problems(note({ fm, sections: RUNBOOK })), /needs a `> \[!danger\]`/))
  assert.deepEqual(
    problems(note({ fm, sections: RUNBOOK, extra: "> [!warning] Careful\n> Deletes.\n" })),
    [],
  )
  assert.deepEqual(problems(note({ fm, sections: RUNBOOK, extra: "> [!DANGER] Careful\n" })), [])
})

test("a callout inside a code fence does not count for destructive", () => {
  const extra = `${FENCE}markdown\n> [!danger] Not real\n${FENCE}\n`
  const text = note({ fm: { destructive: "true" }, sections: RUNBOOK, extra })
  assert.ok(has(problems(text), /needs a `> \[!danger\]`/))
})

test("destructive: a string fails", () => {
  const text = note({ fm: { destructive: '"yes"' }, sections: RUNBOOK, extra: "> [!danger] X\n" })
  assert.ok(has(problems(text), /`destructive` must be true or false/))
})

test("operationally-verified without verified fails", () => {
  const fm = { evidence: "operationally-verified" }
  const sections = [...LAB, "Operational check"]
  assert.ok(has(problems(note({ fm, sections })), /needs a valid `verified`/))
  assert.deepEqual(problems(note({ fm: { ...fm, verified: "2026-10-20" }, sections })), [])
  assert.ok(
    has(
      problems(note({ fm: { ...fm, verified: "2026-10-20" }, sections: LAB })),
      /Operational check/,
    ),
  )
})

test("headings inside a code fence do not count", () => {
  const text = `---\ntitle: X\ntype: guide\ncreated: 2026-10-10\nevidence: source-reviewed\nreviewed: 2026-10-20\nreview-due: 2027-04-20\n---\n\n${FENCE}markdown\n## Evidence\n\n### Sources checked\n\n- https://example.com 2026-10-20\n\n### Not verified\n\n- Nothing.\n${FENCE}\n`
  assert.ok(has(problems(text), /no `## Evidence` section/))
  const tilde = text.replaceAll(FENCE, "~~~")
  assert.ok(has(problems(tilde), /no `## Evidence` section/))
})

test("heading names match without regard to case or spacing", () => {
  const text = note().replace("### Sources checked", "###   SOURCES CHECKED  ")
  assert.deepEqual(problems(text), [])
})

test("a type line in a body code block is ignored", () => {
  const dir = tree({
    "a.md": `---\ntitle: A\n---\n\n${FENCE}yaml\ntype: guide\nevidence: nope\n${FENCE}\n`,
  })
  const r = run(dir)
  assert.equal(r.status, 0, r.stdout)
  assert.doesNotMatch(r.stdout, /::error/)
  assert.match(r.stdout, /No evidence level \(0\)/)
})

test("template.md and index.md are skipped", () => {
  const bad = note({ fm: { evidence: "nope" } })
  const dir = tree({
    "template.md": bad,
    "adr/template.md": bad,
    "index.md": bad,
    "x/index.md": bad,
  })
  const r = run(dir)
  assert.equal(r.status, 0, r.stdout)
})

test("quoted and unquoted dates both work", () => {
  const quoted = note({ fm: { reviewed: '"2026-10-20"', "review-due": '"2027-04-20"' } })
  assert.deepEqual(problems(quoted), [])
  assert.deepEqual(problems(note()), [])
})

test("dates with trailing text or a time part are rejected", () => {
  for (const bad of ['"2026-10-20junk"', '"2026-10-20T12:00"', '"2026-10-20 x"']) {
    const list = problems(note({ fm: { reviewed: bad } }))
    assert.ok(has(list, /`reviewed` is missing or not a valid ISO date/), bad + list.join("|"))
  }
  const due = problems(note({ fm: { "review-due": '"2027-04-20T12:00"' } }))
  assert.ok(has(due, /`review-due` is missing or not a valid ISO date/), due.join("|"))
  assert.equal(isoDay(" 2026-10-20 "), "2026-10-20")
  assert.equal(isoDay(new Date("2026-10-20T00:00:00Z")), "2026-10-20")
  assert.equal(isoDay("2026-10-20junk"), undefined)
})

test("CRLF frontmatter parses", () => {
  const text = note().replaceAll("\n", "\r\n")
  assert.deepEqual(problems(text), [])
  assert.equal(parseNote("x.md", text).frontmatter.evidence, "source-reviewed")
})

test("frontmatter that does not parse fails", () => {
  const text = "---\ntitle: [unclosed\ntype: guide\n---\n\nBody.\n"
  assert.ok(has(problems(text), /frontmatter does not parse/))
  const dir = tree({ "a.md": text })
  const r = run(dir)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /::error file=.*a\.md::frontmatter does not parse/)
})

test("an overdue note is listed in the queue and the CLI exits 0", () => {
  const dir = tree({ "a.md": note({ fm: { reviewed: "2026-01-10", "review-due": "2026-07-10" } }) })
  const r = run(dir)
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /Overdue \(1\)\n {2}.*a\.md \(due 2026-07-10/)
})

test("a note due within 30 days is listed as due soon", () => {
  const dir = tree({ "a.md": note({ fm: { reviewed: "2026-04-25", "review-due": "2026-11-10" } }) })
  const r = run(dir)
  assert.match(r.stdout, /Due within 30 days \(1\)\n {2}.*a\.md/)
  assert.match(r.stdout, /Overdue \(0\)/)
})

test("modified after reviewed is listed as changed", () => {
  const dir = tree({ "a.md": note({ fm: { reviewed: "2026-10-12", modified: "2026-10-15" } }) })
  const r = run(dir)
  assert.match(
    r.stdout,
    /Changed since review \(1\)\n {2}.*a\.md \(modified 2026-10-15, reviewed 2026-10-12\)/,
  )
})

test("undeclared notes are counted", () => {
  const plain = "---\ntitle: P\ntype: guide\n---\n\nBody.\n"
  const dir = tree({ "a.md": plain, "b/c.md": plain, "d.md": "---\ntitle: D\n---\n\nNo type.\n" })
  const queue = reviewQueue(
    ["a.md", "b/c.md"].map((p) => parseNote(p, plain)),
    { today: TODAY },
  )
  assert.deepEqual(queue.undeclared, ["a.md", "b/c.md"])
  assert.match(run(dir).stdout, /No evidence level \(2\)/)
})

test("a note with metadata fields but a missing or misspelled type is checked", () => {
  const dir = tree({
    "a.md": note({ fm: { type: undefined, evidence: "nope" } }),
    "b.md": note({ fm: { type: "" } }),
    "c.md": "---\ntitle: C\nreviewed: 2026-10-20\n---\n\nBody.\n",
    "d.md": "---\ntitle: D\n---\n\nNo type, no metadata.\n",
  })
  const loaded = loadNotes(dir).map((n) => n.path.split("/").pop())
  assert.deepEqual(loaded.sort(), ["a.md", "b.md", "c.md"])
  const r = run(dir)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /::error file=.*a\.md::.*`type`/)
  assert.match(r.stdout, /::error file=.*a\.md::`evidence` must be one of/)
  assert.match(r.stdout, /::error file=.*b\.md::.*`type`/)
  assert.match(r.stdout, /::error file=.*c\.md::.*`type`/)
  assert.doesNotMatch(r.stdout, /d\.md::/)
  assert.match(r.stdout, /No evidence level \(0\)/)
  assert.ok(has(problems(note({ fm: { type: undefined } })), /`type` is missing/))
})

test("errors exit 1 with annotations, and --queue exits 0 with warnings", () => {
  const dir = tree({ "a.md": note({ fm: { evidence: "nope" } }) })
  const r = run(dir)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /::error file=.*a\.md::`evidence` must be one of/)
  const q = run(dir, "--queue")
  assert.equal(q.status, 0)
  assert.match(q.stdout, /::warning file=.*a\.md::/)
  assert.match(q.stdout, /Review queue/)
})

test("--summary appends the queue as Markdown", () => {
  const dir = tree({ "a.md": note({ fm: { reviewed: "2026-01-10", "review-due": "2026-07-10" } }) })
  const out = join(dir, "summary.md")
  writeFileSync(out, "existing\n")
  assert.equal(run(dir, "--summary", out).status, 0)
  const text = readFileSync(out, "utf8")
  assert.match(text, /^existing\n## Note review queue/)
  assert.match(text, /### Overdue \(1\)\n\n- `.*a\.md` \(due 2026-07-10/)
  assert.equal(run(dir, "--summary", out).status, 0)
  assert.equal(readFileSync(out, "utf8").match(/## Note review queue/g).length, 2)
})

test("a bad --today exits 2", () => {
  const dir = tree({ "a.md": note() })
  for (const bad of ["2026-02-30", "yesterday", "2026-1-1"]) {
    const r = spawnSync(process.execPath, [script, "--content", dir, "--today", bad], {
      encoding: "utf8",
    })
    assert.equal(r.status, 2, bad)
  }
})

test("the real content directory passes", () => {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout, /::error/)
})

test("writing-notes.md documents every level and field", () => {
  const doc = readFileSync(join(root, "content/standards/writing-notes.md"), "utf8")
  assert.match(doc, /^## Evidence levels$/m)
  for (const level of EVIDENCE_LEVELS) assert.ok(doc.includes(`\`${level}\``), level)
  for (const field of ["evidence", "reviewed", "review-due", "destructive"]) {
    assert.match(doc, new RegExp(`^\\| \`${field}\``, "m"), field)
  }
})

test("destructive is optional once evidence is set", () => {
  assert.deepEqual(problems(note()), [])
  assert.deepEqual(problems(note({ fm: { destructive: "false" } })), [])
})

test("writing-notes.md marks destructive as optional and does not overstate the check", () => {
  const doc = readFileSync(join(root, "content/standards/writing-notes.md"), "utf8")
  const row = doc.split("\n").find((l) => l.startsWith("| `destructive`"))
  assert.match(row, /^\| `destructive`\s+\| no \(only with `evidence`\)/)
  assert.doesNotMatch(doc, /so a note cannot ship with a broken claim/)
  assert.match(doc, /left to review/)
})

test("a missing or malformed created fails on a note that declares evidence", () => {
  for (const bad of [undefined, '"soon"', '"2026-02-30"', '"2025-12-01T10:00"', "[]"]) {
    const list = problems(note({ fm: { created: bad, reviewed: "2025-11-01" } }))
    assert.ok(
      has(list, /`created` is missing or not a valid ISO date/),
      `${bad}: ${list.join("|")}`,
    )
  }
})

test("a missing or malformed modified fails on a note that declares evidence", () => {
  for (const bad of [undefined, '"yesterday"', '"2026-13-01"']) {
    const list = problems(note({ fm: { modified: bad } }))
    assert.ok(
      has(list, /`modified` is missing or not a valid ISO date/),
      `${bad}: ${list.join("|")}`,
    )
  }
})

test("an unknown, missing or non-string type fails on a note that declares evidence", () => {
  for (const bad of ["runbok", "Runbook", "[runbook]", '""', undefined]) {
    const list = problems(note({ fm: { type: bad } }))
    assert.ok(has(list, /`type` is missing or not one of/), `${bad}: ${list.join("|")}`)
  }
  for (const ok of NOTE_TYPES) {
    const list = problems(note({ fm: { type: ok } }))
    assert.ok(!has(list, /`type`/), `${ok}: ${list.join("|")}`)
  }
})

test("a note with only reviewed (no evidence) is still base-checked", () => {
  const list = problems(note({ fm: { evidence: undefined, type: "runbok" } }))
  assert.ok(has(list, /`type` is missing or not one of/), list.join("|"))
  assert.ok(has(list, /`reviewed` is set without `evidence`/), list.join("|"))
})

test("a missing or empty title, description or tags fails", () => {
  for (const [key, re] of [
    ["title", /`title` is missing or empty/],
    ["description", /`description` is missing or empty/],
    ["tags", /`tags` must be a list with at least one tag/],
  ]) {
    for (const bad of [undefined, '""', "[]"]) {
      if (key !== "tags" && bad === "[]") continue
      const list = problems(note({ fm: { [key]: bad } }))
      assert.ok(has(list, re), `${key} ${bad}: ${list.join("|")}`)
    }
  }
  const list = problems(note({ fm: { tags: "patterns" } }))
  assert.ok(has(list, /`tags` must be a list/), list.join("|"))
  const blank = problems(note({ fm: { tags: '["", patterns]' } }))
  assert.ok(has(blank, /`tags` must be a list/), blank.join("|"))
})

test("a missing or non-boolean draft fails", () => {
  for (const bad of [undefined, '"false"', "yes-please", "0"]) {
    const list = problems(note({ fm: { draft: bad } }))
    assert.ok(has(list, /`draft` must be true or false/), `${bad}: ${list.join("|")}`)
  }
  assert.deepEqual(problems(note({ fm: { draft: true } })), [])
})

test("an undeclared note with a bad type or missing base fields still passes", () => {
  const undeclared = "---\ntitle: Old\ntype: runbok\n---\n\nBody.\n"
  assert.deepEqual(problems(undeclared), [])
  const dir = tree({ "a.md": undeclared })
  const r = run(dir)
  assert.equal(r.status, 0, r.stdout)
  const bad = tree({ "b.md": note({ fm: { type: "runbok" } }) })
  assert.equal(run(bad).status, 1)
})

test("an ADR that declares evidence needs a valid status and decided date", () => {
  const adr = (fm) => problems(note({ fm: { type: "adr", ...fm } }))
  const ok = { status: "accepted", decided: "2026-10-01" }
  assert.deepEqual(adr(ok), [])
  for (const bad of [undefined, "Accepted", "maybe", '""']) {
    const list = adr({ ...ok, status: bad })
    assert.ok(has(list, /`status` must be one of/), `${bad}: ${list.join("|")}`)
  }
  for (const bad of [undefined, "2026-02-30", "soon"]) {
    const list = adr({ ...ok, decided: bad })
    assert.ok(
      has(list, /`decided` is missing or not a valid ISO date/),
      `${bad}: ${list.join("|")}`,
    )
  }
  assert.ok(!has(problems(note()), /`status`|`decided`/))
})

test("verified must be a valid date that is not in the future", () => {
  for (const level of ["source-reviewed", "lab-tested"]) {
    const base = { evidence: level }
    assert.ok(!has(problems(note({ fm: { ...base, verified: "2026-10-11" } })), /`verified`/))
    assert.ok(
      has(problems(note({ fm: { ...base, verified: "nope" } })), /`verified` is not a valid/),
    )
    assert.ok(
      has(problems(note({ fm: { ...base, verified: "2026-10-21" } })), /`verified`.*after today/),
    )
  }
  const op = problems(note({ fm: { evidence: "operationally-verified", verified: "2026-10-21" } }))
  assert.ok(has(op, /`verified`.*after today/), op.join("|"))
})

test("the example in writing-notes.md has no base-field problems", () => {
  const doc = readFileSync(join(root, "content", "standards", "writing-notes.md"), "utf8")
  const m = doc.match(/### Example\n\n```markdown\n([\s\S]*?)\n```\n/)
  assert.ok(m, "example block not found")
  const list = problems(m[1])
  assert.ok(!has(list, /`(title|description|tags|created|modified|draft|type)`/), list.join("|"))
})
