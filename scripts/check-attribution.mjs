#!/usr/bin/env node
// Fails when a commit message, an author or committer email, or (for a pull request) the PR title
// or body carries tooling attribution. Node built-ins only.
//   check-attribution.mjs --range <base>..<head> [--event <payload.json>]
// It scans commit metadata and PR text, never files, so this source and its tests may contain
// the patterns. Dependabot co-author lines stay allowed.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const ZERO = /^0+$/

// Patterns are assembled from parts so that this file does not match itself in a text search.
const word = (...parts) => parts.join("")
const BAD_TEXT = [
  [
    new RegExp(`co-authored-by:[^\\n]*(${word("cla", "ude")}|${word("anthr", "opic")})`, "i"),
    "a tool co-author trailer",
  ],
  [new RegExp(word("noreply@", "anthr", "opic", "\\.com"), "i"), "a tool noreply address"],
  [new RegExp(word("cla", "ude", "\\.ai/code"), "i"), "a tool session link"],
  [
    new RegExp(`generated (with|by) \\[?${word("cla", "ude")} code`, "i"),
    "a generated-with footer",
  ],
]
const BAD_EMAIL = new RegExp(`@([a-z0-9-]+\\.)*${word("anthr", "opic")}\\.com$`, "i")

export function textProblems(label, text) {
  const out = []
  for (const [re, what] of BAD_TEXT) {
    if (re.test(String(text ?? ""))) out.push(`${label} contains ${what}`)
  }
  return out
}

export function emailProblems(label, email) {
  return BAD_EMAIL.test(String(email ?? "").trim()) ? [`${label} uses a tool vendor email`] : []
}

// Commits as records separated by NUL: sha, author email, committer email, full message.
export function parseLog(raw) {
  return raw
    .split("\x00")
    .filter((r) => r.trim() !== "")
    .map((r) => {
      const [sha, ae, ce, ...msg] = r.replace(/^\n/, "").split("\x1f")
      return { sha, authorEmail: ae, committerEmail: ce, message: msg.join("\x1f") }
    })
}

export function commitProblems(commits) {
  const out = []
  for (const c of commits) {
    const id = `commit ${String(c.sha).slice(0, 7)}`
    out.push(...textProblems(`${id} message`, c.message))
    out.push(...emailProblems(`${id} author`, c.authorEmail))
    out.push(...emailProblems(`${id} committer`, c.committerEmail))
  }
  return out
}

export function eventProblems(event) {
  const pr = event?.pull_request
  if (!pr) return []
  // Dependabot bodies quote upstream release notes verbatim; its commits are still checked.
  if (pr.user?.login === "dependabot[bot]") return []
  return [...textProblems("PR title", pr.title), ...textProblems("PR body", pr.body)]
}

// Resolves the commit range. A zero or empty base (first push, new branch) checks only the head.
export function rangeArgs(range) {
  const [base, head] = String(range).split("..")
  const ok = (v) => /^[0-9a-zA-Z._/][0-9a-zA-Z._/-]*$/.test(v)
  if (!head || !ok(head)) throw new Error(`bad range '${range}'`)
  if (!base || ZERO.test(base)) return ["-1", "--end-of-options", head]
  if (!ok(base)) throw new Error(`bad range '${range}'`)
  return ["--end-of-options", `${base}..${head}`]
}

function readCommits(range, args) {
  const fmt = "%H%x1f%ae%x1f%ce%x1f%B%x00"
  const run = (args) =>
    execFileSync("git", ["log", `--format=${fmt}`, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  try {
    return parseLog(run(args))
  } catch {
    // A base that is not in the clone (force-push, shallow history): check the head alone.
    // The range is already validated, so the head is a safe revision.
    const head = String(range).split("..")[1]
    console.log(`::warning::could not list ${range}; checking the head commit only`)
    return parseLog(run(["-1", "--end-of-options", head]))
  }
}

export function main(argv, { out = console.log } = {}) {
  let range = null
  let event = null
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--range") range = argv[i + 1]
    else if (argv[i] === "--event") event = argv[i + 1]
    else range = undefined
  }
  if (!range) {
    out("usage: check-attribution.mjs --range <base>..<head> [--event <payload.json>]")
    return 2
  }
  let args
  try {
    args = rangeArgs(range)
  } catch (e) {
    out(`::error::${e.message}`)
    return 2
  }
  const problems = commitProblems(readCommits(range, args))
  if (event) problems.push(...eventProblems(JSON.parse(readFileSync(event, "utf8"))))
  for (const p of problems) out(`::error::${p}`)
  if (problems.length === 0) out("No tooling attribution found.")
  return problems.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
