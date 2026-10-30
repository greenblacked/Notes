import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { branchProblems, main } from "./check-branch-name.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

test("conventional branches are allowed", () => {
  for (const b of [
    "fix/playwright-image-version",
    "feat/sidenotes",
    "feature/notes-site",
    "docs/release-v0.10.0",
    "ci/workflow-hardening",
    "text/ai-agentic-and-platform-notes",
    "chore/bump-node",
    "test/smoke-retries",
    "refactor/top-bar",
    "perf/csp-hashes",
    "build/wrangler",
    "fix/area/sub-topic",
    "docs/v0.10.1_notes",
  ]) {
    assert.deepEqual(branchProblems(b), [], b)
  }
})

test("dependabot and GitHub revert branches are allowed", () => {
  assert.deepEqual(branchProblems("dependabot/npm_and_yarn/@types/node-22.1.0"), [])
  assert.deepEqual(branchProblems("dependabot/github_actions/github-actions-abc123"), [])
  assert.deepEqual(branchProblems("revert-93-text/ai-agentic-and-platform-notes"), [])
})

test("tool-named branches are rejected with a tool message", () => {
  for (const b of [
    "claude/fix-links",
    "copilot/update-ci",
    "codex/x",
    "AI/notes",
    "bot/sync",
    "claude-fix/x",
  ]) {
    const p = branchProblems(b)
    assert.equal(p.length, 1, b)
    assert.match(p[0], /named after a tool/, b)
  }
})

test("other prefixes and malformed names are rejected", () => {
  for (const b of [
    "fb-/gracious-turing-o0bz0s",
    "dev",
    "main",
    "feature",
    "fix/",
    "fix/Upper-Case",
    "fix/with space",
    "fix/double--dash",
    "fix/trailing-",
    "fix//empty",
    "Fix/x",
    "revert-0-x",
    "revert-5-",
    "revert-12",
    "",
  ]) {
    assert.equal(branchProblems(b).length, 1, b)
  }
})

test("a text/ branch must be the single kebab segment that Text release accepts", () => {
  assert.deepEqual(branchProblems("text/research-notes-expansion"), [])
  for (const b of ["text/foo.bar", "text/a/b", "text/v1_x", "text/", "text/-x"]) {
    const p = branchProblems(b)
    assert.equal(p.length, 1, b)
    assert.match(p[0], /text\/<lower-case-kebab>/, b)
  }
})

test("the text/ rule is the same as the one Text release verifies", () => {
  const verifier = readFileSync(join(root, ".github", "scripts", "verify-text-merge.sh"), "utf8")
  assert.match(verifier, /\^text\/\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$/)
  const script = readFileSync(join(root, "scripts", "check-branch-name.mjs"), "utf8")
  assert.match(script, /\^text\\\/\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$/)
})

test("main prints annotations and returns the exit code", () => {
  const lines = []
  const out = (l) => lines.push(l)
  assert.equal(main(["ci/workflow-hardening"], { out }), 0)
  assert.equal(main(["fb-/x"], { out }), 1)
  assert.match(lines.at(-1), /^::error::branch 'fb-\/x' must start with one of /)
  assert.equal(main([], { out }), 2)
  assert.equal(main(["a", "b"], { out }), 2)
})
