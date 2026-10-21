import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", ".github/scripts/wait-for-ci.sh")
const SHA = "0123456789abcdef0123456789abcdef01234567"
const dir = mkdtempSync(join(tmpdir(), "wait-ci-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that serves the next fixture of FAKE_SEQ on every call (the last one repeats) and
// applies the script's real --jq filter to it.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
echo "$2" >>"$FAKE_GH_LOG"
n=$(wc -l <"$FAKE_GH_LOG")
jq -c --argjson n "$n" '.[ ([$n, length] | min) - 1 ]' <<<"$FAKE_SEQ" | jq -r "$4"
`,
)
chmodSync(gh, 0o755)

const wr = (over = {}) => ({
  head_branch: "main",
  run_number: 1,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  ...over,
})
const runs = (...items) => ({ workflow_runs: items })

function run(sequence, env = {}) {
  const log = join(dir, `log-${Math.random()}`)
  writeFileSync(log, "")
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: "owner/repo",
      SHA,
      POLL_SECONDS: "0",
      MAX_WAIT_SECONDS: "60",
      FAKE_SEQ: JSON.stringify(sequence),
      FAKE_GH_LOG: log,
      ...env,
    },
  })
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
  }
}

test("a finished successful run passes at once and asks for this commit's push runs", () => {
  const { code, out, calls } = run([runs(wr())])
  assert.equal(code, 0, out)
  assert.equal(calls.length, 1)
  assert.match(calls[0], new RegExp(`ci\\.yml/runs\\?head_sha=${SHA}&event=push`))
})

test("an in-progress run is polled until it succeeds", () => {
  const { code, out, calls } = run([
    runs(wr({ status: "in_progress", conclusion: null })),
    runs(wr()),
  ])
  assert.equal(code, 0, out)
  assert.equal(calls.length, 2)
})

test("no run yet is polled too", () => {
  const { code, calls } = run([runs(), runs(wr())])
  assert.equal(code, 0)
  assert.equal(calls.length, 2)
})

test("a failed or cancelled run fails closed with a hint", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const { code, out } = run([runs(wr({ conclusion }))])
    assert.equal(code, 1, conclusion)
    assert.match(out, new RegExp(`::error::.*concluded ${conclusion}`), conclusion)
    assert.match(out, /nothing is released/, conclusion)
  }
})

test("nothing finished before the deadline times out", () => {
  const { code, out } = run([runs(wr({ status: "queued", conclusion: null }))], {
    MAX_WAIT_SECONDS: "0",
  })
  assert.equal(code, 1)
  assert.match(out, /::error::.*(Timed out|timed out)/)
})

test("the latest attempt wins", () => {
  const failedThenGreen = runs(wr({ conclusion: "failure" }), wr({ run_attempt: 2 }))
  assert.equal(run([failedThenGreen]).code, 0)
  const greenThenFailed = runs(wr(), wr({ run_attempt: 2, conclusion: "failure" }))
  assert.equal(run([greenThenFailed]).code, 1)
})

test("runs of other branches are ignored", () => {
  const { code } = run([runs(wr({ head_branch: "dev", conclusion: "failure" }), wr())])
  assert.equal(code, 0)
  const other = run([runs(wr({ head_branch: "dev" }))], { MAX_WAIT_SECONDS: "0" })
  assert.equal(other.code, 1)
})

test("bad inputs fail", () => {
  assert.equal(run([runs(wr())], { POLL_SECONDS: "x" }).code, 1)
  assert.equal(run([runs(wr())], { MAX_WAIT_SECONDS: "-1" }).code, 1)
  assert.equal(run([runs(wr())], { SHA: "main" }).code, 1)
})
