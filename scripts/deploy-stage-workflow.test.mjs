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
    "steps.preview.outcome != 'skipped'",
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
