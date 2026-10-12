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
  ".github/scripts/require-ci-success.sh",
)
const SHA = "0123456789abcdef0123456789abcdef01234567"
const MAIN_SHA = "fedcba9876543210fedcba9876543210fedcba98"
const dir = mkdtempSync(join(tmpdir(), "require-ci-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that answers the three API calls from FAKE_CI_COUNT, FAKE_MAIN_SHA and
// FAKE_COMPARE_STATUS and records the endpoints it was asked for.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
echo "$2" >>"$FAKE_GH_LOG"
case "$2" in
  */actions/workflows/ci.yml/runs*) echo "$FAKE_CI_COUNT" ;;
  */git/ref/heads/main) echo "$FAKE_MAIN_SHA" ;;
  */compare/$FAKE_MAIN_SHA...*) echo "$FAKE_COMPARE_STATUS" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

function run({ count = "1", status = "behind", sha = SHA, mainSha = MAIN_SHA } = {}) {
  const log = join(dir, `log-${Math.random()}`)
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: "owner/repo",
      SHA: sha,
      FAKE_CI_COUNT: count,
      FAKE_MAIN_SHA: mainSha,
      FAKE_COMPARE_STATUS: status,
      FAKE_GH_LOG: log,
    },
  })
  return { code: result.status, out: result.stdout + result.stderr, log }
}

test("passes for a CI-passed commit that is the head of main or behind it", () => {
  for (const status of ["identical", "behind"]) {
    const { code, out } = run({ status })
    assert.equal(code, 0, out)
    assert.match(out, /on main \(compare status: /)
  }
})

test("fails without a successful CI run", () => {
  const { code, out } = run({ count: "0" })
  assert.equal(code, 1)
  assert.match(out, /No successful ci\.yml push run found/)
})

test("fails for a commit that is not on main", () => {
  for (const status of ["ahead", "diverged"]) {
    const { code, out } = run({ status })
    assert.equal(code, 1, status)
    assert.match(out, /is not on main/)
  }
})

test("fails for a SHA that is not a full commit id", () => {
  const { code, out } = run({ sha: "main" })
  assert.equal(code, 1)
  assert.match(out, /40-character/)
})

test("compares against the resolved SHA of main, not the name", () => {
  const { code, log } = run()
  assert.equal(code, 0)
  const asked = readFileSync(log, "utf8")
  assert.match(asked, /git\/ref\/heads\/main/)
  assert.match(asked, new RegExp(`compare/${MAIN_SHA}\\.\\.\\.${SHA}`))
  assert.doesNotMatch(asked, /compare\/main\.\.\./)
})

test("fails when main does not resolve to a full commit id", () => {
  const { code, out } = run({ mainSha: "not-a-sha" })
  assert.equal(code, 1)
  assert.match(out, /Could not resolve the head of main/)
})
