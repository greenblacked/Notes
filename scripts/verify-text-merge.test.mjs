import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/verify-text-merge.sh",
)
const SHA = "0123456789abcdef0123456789abcdef01234567"
const REPO = "owner/repo"
const dir = mkdtempSync(join(tmpdir(), "verify-text-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that applies the script's real --jq filter to the fixtures, so the filters are
// what the tests exercise. FAKE_GH_FAIL makes every call fail.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
if [[ -n "\${FAKE_GH_FAIL:-}" ]]; then exit 1; fi
case "$2" in
  */commits/*/pulls) printf '%s' "$FAKE_PULLS" | jq -r "$4" ;;
  */pulls/*) printf '%s' "$FAKE_PR" | jq -r "$4" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

const candidate = {
  number: 7,
  merge_commit_sha: SHA,
  merged_at: "2026-10-21T10:00:00Z",
  base: { ref: "main" },
  head: { ref: "text/fix-typo", repo: { full_name: REPO } },
}
const pr = {
  merged: true,
  merge_commit_sha: SHA,
  merged_by: { login: "greenblacked" },
  head: { ref: "text/fix-typo", repo: { full_name: REPO } },
  base: { ref: "main", repo: { full_name: REPO } },
}

function run({ pulls = [candidate], detail = pr, sha = SHA, fail = "" } = {}) {
  const out = join(dir, `out-${Math.random()}`)
  writeFileSync(out, "")
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: REPO,
      SHA: sha,
      FAKE_PULLS: JSON.stringify(pulls),
      FAKE_PR: JSON.stringify(detail),
      FAKE_GH_FAIL: fail,
      GITHUB_OUTPUT: out,
    },
  })
  return { code: r.status, out: r.stdout + r.stderr, written: readFileSync(out, "utf8") }
}

test("a text/ merge by the owner passes and writes pr and head_ref", () => {
  const { code, out, written } = run()
  assert.equal(code, 0, out)
  assert.equal(written, "pr=7\nhead_ref=text/fix-typo\n")
})

test("anything that is not a verified text/ merge by the owner exits 3", () => {
  const cases = {
    "non-text head": {
      pulls: [{ ...candidate, head: { ...candidate.head, ref: "feat/x" } }],
    },
    "fork head in the list": {
      pulls: [{ ...candidate, head: { ref: "text/x", repo: { full_name: "evil/repo" } } }],
    },
    "different merge commit in the list": {
      pulls: [{ ...candidate, merge_commit_sha: "f".repeat(40) }],
    },
    "not merged in the list": { pulls: [{ ...candidate, merged_at: null }] },
    "base not main in the list": { pulls: [{ ...candidate, base: { ref: "dev" } }] },
    "no candidates": { pulls: [] },
    "not merged": { detail: { ...pr, merged: false } },
    "merged as another commit": { detail: { ...pr, merge_commit_sha: "f".repeat(40) } },
    "merged by someone else": { detail: { ...pr, merged_by: { login: "other" } } },
    "merged_by null": { detail: { ...pr, merged_by: null } },
    "bad head name": { detail: { ...pr, head: { ...pr.head, ref: "text/Bad_Name" } } },
    "head repo other": { detail: { ...pr, head: { ref: "text/x", repo: { full_name: "o/r" } } } },
    "head repo deleted": { detail: { ...pr, head: { ref: "text/x", repo: null } } },
    "base not main": { detail: { ...pr, base: { ...pr.base, ref: "dev" } } },
    "base repo other": { detail: { ...pr, base: { ref: "main", repo: { full_name: "o/r" } } } },
  }
  for (const [name, input] of Object.entries(cases)) {
    const { code, out, written } = run(input)
    assert.equal(code, 3, `${name}: ${out}`)
    assert.match(out, /::notice::/, name)
    assert.equal(written, "", name)
  }
})

test("a non-owner merge names the merger", () => {
  const { out } = run({ detail: { ...pr, merged_by: { login: "other" } } })
  assert.match(out, /merged by 'other', not the owner/)
})

test("two candidates, an API failure and a short SHA exit 1", () => {
  assert.equal(run({ pulls: [candidate, { ...candidate, number: 8 }] }).code, 1)
  assert.equal(run({ fail: "1" }).code, 1)
  const short = run({ sha: "main" })
  assert.equal(short.code, 1)
  assert.match(short.out, /40-character/)
})
