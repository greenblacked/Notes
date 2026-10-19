import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
  "delete-merged-branches.yml",
)
const raw = readFileSync(file, "utf8")
const workflow = parse(raw)
const job = workflow.jobs.delete
const guardRun = job.steps[0].run
const deleteRun = job.steps[1].run

test("it is a manual run with a dry run by default", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"])
  const inputs = workflow.on.workflow_dispatch.inputs
  assert.deepEqual(Object.keys(inputs).sort(), ["dry_run", "extra"])
  assert.equal(inputs.dry_run.type, "boolean")
  assert.equal(inputs.dry_run.default, true)
  assert.equal(inputs.extra.type, "string")
  assert.equal(inputs.extra.default, "dev feature/notes-site")
})

test("permissions are minimal and no secrets or environments are used", () => {
  assert.deepEqual(workflow.permissions, {})
  assert.deepEqual(job.permissions, { contents: "write", "pull-requests": "read" })
  assert.equal(job.environment, undefined)
  assert.ok(!raw.includes("secrets."))
  assert.equal(job["runs-on"], "ubuntu-24.04")
  assert.ok(job["timeout-minutes"] >= 1 && job["timeout-minutes"] <= 15)
  assert.deepEqual(workflow.concurrency, {
    group: "delete-merged-branches",
    "cancel-in-progress": false,
  })
})

test("it is guarded to the owner, main and workflow_dispatch", () => {
  assert.equal(job.if, "github.repository == 'greenblacked/Notes'")
  for (const needle of [
    "set -euo pipefail",
    '"$REF" != "refs/heads/main"',
    '"$EVENT" != "workflow_dispatch"',
    '"$ACTOR" != "greenblacked"',
    '"$TRIGGERING_ACTOR" != "greenblacked"',
  ]) {
    assert.ok(guardRun.includes(needle), `guard contains ${needle}`)
  }
})

test("inputs reach the scripts only through env, with no third-party actions", () => {
  assert.equal(job.env.DRY_RUN, "${{ inputs.dry_run }}")
  assert.equal(job.env.EXTRA, "${{ inputs.extra }}")
  assert.equal(job.env.GH_TOKEN, "${{ github.token }}")
  for (const step of job.steps) {
    assert.equal(step.uses, undefined)
    assert.ok(!step.run.includes("${{"), "no expression inside run")
  }
})

test("the delete step carries the deletion rules", () => {
  for (const needle of [
    '"$DRY_RUN" == "true"',
    "git/refs/heads/$path",
    '"dependabot[bot]"',
    ".head_sha == env.S",
    '.base_ref == "main"',
    '"$protected" == "true"',
    "dependabot/*",
    "GITHUB_STEP_SUMMARY",
  ]) {
    assert.ok(deleteRun.includes(needle), `delete step contains ${needle}`)
  }
  assert.equal(deleteRun.split("-X DELETE").length - 1, 1, "exactly one delete call")
  assert.ok(deleteRun.split("--paginate").length - 1 >= 2, "branches and pulls are paginated")
})

const baseEnv = {
  PATH: process.env.PATH,
  REPO: "greenblacked/Notes",
  REF: "refs/heads/main",
  EVENT: "workflow_dispatch",
  ACTOR: "greenblacked",
  TRIGGERING_ACTOR: "greenblacked",
  DRY_RUN: "true",
  EXTRA: "dev feature/notes-site",
}
const guard = (over) =>
  spawnSync("bash", ["-c", guardRun], { env: { ...baseEnv, ...over }, encoding: "utf8" }).status

test("the guard accepts the defaults and an empty list", () => {
  assert.equal(guard({}), 0)
  assert.equal(guard({ EXTRA: "" }), 0)
})

test("the guard refuses main, dependabot and malformed branch lists", () => {
  for (const extra of [
    "main",
    "Main",
    "dev main",
    "dependabot/npm_and_yarn/x",
    "Dependabot/x",
    "-x",
    "a//b",
    "/a",
    "a/",
    "a..b",
    "x.lock",
    "dev  x",
    "dev;id",
    "$(id)",
  ]) {
    assert.equal(guard({ EXTRA: extra }), 1, `refuses ${JSON.stringify(extra)}`)
  }
})

test("the guard refuses another ref, actor or dry_run value", () => {
  assert.equal(guard({ REF: "refs/heads/dev" }), 1)
  assert.equal(guard({ ACTOR: "other" }), 1)
  assert.equal(guard({ TRIGGERING_ACTOR: "other" }), 1)
  assert.equal(guard({ DRY_RUN: "yes" }), 1)
})

const hasJq = spawnSync("jq", ["--version"]).status === 0
const skip = hasJq ? false : "jq not installed"

const FAKE_GH = `#!/bin/bash
set -euo pipefail
method=GET filter="" path=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    api | --paginate) ;;
    -X) method=$2; shift ;;
    --jq) filter=$2; shift ;;
    *) path=$1 ;;
  esac
  shift
done
echo "$method $path" >>"$FAKE_LOG"
if [[ "$method" == "DELETE" ]]; then exit "\${FAKE_DELETE_STATUS:-0}"; fi
file="$FAKE_DIR/$(printf '%s' "$path" | sed 's/[^A-Za-z0-9]/_/g').json"
[[ -f "$file" ]] || { echo "HTTP 404" >&2; exit 1; }
if [[ -n "$filter" ]]; then jq -r "$filter" "$file"; else cat "$file"; fi
`

const R = "greenblacked/Notes"
const pr = (
  number,
  state,
  author,
  headRepo,
  headRef,
  headSha,
  base,
  merged = state === "closed" && headRef !== "gone",
) => ({
  number,
  state,
  merged_at: merged ? "2026-10-01T00:00:00Z" : null,
  user: { login: author },
  head: { ref: headRef, sha: headSha, repo: { full_name: headRepo } },
  base: { ref: base },
})
const branches = [
  ["main", "m1"],
  ["dev", "d1"],
  ["feature/notes-site", "f1"],
  ["fix/merged", "a1"],
  ["fix/moved", "b2"],
  ["fix/open", "c1"],
  ["feat/base", "e1"],
  ["fork-name", "g1"],
  ["dependabot/npm_and_yarn/x", "h1"],
  ["prot", "p1", true],
  ["lonely", "l1"],
  ["fix/closed", "k1"],
].map(([name, sha, protectedFlag]) => ({
  name,
  commit: { sha },
  protected: protectedFlag === true,
}))
const pulls = [
  pr(42, "open", "dependabot[bot]", R, "dependabot/npm_and_yarn/x", "h1", "dev"),
  pr(43, "open", "dependabot[bot]", R, "dependabot/npm_and_yarn/x", "h1", "dev"),
  pr(10, "closed", "greenblacked", R, "fix/merged", "a1", "main"),
  pr(11, "closed", "greenblacked", R, "fix/moved", "b1", "main"),
  pr(12, "open", "greenblacked", R, "fix/open", "c1", "main"),
  pr(13, "open", "greenblacked", R, "feat/x", "x1", "feat/base"),
  pr(14, "closed", "someone", "someone/Notes", "fork-name", "g1", "main"),
  pr(15, "closed", "greenblacked", R, "fix/closed", "k1", "main", false),
]

const key = (path) => path.replace(/[^A-Za-z0-9]/g, "_") + ".json"

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "dmb-"))
  const bin = join(tmp, "bin")
  const fake = join(tmp, "fake")
  mkdirSync(bin)
  mkdirSync(fake)
  writeFileSync(join(bin, "gh"), FAKE_GH)
  chmodSync(join(bin, "gh"), 0o755)
  const put = (path, data) => writeFileSync(join(fake, key(path)), JSON.stringify(data))
  put(`repos/${R}`, { default_branch: "main" })
  put(`repos/${R}/branches?per_page=100`, branches)
  put(`repos/${R}/pulls?state=all&per_page=100`, pulls)
  for (const [name, sha] of [
    ["dev", "d1"],
    ["feature/notes-site", "f1"],
    ["fix/merged", "a1"],
  ]) {
    put(`repos/${R}/git/ref/heads/${name}`, { object: { sha } })
  }
  const run = (over) => {
    const log = join(tmp, "log.txt")
    const summary = join(tmp, "summary.md")
    writeFileSync(log, "")
    writeFileSync(summary, "")
    const res = spawnSync("bash", ["-c", deleteRun], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        REPO: R,
        RUNNER_TEMP: tmp,
        GITHUB_STEP_SUMMARY: summary,
        FAKE_DIR: fake,
        FAKE_LOG: log,
        DRY_RUN: "true",
        EXTRA: "dev feature/notes-site gone",
        ...over,
      },
    })
    return {
      res,
      log: readFileSync(log, "utf8"),
      summary: readFileSync(summary, "utf8"),
    }
  }
  return { tmp, put, run }
}

const row = (summary, name) =>
  summary.split("\n").find((l) => l.startsWith(`| <code>${name}</code> |`)) ?? ""

test("a dry run deletes nothing and reports every decision", { skip }, () => {
  const { tmp, run } = setup()
  try {
    const { res, log, summary } = run({})
    assert.equal(res.status, 0, res.stderr)
    assert.ok(!log.includes("DELETE"))
    assert.ok(summary.includes("(dry run, nothing deleted)"))
    assert.match(row(summary, "dev"), /would delete.*#42 #43/)
    assert.match(row(summary, "feature/notes-site"), /would delete/)
    assert.match(row(summary, "fix/merged"), /would delete/)
    assert.match(row(summary, "gone"), /not found/)
    for (const name of [
      "fix/moved",
      "fix/open",
      "feat/base",
      "fork-name",
      "dependabot/npm_and_yarn/x",
      "prot",
      "main",
      "lonely",
      "fix/closed",
    ]) {
      assert.match(row(summary, name), /\| kept \|/, `${name} is kept`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a real run deletes exactly the eligible branches", { skip }, () => {
  const { tmp, run } = setup()
  try {
    const { res, log, summary } = run({ DRY_RUN: "false" })
    assert.equal(res.status, 0, res.stderr)
    const deletes = log.split("\n").filter((l) => l.startsWith("DELETE"))
    assert.deepEqual(deletes, [
      `DELETE repos/${R}/git/refs/heads/dev`,
      `DELETE repos/${R}/git/refs/heads/feature/notes-site`,
      `DELETE repos/${R}/git/refs/heads/fix/merged`,
    ])
    assert.equal(summary.split("\n").filter((l) => /\| deleted \|/.test(l)).length, 3)
    assert.ok(!log.includes("git/refs/heads/fix/closed"))
    assert.match(row(summary, "fix/closed"), /\| kept \|/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a branch whose head moved during the run is kept", { skip }, () => {
  const { tmp, put, run } = setup()
  try {
    put(`repos/${R}/git/ref/heads/fix/merged`, { object: { sha: "zz" } })
    const { res, log, summary } = run({ DRY_RUN: "false", EXTRA: "" })
    assert.equal(res.status, 0, res.stderr)
    assert.ok(!log.includes("DELETE repos/greenblacked/Notes/git/refs/heads/fix/merged"))
    assert.match(row(summary, "fix/merged"), /its head changed/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a refused delete fails the run", { skip }, () => {
  const { tmp, run } = setup()
  try {
    const { res, summary } = run({ DRY_RUN: "false", FAKE_DELETE_STATUS: "1" })
    assert.equal(res.status, 1)
    assert.match(summary, /\| failed \|/)
    assert.ok(res.stdout.includes("::error::"))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
