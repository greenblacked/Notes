#!/usr/bin/env node
// Ranks the notes that declare no evidence level by how much a wrong claim in them would cost.
// It reports and never fails: a note with a high score is a candidate for review, not a defect.
//
// The signals are the ones that make a note dangerous when it is wrong: it is a procedure rather
// than an explanation, it contains commands a reader will copy, it tells the reader to destroy
// something, it makes security or IAM claims, or many other notes point at it. Inbound links are
// counted across every note, including section indexes, because an index entry is how most
// readers arrive.
//
// Usage: node scripts/scan-unrated-notes.mjs [--content <dir>] [--top <n>] [--json] [--summary <file>]
//   --content <dir>  the notes folder (default: content)
//   --top <n>        how many rows to print (default: 40; 0 prints all)
//   --json           print JSON instead of a table
//   --summary <file> append the table as Markdown to the file (for $GITHUB_STEP_SUMMARY)
// Exit code: 0 always on a scan, 2 on bad arguments.
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseNote } from "./check-notes.mjs"

const SKIPPED = new Set(["template.md", "tags.md"])
const RUNNABLE = new Set([
  "bash",
  "sh",
  "shell",
  "console",
  "zsh",
  "powershell",
  "ps1",
  "bat",
  "cmd",
])
const DESTRUCTIVE =
  /\b(delete|deleted|revoke|revoked|terminate|force|--force|overwrite|bypass|destroy|drop table|rm -rf|rm -f|docker rm|uninstall|purge|wipe|reset --hard)\b/i
const SECURITY =
  /\b(IAM|RBAC|role binding|clusterrole|service account|credential|token|secret|password|permission|privileged|policy)\b/i
const TYPE_WEIGHT = {
  runbook: 4,
  pattern: 2,
  architecture: 2,
  compliance: 2,
  ai: 2,
  standard: 1,
  tool: 1,
  management: 1,
  guide: 1,
  reference: 1,
  note: 1,
  adr: 1,
}

/** Counts fenced blocks a reader is likely to copy and run. */
export function countCommandBlocks(body) {
  let count = 0
  const fence = /^```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)^```/gm
  for (const match of body.matchAll(fence)) {
    const lang = match[1].toLowerCase()
    const code = match[2]
    if (RUNNABLE.has(lang)) count++
    else if (
      (lang === "yaml" || lang === "yml") &&
      /^\s*apiVersion:|kubectl |gcloud |terraform /m.test(code)
    ) {
      count++
    }
  }
  return count
}

/** The slug a wikilink points at, without folder, heading or display text. */
function linkSlug(target) {
  const bare = target.trim().replace(/\\$/, "").split("#")[0]
  return bare.includes("/") ? bare.slice(bare.lastIndexOf("/") + 1) : bare
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (name.endsWith(".md") && !SKIPPED.has(basename(name))) yield full
  }
}

/** Reads every note once: the candidates and the inbound-link counts need the same pass. */
export function loadAll(dir) {
  const notes = []
  for (const file of walk(dir)) {
    const path = file.split("\\").join("/")
    notes.push(parseNote(path, readFileSync(file, "utf8")))
  }
  return notes
}

/** One scored row per note that declares no evidence level and has a type. */
export function scoreNotes(notes) {
  const inbound = new Map()
  for (const note of notes) {
    for (const match of note.body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const slug = linkSlug(match[1])
      if (!slug) continue
      inbound.set(slug, (inbound.get(slug) ?? 0) + 1)
    }
  }

  const rows = []
  for (const note of notes) {
    const fm = note.frontmatter
    if (!fm || !fm.type) continue
    if (Object.hasOwn(fm, "evidence")) continue
    const body = note.body
    const commands = countCommandBlocks(body)
    const destructive = DESTRUCTIVE.test(body)
    const security = SECURITY.test(body)
    const slug = basename(note.path, ".md")
    const links = inbound.get(slug) ?? 0
    const score =
      (TYPE_WEIGHT[fm.type] ?? 1) +
      (commands > 0 ? 3 + Math.min(commands - 1, 3) : 0) +
      (destructive ? 3 : 0) +
      (security ? 2 : 0) +
      Math.min(links, 5)
    rows.push({
      path: note.path,
      type: fm.type,
      commands,
      destructive,
      security,
      inbound: links,
      score,
    })
  }
  rows.sort((a, b) => b.score - a.score || b.inbound - a.inbound || a.path.localeCompare(b.path))
  return rows
}

function table(rows, top) {
  const shown = top === 0 ? rows : rows.slice(0, top)
  const header = ["score", "type", "cmds", "destr", "sec", "links", "note"]
  const lines = [header.join("\t")]
  for (const r of shown) {
    lines.push(
      [
        r.score,
        r.type,
        r.commands,
        r.destructive ? "yes" : "-",
        r.security ? "yes" : "-",
        r.inbound,
        r.path.replace(/^.*?content\//, "content/"),
      ].join("\t"),
    )
  }
  return lines.join("\n")
}

function markdown(rows, top) {
  const shown = top === 0 ? rows : rows.slice(0, top)
  const out = [
    "## Unrated notes by risk",
    "",
    `${rows.length} notes declare no evidence level. The ${shown.length} highest-risk are listed.`,
    "",
    "| Score | Type | Commands | Destructive | Security | Links | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const r of shown) {
    const p = r.path.replace(/^.*?content\//, "content/")
    out.push(
      `| ${r.score} | ${r.type} | ${r.commands} | ${r.destructive ? "yes" : ""} | ${r.security ? "yes" : ""} | ${r.inbound} | \`${p}\` |`,
    )
  }
  return `${out.join("\n")}\n`
}

function main(argv) {
  const opts = { content: "content", top: 40, json: false, summary: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--content" || arg === "--top" || arg === "--summary") {
      const value = argv[++i]
      if (value === undefined) {
        console.error(`scan-unrated-notes: ${arg} needs a value`)
        return 2
      }
      if (arg === "--top") {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0) {
          console.error(`scan-unrated-notes: --top must be a whole number, got "${value}"`)
          return 2
        }
        opts.top = n
      } else opts[arg.slice(2)] = value
    } else {
      console.error(`scan-unrated-notes: unknown argument ${arg}`)
      return 2
    }
  }
  if (!existsSync(opts.content) || !statSync(opts.content).isDirectory()) {
    console.error(`scan-unrated-notes: ${opts.content} is not a directory`)
    return 2
  }

  const rows = scoreNotes(loadAll(opts.content))
  if (opts.json) {
    const shown = opts.top === 0 ? rows : rows.slice(0, opts.top)
    console.log(JSON.stringify({ total: rows.length, rows: shown }, null, 2))
  } else {
    console.log(table(rows, opts.top))
  }
  if (opts.summary) appendFileSync(opts.summary, markdown(rows, opts.top))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
