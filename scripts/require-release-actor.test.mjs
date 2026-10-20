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

// A fake `gh` that answers the Cut release lookup with FAKE_COUNT and records the endpoint.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
echo "$2" >>"$FAKE_GH_LOG"
case "$2" in
  */actions/workflows/cut-release.yml/runs*) echo "$FAKE_COUNT" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

function run({ actor, triggering, count = "1", sha = SHA }) {
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
      FAKE_COUNT: count,
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
  const { code, out } = run({ actor: BOT, triggering: BOT, count: "0" })
  assert.equal(code, 1)
  assert.match(out, /No Cut release run/)
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
