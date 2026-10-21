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
  ".github/scripts/require-release-actor.sh",
)
const SHA = "0123456789abcdef0123456789abcdef01234567"
const OWNER = "greenblacked"
const BOT = "github-actions[bot]"
const dir = mkdtempSync(join(tmpdir(), "require-actor-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that records the endpoint and applies the real --jq filter to the fixture in
// FAKE_RUNS, so the filter in the script is what the tests exercise.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
if [[ "$1" == "--paginate" ]]; then shift; fi
if [[ "$2" == "--paginate" ]]; then shift; fi
echo "$2" >>"$FAKE_GH_LOG"
case "$2" in
  */actions/workflows/cut-release.yml/runs*) printf '%s' "$FAKE_RUNS" | jq -r "$4" ;;
  */actions/workflows/text-release.yml/runs*) printf '%s' "$FAKE_TEXT_RUNS" | jq -r "$4" ;;
  */commits/*/pulls) printf '%s' "$FAKE_PULLS" | jq -r "$4" ;;
  */pulls/*) printf '%s' "$FAKE_PR" | jq -r "$4" ;;
  */git/matching-refs/tags/v) printf '%s' "$FAKE_REFS" | jq -r "$4" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

const goodRun = {
  head_branch: "main",
  actor: { login: OWNER },
  triggering_actor: { login: OWNER },
  status: "completed",
  conclusion: "success",
}
const runs = (...items) => ({ workflow_runs: items })

const TAG = "v0.6.1"
const goodTextRun = { ...goodRun, event: "push" }
const goodPull = {
  number: 7,
  merge_commit_sha: SHA,
  merged_at: "2026-10-21T10:00:00Z",
  base: { ref: "main" },
  head: { ref: "text/fix-typo", repo: { full_name: "owner/repo" } },
}
const goodPr = {
  merged: true,
  merge_commit_sha: SHA,
  merged_by: { login: OWNER },
  head: { ref: "text/fix-typo", repo: { full_name: "owner/repo" } },
  base: { ref: "main", repo: { full_name: "owner/repo" } },
}
const refs = (...tags) => tags.map((t) => ({ ref: `refs/tags/${t}` }))

function run({
  actor,
  triggering,
  fixture = runs(goodRun),
  sha = SHA,
  tag = TAG,
  textRuns = runs(goodTextRun),
  pulls = [goodPull],
  pr = goodPr,
  tags = refs("v0.6.0", TAG, "v0.5.0", "v1.0.0-rc1"),
}) {
  const log = join(dir, `log-${Math.random()}`)
  writeFileSync(log, "")
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: "owner/repo",
      SHA: sha,
      ACTOR: actor,
      TRIGGERING_ACTOR: triggering,
      TAG: tag,
      FAKE_RUNS: JSON.stringify(fixture),
      FAKE_TEXT_RUNS: JSON.stringify(textRuns),
      FAKE_PULLS: JSON.stringify(pulls),
      FAKE_PR: JSON.stringify(pr),
      FAKE_REFS: JSON.stringify(tags),
      FAKE_GH_LOG: log,
    },
  })
  return {
    code: result.status,
    out: result.stdout + result.stderr,
    asked: readFileSync(log, "utf8"),
  }
}

test("the owner passes without an API call", () => {
  const { code, out, asked } = run({ actor: OWNER, triggering: OWNER })
  assert.equal(code, 0, out)
  assert.equal(asked, "")
})

test("a Cut release dispatch of the owner passes and is looked up for this commit", () => {
  const { code, out, asked } = run({ actor: BOT, triggering: BOT })
  assert.equal(code, 0, out)
  assert.match(asked, new RegExp(`head_sha=${SHA}`))
  assert.match(asked, /cut-release\.yml/)
})

test("an owner re-run of a Cut release dispatch passes", () => {
  const { code, out } = run({ actor: BOT, triggering: OWNER })
  assert.equal(code, 0, out)
})

test("the bot without a Cut release run of the owner fails", () => {
  const { code, out } = run({ actor: BOT, triggering: BOT, fixture: runs(), textRuns: runs() })
  assert.equal(code, 1)
  assert.match(out, /No Cut release run/)
})

test("an in-progress Cut release run of the owner passes", () => {
  const fixture = runs({ ...goodRun, status: "in_progress", conclusion: null })
  assert.equal(run({ actor: BOT, triggering: BOT, fixture }).code, 0)
})

test("Cut release runs that do not match the filter fail", () => {
  const cases = {
    "wrong branch": { ...goodRun, head_branch: "dev" },
    "non-owner actor": { ...goodRun, actor: { login: "other" } },
    "non-owner triggering actor": { ...goodRun, triggering_actor: { login: "other" } },
    "failed run": { ...goodRun, conclusion: "failure" },
    "cancelled run": { ...goodRun, conclusion: "cancelled" },
    "queued run": { ...goodRun, status: "queued", conclusion: null },
  }
  for (const [name, item] of Object.entries(cases)) {
    const { code, out } = run({
      actor: BOT,
      triggering: BOT,
      fixture: runs(item),
      textRuns: runs(),
    })
    assert.equal(code, 1, name)
    assert.match(out, /No Cut release run/, name)
  }
})

test("anyone else fails", () => {
  for (const [actor, triggering] of [
    ["other", "other"],
    [OWNER, "other"],
  ]) {
    const { code, out } = run({ actor, triggering })
    assert.equal(code, 1, `${actor}/${triggering}`)
    assert.match(out, /limited to the repository owner/)
  }
})

test("the bot re-run by someone else fails without an API call", () => {
  const { code, asked } = run({ actor: BOT, triggering: "other" })
  assert.equal(code, 1)
  assert.equal(asked, "")
})

test("a short SHA fails", () => {
  const { code, out } = run({ actor: OWNER, triggering: OWNER, sha: "main" })
  assert.equal(code, 1)
  assert.match(out, /40-character/)
})

// The text path: Text release dispatches Deploy production with GITHUB_TOKEN after the owner
// merged a text/ pull request. No Cut release run exists for it.
const text = (extra = {}) => run({ actor: BOT, triggering: BOT, fixture: runs(), ...extra })

test("a Cut release pass makes no text lookup", () => {
  const { asked } = run({ actor: BOT, triggering: BOT })
  assert.doesNotMatch(asked, /text-release|pulls|matching-refs/)
})

test("a verified text/ merge release of the highest tag passes", () => {
  const { code, out, asked } = text()
  assert.equal(code, 0, out)
  assert.match(asked, new RegExp(`text-release\\.yml/runs\\?head_sha=${SHA}&event=push`))
  assert.match(asked, new RegExp(`commits/${SHA}/pulls`))
  assert.match(asked, /matching-refs\/tags\/v/)
  assert.match(out, /Text release run of the owner/)
})

test("an owner re-run of a text dispatch passes", () => {
  assert.equal(text({ triggering: OWNER }).code, 0)
})

test("an in-progress Text release run passes", () => {
  const textRuns = runs({ ...goodTextRun, status: "in_progress", conclusion: null })
  assert.equal(text({ textRuns }).code, 0)
})

test("Text release runs that do not match the filter fail", () => {
  const cases = {
    "no run": runs(),
    "non-owner actor": runs({ ...goodTextRun, actor: { login: "other" } }),
    "non-owner triggering actor": runs({ ...goodTextRun, triggering_actor: { login: "other" } }),
    "not a push": runs({ ...goodTextRun, event: "workflow_dispatch" }),
    "wrong branch": runs({ ...goodTextRun, head_branch: "dev" }),
    "failed run": runs({ ...goodTextRun, conclusion: "failure" }),
    "queued run": runs({ ...goodTextRun, status: "queued", conclusion: null }),
  }
  for (const [name, textRuns] of Object.entries(cases)) {
    const { code, out } = text({ textRuns })
    assert.equal(code, 1, name)
    assert.match(out, /No Cut release run by the owner, nor a verified text\/ merge release/, name)
  }
})

test("a text release fails when the merge is not a verified owner text/ merge", () => {
  const cases = {
    "merged by someone else": { pr: { ...goodPr, merged_by: { login: "other" } } },
    "fork head": {
      pulls: [{ ...goodPull, head: { ref: "text/x", repo: { full_name: "evil/repo" } } }],
    },
    "no pull request": { pulls: [] },
    "not a text/ head": { pulls: [{ ...goodPull, head: { ...goodPull.head, ref: "feat/x" } }] },
  }
  for (const [name, extra] of Object.entries(cases)) {
    const { code, out } = text(extra)
    assert.equal(code, 1, name)
    assert.match(out, /nor a verified text\/ merge release/, name)
  }
})

test("a text release fails unless the tag is the highest release tag", () => {
  const { code, out } = text({ tag: "v0.6.0", tags: refs("v0.6.0", "v0.6.1") })
  assert.equal(code, 1)
  assert.match(out, /nor a verified text\/ merge release/)
  assert.equal(text({ tag: "v0.6.9", tags: refs("v0.6.9", "v0.6.10") }).code, 1)
  assert.equal(text({ tags: [] }).code, 1)
})

test("a text release fails for a bad tag", () => {
  for (const tag of ["", "main", "v01.2.3", "v1.2", "v1.2.3-rc1"]) {
    const { code } = text({ tag, tags: refs(tag || "v0.6.1") })
    assert.equal(code, 1, tag)
  }
})
