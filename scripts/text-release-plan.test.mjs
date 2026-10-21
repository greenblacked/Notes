import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeRepo } from "./git-test-repo.mjs"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/text-release-plan.sh",
)
const dir = mkdtempSync(join(tmpdir(), "text-plan-"))
const repo = makeRepo("text-plan-repo-")
after(() => {
  rmSync(dir, { recursive: true, force: true })
  repo.cleanup()
})

// The fake `gh` answers the tag lookups of text-release-version.sh from FAKE_LATEST_SHA
// (empty: no tags at all).
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
if [[ "$2" == "--paginate" ]]; then shift; fi
case "$2" in
  */git/matching-refs/tags/v)
    if [[ -n "$FAKE_LATEST_SHA" ]]; then echo refs/tags/v0.6.0; fi ;;
  */git/ref/tags/v0.6.0) echo "commit $FAKE_LATEST_SHA" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

repo.write("README.md", "readme\n")
repo.write("content/a.md", "a\n")
const base = repo.commit("base")
repo.write("content/a.md", "a2\n")
const tagged = repo.commit("tagged")
const noTag = "0".repeat(40)

function run({ sha, latest = tagged, expectSteps = true } = {}) {
  const tmp = mkdtempSync(join(dir, "rt-"))
  mkdirSync(tmp, { recursive: true })
  const output = join(tmp, "output")
  const summary = join(tmp, "summary")
  writeFileSync(output, "")
  writeFileSync(summary, "")
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    cwd: repo.dir,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_REPO: "owner/repo",
      SHA: sha,
      PR: "74",
      HEAD_REF: "text/fix-typo",
      RUNNER_TEMP: tmp,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      FAKE_LATEST_SHA: latest,
    },
  })
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  )
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    outputs,
    summary: readFileSync(summary, "utf8"),
    notes: () => readFileSync(join(tmp, "notes.md"), "utf8"),
  }
}

test("a content-only change since the latest tag releases the next patch version", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", tagged)
  repo.write("content/new.md", "n\n")
  repo.remove("content/a.md")
  const sha = repo.commit("text")
  const r = run({ sha })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.release, "true")
  assert.equal(r.outputs.latest, "v0.6.0")
  assert.equal(r.outputs.tag, "v0.6.1")
  assert.equal(r.outputs.version, "0.6.1")
  const notes = r.notes()
  assert.match(notes, /pull request #74 \(`text\/fix-typo`\), on top of v0\.6\.0/)
  assert.match(notes, /- added `content\/new\.md`/)
  assert.match(notes, /- removed `content\/a\.md`/)
})

test("unreleased code since the latest tag refuses and names Cut release", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", tagged)
  repo.write("package.json", "{}\n")
  repo.commit("code")
  repo.write("content/b.md", "b\n")
  const sha = repo.commit("text")
  const r = run({ sha })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.release, "false")
  assert.match(r.out, /::warning::.*Cut release/)
  assert.match(r.summary, /Cut release/)
  assert.equal(r.outputs.tag, undefined)
})

test("a commit that is the latest tag or already in it releases nothing", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", tagged)
  for (const sha of [tagged, base]) {
    const r = run({ sha })
    assert.equal(r.code, 0, r.out)
    assert.equal(r.outputs.release, "false", sha)
    assert.match(r.out, /already in v0\.6\.0/, sha)
  }
})

test("an empty diff since the tag releases nothing", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", tagged)
  const sha = repo.commit("empty")
  const r = run({ sha })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.release, "false")
})

test("no vX.Y.Z tag yet means Cut release first", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", tagged)
  repo.write("content/c.md", "c\n")
  const sha = repo.commit("text")
  const r = run({ sha, latest: "" })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.release, "false")
  assert.match(r.out, /Cut release/)
})

test("a tag that is not an ancestor of the commit fails", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", base)
  repo.write("content/other.md", "o\n")
  const sha = repo.commit("diverged")
  const r = run({ sha, latest: tagged })
  assert.equal(r.code, 1)
  assert.match(r.out, /::error::/)
  assert.equal(r.outputs.release, undefined)
})

test("a tag commit missing from the checkout fails", () => {
  repo.checkout("main")
  repo.git("reset", "-q", "--hard", tagged)
  repo.write("content/d.md", "d\n")
  const sha = repo.commit("text")
  const r = run({ sha, latest: noTag.replace(/0/g, "e") })
  assert.equal(r.code, 1)
  assert.match(r.out, /::error::/)
})
