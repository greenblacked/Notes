import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/require-stage-success.sh",
)
const SHA = "0123456789abcdef0123456789abcdef01234567"
const dir = mkdtempSync(join(tmpdir(), "require-stage-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that logs its arguments and answers the two API calls from fixture files. It
// applies the real --jq filter with jq, page by page, which simulates --paginate.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
echo "$*" >>"$FAKE_GH_LOG"
if [[ "\${FAKE_GH_FAIL:-}" == "1" ]]; then exit 1; fi
filter=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [[ "\${args[i]}" == "--jq" ]]; then filter="\${args[i + 1]}"; fi
done
case "$2" in
  */actions/workflows/deploy-stage.yml/runs*)
    for page in $(ls "$FAKE_RUNS_DIR" | sort); do jq -c "$filter" "$FAKE_RUNS_DIR/$page"; done ;;
  */actions/runs/*/jobs*) jq -c "$filter" "$FAKE_JOBS" ;;
  *) exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

let counter = 0
const mkRun = (o = {}) => ({
  id: 1000 + (o.run_number ?? 1),
  run_number: 1,
  run_attempt: 1,
  head_sha: SHA,
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  ...o,
})
const mkJob = (o = {}) => ({
  name: "Update stage Preview",
  conclusion: "success",
  steps: [
    { name: "Skip when main moved on", conclusion: "skipped" },
    { name: "Update the stage Preview", conclusion: "success" },
  ],
  ...o,
})
const withStep = (conclusion) =>
  mkJob({ steps: [{ name: "Update the stage Preview", conclusion }] })

function run({
  pages = [[mkRun()]],
  jobs = [mkJob()],
  sha = SHA,
  summary = true,
  fail = false,
} = {}) {
  const base = join(dir, `case-${counter++}`)
  const runsDir = join(base, "runs")
  mkdirSync(runsDir, { recursive: true })
  pages.forEach((runs, i) =>
    writeFileSync(join(runsDir, `page-${i + 1}.json`), JSON.stringify({ workflow_runs: runs })),
  )
  const jobsFile = join(base, "jobs.json")
  writeFileSync(jobsFile, JSON.stringify({ jobs }))
  const log = join(base, "gh.log")
  const summaryFile = join(base, "summary.md")
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    GH_REPO: "owner/repo",
    SHA: sha,
    GITHUB_SERVER_URL: "https://github.com",
    FAKE_RUNS_DIR: runsDir,
    FAKE_JOBS: jobsFile,
    FAKE_GH_LOG: log,
    FAKE_GH_FAIL: fail ? "1" : "",
  }
  if (summary) env.GITHUB_STEP_SUMMARY = summaryFile
  else delete env.GITHUB_STEP_SUMMARY
  const r = spawnSync("bash", [script], { encoding: "utf8", env })
  const read = (f) => {
    try {
      return readFileSync(f, "utf8")
    } catch {
      return ""
    }
  }
  return { code: r.status, out: r.stdout + r.stderr, log: read(log), summary: read(summaryFile) }
}

test("passes for a green run that updated stage and records it", () => {
  const { code, out, summary } = run()
  assert.equal(code, 0, out)
  assert.ok(summary.includes("https://github.com/owner/repo/actions/runs/1001"))
  assert.ok(summary.includes(SHA))
  assert.match(summary, /run #/)
})

test("picks the newest run across pages", () => {
  const r1 = run({
    pages: [[mkRun({ run_number: 5 })], [mkRun({ run_number: 7, conclusion: "failure" })]],
  })
  assert.equal(r1.code, 1, r1.out)
  assert.match(r1.out, /'failure'/)
  assert.ok(r1.out.includes("/actions/runs/1007"))
  const r2 = run({
    pages: [[mkRun({ run_number: 7 })], [mkRun({ run_number: 5, conclusion: "failure" })]],
  })
  assert.equal(r2.code, 0, r2.out)
  assert.ok(r2.summary.includes("/actions/runs/1007"))
  assert.ok(r2.log.includes("--paginate"))
})

test("refuses when there is no run", () => {
  const { code, out } = run({ pages: [[], []] })
  assert.equal(code, 1)
  assert.match(out, /No Deploy stage run found/)
  assert.match(out, /Run Deploy stage from main/)
})

test("ignores runs for another commit or branch", () => {
  for (const other of [{ head_sha: "f".repeat(40) }, { head_branch: "feature" }]) {
    const { code, out } = run({ pages: [[mkRun(other)]] })
    assert.equal(code, 1)
    assert.match(out, /No Deploy stage run found/)
  }
})

test("refuses a run that is not finished", () => {
  for (const status of ["queued", "in_progress", "waiting"]) {
    const { code, out } = run({ pages: [[mkRun({ status, conclusion: null })]] })
    assert.equal(code, 1, status)
    assert.match(out, /still/)
  }
})

test("refuses a run that did not succeed", () => {
  for (const conclusion of ["cancelled", "failure", "skipped", "timed_out"]) {
    const { code, out } = run({ pages: [[mkRun({ conclusion })]] })
    assert.equal(code, 1, conclusion)
    assert.ok(out.includes(`'${conclusion}'`))
  }
})

test("requires a single successful upload job", () => {
  assert.equal(run({ jobs: [] }).code, 1)
  assert.equal(run({ jobs: [mkJob({ conclusion: "failure" })] }).code, 1)
  assert.equal(run({ jobs: [mkJob(), mkJob()] }).code, 1)
})

test("explains a skipped upload job (main moved on)", () => {
  const r = run({ jobs: [mkJob({ conclusion: "skipped" })] })
  assert.equal(r.code, 1)
  assert.match(r.out, /did not update stage|moved on/)
})

test("requires the upload step to have run", () => {
  const skipped = run({ jobs: [withStep("skipped")] })
  assert.equal(skipped.code, 1)
  assert.match(skipped.out, /did not update stage/)
  const missing = run({ jobs: [mkJob({ steps: [] })] })
  assert.equal(missing.code, 1)
  assert.match(missing.out, /did not update stage/)
})

test("refuses a SHA that is not a full lowercase commit id without calling gh", () => {
  for (const sha of ["main", SHA.toUpperCase()]) {
    const { code, out, log } = run({ sha })
    assert.equal(code, 1)
    assert.match(out, /40-character/)
    assert.equal(log, "")
  }
})

test("asks the expected endpoints", () => {
  const { code, log } = run()
  assert.equal(code, 0)
  assert.ok(log.includes(`deploy-stage.yml/runs?head_sha=${SHA}&branch=main`))
  assert.ok(!log.includes("event="))
  assert.ok(log.includes("actions/runs/1001/jobs"))
})

test("does not print unsafe values from the API", () => {
  const badId = run({ pages: [[mkRun({ id: "1/../x" })]] })
  assert.equal(badId.code, 1)
  assert.match(badId.out, /unexpected run id/)
  const badConclusion = run({ pages: [[mkRun({ conclusion: "x::warning::y" })]] })
  assert.equal(badConclusion.code, 1)
  assert.ok(badConclusion.out.includes("'unknown'"))
  assert.ok(!badConclusion.out.includes("x::warning::y"))
})

test("passes without a step summary file", () => {
  const { code, out } = run({ summary: false })
  assert.equal(code, 0, out)
})

test("fails when the API call fails", () => {
  assert.notEqual(run({ fail: true }).code, 0)
})
