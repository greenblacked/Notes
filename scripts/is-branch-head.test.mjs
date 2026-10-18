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
  ".github/scripts/is-branch-head.sh",
)
const SHA = "0123456789abcdef0123456789abcdef01234567"
const OTHER = "fedcba9876543210fedcba9876543210fedcba98"
const dir = mkdtempSync(join(tmpdir(), "is-branch-head-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that answers the ref lookup with FAKE_HEAD and records the endpoint.
const gh = join(dir, "gh")
writeFileSync(gh, `#!/usr/bin/env bash\necho "$2" >>"$FAKE_GH_LOG"\necho "$FAKE_HEAD"\n`)
chmodSync(gh, 0o755)

function run({ branch = "dev", sha = SHA, head = SHA } = {}) {
  const id = Math.random()
  const log = join(dir, `log-${id}`)
  const output = join(dir, `output-${id}`)
  writeFileSync(output, "")
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    GH_TOKEN: "x",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_OUTPUT: output,
    SHA: sha,
    FAKE_HEAD: head,
    FAKE_GH_LOG: log,
  }
  if (branch === null) delete env.BRANCH
  else env.BRANCH = branch
  const result = spawnSync("bash", [script], { encoding: "utf8", env })
  return {
    code: result.status,
    out: result.stdout + result.stderr,
    output: readFileSync(output, "utf8"),
    log,
  }
}

test("current=true when the commit is the head of the branch", () => {
  const { code, output, log } = run()
  assert.equal(code, 0)
  assert.equal(output.trim(), "current=true")
  assert.match(readFileSync(log, "utf8"), /git\/ref\/heads\/dev/)
})

test("current=false when the branch moved on", () => {
  const { code, output, out } = run({ head: OTHER })
  assert.equal(code, 0)
  assert.equal(output.trim(), "current=false")
  assert.match(out, /no longer the head of dev/)
})

test("fails without a plain BRANCH", () => {
  for (const branch of [null, "", "a b", "x;y"]) {
    const { code, out } = run({ branch })
    assert.equal(code, 1, String(branch))
    assert.match(out, /BRANCH must be a plain branch name/)
  }
})

test("fails for a SHA that is not a full commit id", () => {
  const { code, out } = run({ sha: "dev" })
  assert.equal(code, 1)
  assert.match(out, /40-character/)
})
