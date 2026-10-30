#!/usr/bin/env node
// Fails a pull request whose head branch does not follow the `<type>/<kebab>` convention
// (docs/deployment.md). A branch name is permanent: it is the source ref in the merge commit
// subject (`Merge pull request #N from owner/<branch>`), long after the branch is deleted.
// Node built-ins only.
//   check-branch-name.mjs <branch>
// Allowed: `<type>/<segment>[/<segment>...]` with a type below and lower-case segments (letters,
// digits, single `.`, `_` or `-` between them, as in `docs/release-v0.10.0`), `dependabot/...`
// (the bot owns that namespace), and `revert-<N>-...` (GitHub's Revert button). A `text/` branch
// is stricter: exactly `text/<lower-case-kebab>`, the form .github/scripts/verify-text-merge.sh
// releases; any other text/ name would pass CI and then silently not be released.
// This is a naming check run from the pull request's head, not a security gate: unlike the
// text/ path gate it is not run from the base commit.
import { pathToFileURL } from "node:url"

export const TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "feature",
  "fix",
  "perf",
  "refactor",
  "test",
  "text",
]

// Prefixes that name the tool that made the branch rather than the change.
const TOOL_PREFIXES = ["ai", "bot", "claude", "codex", "copilot", "cursor", "devin"]

const SEGMENT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
// Must match the head-branch rule in .github/scripts/verify-text-merge.sh.
const TEXT_BRANCH = /^text\/[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Returns the problems with a head branch name; an empty list means it is allowed. */
export function branchProblems(name) {
  const branch = String(name ?? "")
  if (branch === "") return ["the head branch name is empty"]
  if (branch.startsWith("dependabot/")) return []
  if (/^revert-[1-9][0-9]*-./.test(branch)) return []
  const [type, ...rest] = branch.split("/")
  const lower = type.toLowerCase()
  if (TOOL_PREFIXES.includes(lower) || TOOL_PREFIXES.some((t) => lower.startsWith(`${t}-`))) {
    return [`branch '${branch}' is named after a tool; name it after the change, e.g. fix/<kebab>`]
  }
  if (!TYPES.includes(type)) {
    return [`branch '${branch}' must start with one of ${TYPES.map((t) => `${t}/`).join(", ")}`]
  }
  if (type === "text" && !TEXT_BRANCH.test(branch)) {
    return [
      `branch '${branch}' must be text/<lower-case-kebab> (one segment, no . or _), or Text release will not release it`,
    ]
  }
  if (rest.length === 0 || rest.some((s) => !SEGMENT.test(s))) {
    return [`branch '${branch}' must be ${type}/<lower-case-kebab>, e.g. ${type}/short-summary`]
  }
  return []
}

export function main(argv, { out = console.log } = {}) {
  if (argv.length !== 1) {
    out("usage: check-branch-name.mjs <branch>")
    return 2
  }
  const problems = branchProblems(argv[0])
  for (const p of problems) out(`::error::${p}`)
  if (problems.length === 0) out(`Branch name '${argv[0]}' follows the convention.`)
  return problems.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
