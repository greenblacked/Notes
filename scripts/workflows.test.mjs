import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, ".github", "workflows")
const files = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
const raw = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]))
const wf = Object.fromEntries(files.map((f) => [f, parse(raw[f])]))

test("the workflow set is exactly ci, cut-release, deploy-production and deploy-stage", () => {
  assert.deepEqual(files, [
    "ci.yml",
    "cut-release.yml",
    "deploy-production.yml",
    "deploy-stage.yml",
  ])
})

test("every workflow drops all token permissions and every job declares its own", () => {
  for (const f of files) {
    assert.deepEqual(wf[f].permissions, {}, `${f} top-level permissions`)
    for (const [name, job] of Object.entries(wf[f].jobs)) {
      assert.ok(job.permissions !== undefined, `${f} job ${name} declares permissions`)
    }
  }
})

test("every remote action is pinned to a full commit SHA", () => {
  for (const f of files) {
    for (const m of raw[f].matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)) {
      if (m[1].startsWith("./")) continue
      assert.match(`${m[1]}${m[2]}`, /@[0-9a-f]{40}( |$)/, `${f}: ${m[1]}`)
    }
  }
})

test("no run block interpolates expressions", () => {
  for (const f of files) {
    for (const job of Object.values(wf[f].jobs)) {
      for (const s of job.steps ?? []) {
        if (s.run) assert.ok(!s.run.includes("${{"), `${f}: step "${s.name}"`)
      }
    }
  }
})

test("no dangerous triggers", () => {
  for (const f of files) {
    const triggers = Object.keys(wf[f].on)
    assert.ok(!triggers.includes("pull_request_target"), f)
    assert.ok(!triggers.includes("workflow_run"), f)
  }
})

test("every job that references secrets has an environment", () => {
  for (const f of files) {
    for (const [name, job] of Object.entries(wf[f].jobs)) {
      if (JSON.stringify(job).includes("secrets.")) {
        assert.ok(job.environment, `${f} job ${name} uses secrets without an environment`)
      }
    }
  }
})

test("production starts only by dispatch on a tag", () => {
  const w = wf["deploy-production.yml"]
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"])
  assert.ok(!w.on.workflow_dispatch?.inputs)
  assert.ok(!raw["deploy-production.yml"].includes("inputs."))
  assert.equal(w.jobs.deploy.environment.name, "production")
  const guard = w.jobs.guard.steps.map((s) => s.run ?? "").join("\n")
  assert.ok(guard.includes("refs/tags/"))
})

test("cut-release is owner-only from main and dispatches the tag", () => {
  const w = wf["cut-release.yml"]
  assert.equal(w.on.workflow_dispatch.inputs.version.required, true)
  assert.deepEqual(w.jobs.cut.permissions, { contents: "write", actions: "write" })
  const first = w.jobs.cut.steps[0].run
  assert.ok(first.includes("refs/heads/main") && first.includes("exit 1"))
  assert.ok(
    w.jobs.cut.steps.some((s) =>
      (s.run ?? "").includes("gh workflow run deploy-production.yml --ref"),
    ),
  )
  assert.equal(w.concurrency["cancel-in-progress"], false)
})

test("ci runs for main only", () => {
  const on = wf["ci.yml"].on
  assert.deepEqual(on.pull_request.branches, ["main"])
  assert.deepEqual(on.push.branches, ["main"])
})

test("dependabot targets the default branch", () => {
  const d = parse(readFileSync(join(root, ".github", "dependabot.yml"), "utf8"))
  for (const u of d.updates) assert.equal(u["target-branch"], undefined)
})
