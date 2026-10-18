import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
  "deploy-stage.yml",
)
const workflow = parse(readFileSync(file, "utf8"))
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])

test("the teardown step fails closed after an attempted upload", () => {
  const step = steps.find((s) => /Take stage down/.test(s.name ?? ""))
  assert.ok(step, "teardown step exists")
  for (const needle of [
    "always()",
    "failure()",
    "cancelled()",
    'contains(fromJSON(\'["success","failure","cancelled"]\'), steps.preview.outcome)',
  ]) {
    assert.ok(step.if.includes(needle), `teardown if contains ${needle}`)
  }
  assert.ok(
    !step.if.includes("outcome == 'success'"),
    "teardown does not require a successful upload",
  )
})

test("the upload step does not parse output, so parsing cannot hide an upload", () => {
  const step = steps.find((s) => s.id === "preview")
  assert.ok(step && !/read-wrangler-output/.test(step.run))
  assert.ok(steps.some((s) => s.id === "parse" && /read-wrangler-output/.test(s.run)))
})

test("no run block interpolates ${{ }} expressions", () => {
  for (const s of steps) {
    if (s.run) assert.ok(!s.run.includes("${{"), `step "${s.name}" interpolates in run`)
  }
})

const raw = readFileSync(file, "utf8")
const upload = workflow.jobs.upload

test("it runs on pushes to main and on dispatch from main, with no inputs", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["push", "workflow_dispatch"])
  assert.deepEqual(workflow.on.push.branches, ["main"])
  const dispatch = workflow.on.workflow_dispatch
  assert.ok(!dispatch || !dispatch.inputs, "dispatch has no inputs")
})

test("the guard accepts main only", () => {
  const run = workflow.jobs.guard.steps.map((s) => s.run ?? "").join("\n")
  assert.ok(run.includes("refs/heads/main"))
  assert.ok(!run.includes("refs/heads/dev"))
})

test("the upload job uses the staging environment", () => {
  assert.equal(upload.environment.name, "staging")
})

test("every freshness check targets main", () => {
  const withBranch = steps.filter((s) => s.env && s.env.BRANCH !== undefined)
  assert.ok(withBranch.length >= 2)
  for (const s of withBranch) assert.equal(s.env.BRANCH, "main")
})

test("the one-time retire switch is gone", () => {
  assert.ok(!raw.includes("RETIRE_DEV"))
  assert.ok(!raw.includes("retire_dev"))
})

test("ensure-access runs before the preflight, unconditionally on a fresh commit", () => {
  const names = upload.steps.map((s) => s.name ?? "")
  const ensure = names.findIndex((n) => /Ensure Cloudflare Access/.test(n))
  const preflight = names.findIndex((n) => /Require Cloudflare Access and a clean hostname/.test(n))
  assert.ok(ensure >= 0 && preflight > ensure)
  assert.ok(!/inputs\.|env\./.test(upload.steps[ensure].if))
})

test("only the upload job references secrets", () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(JSON.stringify(job).includes("secrets."), name === "upload", name)
  }
})

test("the teardown comes after every step that holds secrets", () => {
  const names = upload.steps.map((s) => s.name ?? "")
  const teardown = names.findIndex((n) => /Take stage down/.test(n))
  assert.ok(teardown >= 0)
  upload.steps.forEach((step, i) => {
    if (i !== teardown && JSON.stringify(step).includes("secrets.")) {
      assert.ok(i < teardown, `${step.name} runs before the teardown`)
    }
  })
  for (const n of ["Retire the dev Preview", "Retire the dev Access app"]) {
    const i = names.indexOf(n)
    assert.ok(i >= 0 && i < teardown, `${n} runs before the teardown`)
  }
})
