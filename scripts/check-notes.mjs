#!/usr/bin/env node
// Checks the evidence metadata of the notes in content/ and prints the review queue.
//
// A note may declare an evidence level in its frontmatter (`evidence`, `reviewed`, `review-due`,
// `destructive`). When it does, the body must carry a matching `## Evidence` section. The rules
// are written down in content/standards/writing-notes.md ("Evidence levels"); this script
// enforces them. Notes that declare no `evidence` are only checked for stray evidence fields.
//
// The review queue is information only: overdue reviews, reviews due within 30 days, notes
// modified after their review, and notes that declare no level. It never changes the exit code.
//
// Usage: node scripts/check-notes.mjs [--content <dir>] [--today YYYY-MM-DD] [--summary <file>]
//                                     [--queue]
//   --content <dir>    the notes folder (default: content)
//   --today <date>     the date to check against (default: today, UTC); an invalid value exits 2
//   --summary <file>   append the queue as Markdown to the file (for $GITHUB_STEP_SUMMARY)
//   --queue            print only the queue; errors become warnings and the exit code is 0
// Exit code: 1 when a note breaks a rule, 2 on bad arguments, otherwise 0.
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import YAML from "yaml"

export const EVIDENCE_LEVELS = ["source-reviewed", "lab-tested", "operationally-verified"]

const SKIPPED_FILES = new Set(["index.md", "tags.md", "template.md"])
const MAX_REVIEW_DAYS = 366
const EXECUTABLE_SECTIONS = [
  "Environment",
  "Prerequisites",
  "Expected results",
  "Failure conditions",
  "Cleanup and rollback",
]

/**
 * Copied from local-plugins/note-meta/format.ts (isoDay), so the check reads dates exactly as
 * the site does. The `yaml` package gives a string for an unquoted `2026-10-20`, while the
 * site's own frontmatter path gives a Date; both are accepted. Returns `YYYY-MM-DD`, or
 * undefined for anything else, including impossible dates such as 2026-02-30.
 */
export function isoDay(value) {
  let iso
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined
    iso = value.toISOString().slice(0, 10)
  } else if (typeof value === "string") {
    iso = value.trim()
  }
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  if (!m) return undefined
  const check = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) {
    return undefined
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000
const addDays = (iso, days) =>
  new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10)

/**
 * Splits a note into frontmatter and body. Only a leading `---` fence counts; CRLF is accepted.
 * Returns `{ path, frontmatter, body, parseError }`; `frontmatter` is null when there is no
 * fence or it is empty, and `parseError` is set when the YAML does not parse.
 */
export function parseNote(path, text) {
  const src = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
  const m =
    /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src) ??
    /^---[ \t]*\n---[ \t]*(?:\n|$)/.exec(src)
  if (!m) return { path, frontmatter: null, body: src, parseError: undefined }
  const body = src.slice(m[0].length)
  try {
    const data = YAML.parse(m[1] ?? "")
    if (data === null || data === undefined) return { path, frontmatter: null, body }
    if (typeof data !== "object" || Array.isArray(data)) {
      return { path, frontmatter: null, body, parseError: "the frontmatter is not a mapping" }
    }
    return { path, frontmatter: data, body, parseError: undefined }
  } catch (err) {
    return { path, frontmatter: null, body, parseError: String(err.message).split("\n")[0] }
  }
}

/** Headings and fence lines of a body; lines inside ``` or ~~~ fences are never headings. */
function outline(body) {
  const lines = body.split("\n")
  const headings = []
  const fenceOpeners = new Set()
  const fenced = new Array(lines.length).fill(false)
  let fence = null
  lines.forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      fenced[i] = true
      if (
        f &&
        f[1][0] === fence.char &&
        f[1].length >= fence.len &&
        /^\s*$/.test(line.slice(f[0].length))
      ) {
        fence = null
      }
      return
    }
    if (f) {
      fence = { char: f[1][0], len: f[1].length }
      fenced[i] = true
      fenceOpeners.add(i)
      return
    }
    const h = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line)
    if (h) {
      const title = h[2].replace(/[ \t]+#+[ \t]*$/, "").trim()
      headings.push({ level: h[1].length, title: title.toLowerCase(), line: i })
    }
  })
  return { lines, headings, fenced, fenceOpeners }
}

/** The sections with this heading text, each as `{ lines, start, end, hasFence }`. */
function sectionsNamed(ol, level, name, parent) {
  const found = []
  const from = parent ? parent.start : 0
  const to = parent ? parent.end : ol.lines.length
  ol.headings.forEach((h, idx) => {
    if (h.level !== level || h.title !== name.toLowerCase() || h.line < from || h.line >= to) return
    const next = ol.headings.slice(idx + 1).find((n) => n.level <= level)
    const end = Math.min(next ? next.line : ol.lines.length, to)
    const start = h.line + 1
    const body = ol.lines.slice(start, end)
    let hasFence = false
    for (let i = start; i < end; i++) if (ol.fenceOpeners.has(i)) hasFence = true
    found.push({ lines: body, text: body.join("\n"), start, end, hasFence })
  })
  return found
}

const isEmpty = (section) => !section || section.text.trim() === ""

const META_FIELDS = ["evidence", "reviewed", "review-due", "destructive"]

/** Problems with one parsed note, as plain strings. `today` is `YYYY-MM-DD`. */
export function checkNote(note, { today }) {
  if (note.parseError) return [`frontmatter YAML does not parse: ${note.parseError}`]
  const fm = note.frontmatter ?? {}
  const has = (key) => Object.hasOwn(fm, key) && fm[key] !== null && fm[key] !== undefined
  const problems = []
  if (!fm.type && META_FIELDS.some((key) => Object.hasOwn(fm, key))) {
    problems.push("`type` is missing or empty, but the note declares evidence metadata")
  }

  if (!Object.hasOwn(fm, "evidence")) {
    for (const key of ["reviewed", "review-due", "destructive"]) {
      if (Object.hasOwn(fm, key)) problems.push(`\`${key}\` is set without \`evidence\``)
    }
    return problems
  }

  const level = fm.evidence
  if (typeof level !== "string" || !EVIDENCE_LEVELS.includes(level)) {
    problems.push(`\`evidence\` must be one of ${EVIDENCE_LEVELS.join(", ")} (lowercase)`)
  }

  const created = isoDay(fm.created)
  const reviewed = has("reviewed") ? isoDay(fm.reviewed) : undefined
  const due = has("review-due") ? isoDay(fm["review-due"]) : undefined
  if (!reviewed) problems.push("`reviewed` is missing or not a valid ISO date (YYYY-MM-DD)")
  if (!due) problems.push("`review-due` is missing or not a valid ISO date (YYYY-MM-DD)")
  if (reviewed && reviewed > today)
    problems.push(`\`reviewed\` ${reviewed} is after today (${today})`)
  if (reviewed && created && reviewed < created) {
    problems.push(`\`reviewed\` ${reviewed} is before \`created\` ${created}`)
  }
  if (reviewed && due) {
    if (due <= reviewed)
      problems.push(`\`review-due\` ${due} is not after \`reviewed\` ${reviewed}`)
    else if (dayNumber(due) - dayNumber(reviewed) > MAX_REVIEW_DAYS) {
      problems.push(`\`review-due\` ${due} is more than ${MAX_REVIEW_DAYS} days after \`reviewed\``)
    }
  }
  const destructive = fm.destructive
  if (Object.hasOwn(fm, "destructive") && typeof destructive !== "boolean") {
    problems.push("`destructive` must be true or false")
  }
  if (level === "operationally-verified" && !isoDay(fm.verified)) {
    problems.push("`operationally-verified` needs a valid `verified` date")
  }

  const ol = outline(note.body)
  const evidence = sectionsNamed(ol, 2, "Evidence")
  if (evidence.length === 0) {
    problems.push("the body has no `## Evidence` section")
    return problems
  }
  if (evidence.length > 1) problems.push("the body has more than one `## Evidence` section")
  const ev = evidence[0]
  const sub = (name) => sectionsNamed(ol, 3, name, ev)[0]

  const sources = sub("Sources checked")
  if (isEmpty(sources)) problems.push("`### Sources checked` is missing or empty")
  else if (!/https:\/\/[^\s)>\]]+/.test(sources.text)) {
    problems.push("`### Sources checked` has no https:// link")
  }
  if (isEmpty(sub("Not verified"))) problems.push("`### Not verified` is missing or empty")
  if (reviewed && !ev.text.includes(reviewed)) {
    problems.push(`the Evidence section does not contain the reviewed date ${reviewed}`)
  }

  const executable =
    note.frontmatter.type === "runbook" ||
    destructive === true ||
    level === "lab-tested" ||
    level === "operationally-verified"
  if (executable) {
    for (const name of EXECUTABLE_SECTIONS) {
      if (isEmpty(sub(name))) problems.push(`\`### ${name}\` is missing or empty`)
    }
  }

  const lab = sub("Lab run")
  const labRequired = level === "lab-tested" || level === "operationally-verified"
  if (lab || labRequired) {
    if (isEmpty(lab)) problems.push("`### Lab run` is missing or empty")
    else if (!lab.hasFence) problems.push("`### Lab run` has no fenced code block")
  }
  if (level === "operationally-verified" && isEmpty(sub("Operational check"))) {
    problems.push("`### Operational check` is missing or empty")
  }

  if (destructive === true) {
    const callout = ol.lines.some(
      (line, i) => !ol.fenced[i] && /^\s*>\s*\[!(?:danger|warning)\]/i.test(line),
    )
    if (!callout)
      problems.push("`destructive: true` needs a `> [!danger]` or `> [!warning]` callout")
  }
  return problems
}

/** Sorts and groups the review queue. Reads only dates; never edits anything. */
export function reviewQueue(notes, { today, soonDays = 30 }) {
  const queue = { overdue: [], dueSoon: [], changedSinceReview: [], undeclared: [] }
  const soonEnd = addDays(today, soonDays)
  for (const note of notes) {
    const fm = note.frontmatter
    if (!fm || !fm.type) continue
    if (!Object.hasOwn(fm, "evidence")) {
      queue.undeclared.push(note.path)
      continue
    }
    const reviewed = isoDay(fm.reviewed)
    const due = isoDay(fm["review-due"])
    const modified = isoDay(fm.modified)
    const item = { path: note.path, evidence: fm.evidence, reviewed, due, modified }
    if (due && due < today) queue.overdue.push(item)
    else if (due && due <= soonEnd) queue.dueSoon.push(item)
    if (reviewed && modified && modified > reviewed) queue.changedSinceReview.push(item)
  }
  const byDue = (a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.path.localeCompare(b.path)
  queue.overdue.sort(byDue)
  queue.dueSoon.sort(byDue)
  queue.changedSinceReview.sort((a, b) => a.path.localeCompare(b.path))
  queue.undeclared.sort()
  return queue
}

/** The queue as `{ text, markdown }`. */
export function formatQueue(queue) {
  const dueLine = (i) => `${i.path} (due ${i.due}, ${i.evidence})`
  const changedLine = (i) => `${i.path} (modified ${i.modified}, reviewed ${i.reviewed})`
  const sections = [
    ["Overdue", queue.overdue.map(dueLine), "nothing overdue"],
    ["Due within 30 days", queue.dueSoon.map(dueLine), "nothing due soon"],
    ["Changed since review", queue.changedSinceReview.map(changedLine), "nothing changed"],
  ]
  const text = ["Review queue"]
  const md = ["## Note review queue", ""]
  for (const [title, items, none] of sections) {
    text.push("", `${title} (${items.length})`)
    md.push(`### ${title} (${items.length})`, "")
    if (items.length === 0) {
      text.push(`  ${none}`)
      md.push(`${none[0].toUpperCase()}${none.slice(1)}.`, "")
      continue
    }
    for (const line of items) text.push(`  ${line}`)
    for (const line of items)
      md.push(`- \`${line.split(" (")[0]}\` (${line.split(" (").slice(1).join(" (")}`)
    md.push("")
  }
  const n = queue.undeclared.length
  text.push("", `No evidence level (${n})`)
  for (const p of queue.undeclared) text.push(`  ${p}`)
  md.push(`### No evidence level (${n})`, "", "<details><summary>Show the notes</summary>", "")
  for (const p of queue.undeclared) md.push(`- \`${p}\``)
  md.push("", "</details>", "")
  return { text: `${text.join("\n")}\n`, markdown: `${md.join("\n")}\n` }
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (name.endsWith(".md") && !SKIPPED_FILES.has(basename(name))) yield full
  }
}

/**
 * Parses every note in `dir` that is not skipped and has a `type`, broken frontmatter, or any
 * evidence field (so a missing or misspelled `type` cannot hide a note from the check).
 */
export function loadNotes(dir) {
  const notes = []
  for (const file of walk(dir)) {
    const path = file.split("\\").join("/")
    const note = parseNote(path, readFileSync(file, "utf8"))
    const fm = note.frontmatter
    if (note.parseError || (fm && (fm.type || META_FIELDS.some((key) => Object.hasOwn(fm, key)))))
      notes.push(note)
  }
  return notes
}

function main(argv) {
  const opts = { content: "content", today: undefined, summary: undefined, queue: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--queue") opts.queue = true
    else if (arg === "--content" || arg === "--today" || arg === "--summary") {
      const value = argv[++i]
      if (value === undefined) {
        console.error(`check-notes: ${arg} needs a value`)
        return 2
      }
      opts[arg.slice(2)] = value
    } else {
      console.error(`check-notes: unknown argument ${arg}`)
      return 2
    }
  }
  let today = new Date().toISOString().slice(0, 10)
  if (opts.today !== undefined) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? isoDay(opts.today) : undefined
    if (!day) {
      console.error(`check-notes: --today must be a valid YYYY-MM-DD date, got "${opts.today}"`)
      return 2
    }
    today = day
  }
  if (!existsSync(opts.content) || !statSync(opts.content).isDirectory()) {
    console.error(`check-notes: ${opts.content} is not a directory`)
    return 2
  }

  const notes = loadNotes(opts.content)
  let errors = 0
  for (const note of notes) {
    for (const problem of checkNote(note, { today })) {
      errors++
      console.log(`::${opts.queue ? "warning" : "error"} file=${note.path}::${problem}`)
    }
  }
  const { text, markdown } = formatQueue(reviewQueue(notes, { today, soonDays: 30 }))
  console.log(text)
  if (opts.summary) appendFileSync(opts.summary, markdown)
  if (errors > 0 && !opts.queue) return 1
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
