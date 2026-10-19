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

test("the workflow set is exactly ci, cleanup-deployments, cut-release, delete-merged-branches, deploy-production and deploy-stage", () => {
  assert.deepEqual(files, [
    "ci.yml",
    "cleanup-deployments.yml",
    "cut-release.yml",
    "delete-merged-branches.yml",
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

test("cut-release re-checks the head of main right before creating the tag", () => {
  const steps = wf["cut-release.yml"].jobs.cut.steps
  const tag = steps.findIndex((s) => s.name === "Create the annotated tag")
  assert.ok(tag > 1)
  const require = steps[tag - 1]
  const recheck = steps[tag - 2]
  assert.equal(recheck.id, "fresh-final")
  assert.equal(recheck.run, ".github/scripts/is-branch-head.sh")
  assert.equal(recheck.env.BRANCH, "main")
  assert.equal(require.env.CURRENT, "${{ steps.fresh-final.outputs.current }}")
  assert.ok(require.run.includes("exit 1") && require.run.includes("main moved"))
  assert.ok(!require.run.includes("${{"))
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

test("the attribution check runs in ci and gates CI OK", () => {
  const ci = wf["ci.yml"]
  assert.ok(ci.jobs.attribution)
  assert.ok(ci.jobs["ci-ok"].needs.includes("attribution"))
  assert.deepEqual(ci.jobs.attribution.permissions, {
    contents: "read",
    "pull-requests": "read",
  })
  const step = ci.jobs.attribution.steps.find((s) => s.name === "Require no tooling attribution")
  assert.match(step.run, /gh api "repos\/\$GH_REPO\/pulls\/\$PR_NUMBER"/)
  assert.doesNotMatch(step.run, /GITHUB_EVENT_PATH/)
  const checkout = ci.jobs.attribution.steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout"),
  )
  assert.equal(checkout.with["fetch-depth"], 0)
})

test("cleanup deployments is dispatch only, owner only, deployments: write only and refuses production", () => {
  const w = wf["cleanup-deployments.yml"]
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"])
  assert.deepEqual(w.permissions, {})
  assert.deepEqual(w.jobs.cleanup.permissions, { deployments: "write" })
  const text = raw["cleanup-deployments.yml"]
  const run = w.jobs.cleanup.steps.map((s) => s.run ?? "").join("\n")
  assert.ok(run.includes("refs/heads/main"))
  assert.ok(run.includes('"$ACTOR" != "greenblacked"'))
  assert.ok(run.includes('"$TRIGGERING_ACTOR" != "greenblacked"'))
  assert.ok(text.includes("github.repository == 'greenblacked/Notes'"))
  assert.ok(run.includes("set -euo pipefail"))
  assert.ok(run.includes("^[a-z0-9-]+( [a-z0-9-]+)*$"))
  assert.ok(run.includes("*production*"))
  assert.equal(w.on.workflow_dispatch.inputs.environments.default, "dev staging repo-admin")
  assert.equal(w.on.workflow_dispatch.inputs.include_failed_stage.default, true)
  assert.ok(!/environment=production/.test(text))
  assert.equal(w.jobs.cleanup.environment, undefined)
  assert.ok(w.jobs.cleanup.steps.every((s) => s.uses === undefined))
})
