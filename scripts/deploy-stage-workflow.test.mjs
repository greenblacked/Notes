import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
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

test("the upload job uses the stage environment", () => {
  assert.equal(upload.environment.name, "stage")
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

test("no Cloudflare Access step or setting is left", () => {
  for (const x of [
    "cloudflare-stage",
    "ensure-access",
    "retire-dev-access",
    "preflight",
    "deployable",
    "STAGE_ACCESS_EMAIL",
    "SMOKE_REQUIRE_ACCESS",
    "SMOKE_ALLOW_ACCESS",
    "access_wd",
    "EXPOSED",
    "@gmail",
  ]) {
    assert.ok(!raw.includes(x), `${x} is gone`)
  }
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
  assert.ok(names.indexOf("Delete the old dev Preview") >= 0)
  assert.ok(names.indexOf("Delete the old dev Preview") < names.indexOf("Update the stage Preview"))
})

test("every step after the freshness re-check is gated on a fresh commit", () => {
  const i = upload.steps.findIndex((s) => s.id === "fresh")
  assert.ok(i >= 0)
  for (const s of upload.steps.slice(i + 1)) {
    if (s.name === "Skip when main moved on") continue
    assert.ok(
      String(s.if ?? "").includes("steps.fresh.outputs.current == 'true'"),
      `step "${s.name}" is gated on a fresh commit`,
    )
  }
  const names = upload.steps.map((s) => s.name)
  for (const n of [
    "Delete the old dev Preview",
    "Update the stage Preview",
    "Read the Preview URLs",
    "Require the custom domain Preview URL",
    "Smoke-test the workers.dev Preview URL",
    "Probe the custom domain",
    "Take stage down unless it is verified",
    "Summary",
  ]) {
    assert.ok(names.includes(n), `${n} exists`)
  }
})

test("the workers.dev smoke test accepts only the Access login, by explicit opt-in", () => {
  const step = upload.steps.find((s) => s.id === "smoke")
  assert.ok(step)
  assert.ok(step.run.includes('scripts/smoke-test.sh "$WORKERS_DEV_URL" "stage+$SHA" noindex'))
  const extra = Object.keys(step.env)
    .filter((k) => k.startsWith("SMOKE_") && k !== "SMOKE_TEST_TOKEN")
    .sort()
  assert.deepEqual(extra, ["SMOKE_ACCEPT_ACCESS", "SMOKE_RESULT_FILE"])
  assert.equal(String(step.env.SMOKE_ACCEPT_ACCESS), "1")
  for (const x of ["verified | access", '"result=$result" >>"$GITHUB_OUTPUT"', "exit 1"]) {
    assert.ok(step.run.includes(x), x)
  }
  assert.equal(step["continue-on-error"], undefined)
})

test("only Deploy stage opts into Access", () => {
  const dir = dirname(file)
  const names = readdirSync(dir).filter((n) => n.endsWith(".yml"))
  assert.ok(names.includes("deploy-stage.yml"))
  for (const n of names) {
    const text = readFileSync(join(dir, n), "utf8")
    if (n !== "deploy-stage.yml") assert.ok(!text.includes("SMOKE_ACCEPT_ACCESS"), n)
  }
  const prod = readFileSync(join(dir, "deploy-production.yml"), "utf8")
  assert.ok(!prod.includes("SMOKE_ACCEPT_ACCESS"))
  assert.ok(!prod.includes("SMOKE_RESULT_FILE"))
})

test("the dev Preview delete is idempotent and fails closed", () => {
  const step = upload.steps.find((s) => s.id === "retire")
  assert.ok(step)
  assert.ok(step.run.includes("preview delete --name dev --skip-confirmation"))
  assert.ok(step.run.includes('The Preview "dev" was not found.'))
  assert.ok(step.run.includes("exit 1"))
  assert.equal(step["continue-on-error"], undefined)
})

test("the custom domain probe fails only on an indexable 200 and reports an unverified run", () => {
  const step = upload.steps.find((s) => s.name === "Probe the custom domain")
  assert.ok(step)
  assert.equal(step.env.SMOKE_RESULT, "${{ steps.smoke.outputs.result }}")
  for (const x of [
    '"403"',
    "noindex",
    "exit 1",
    "cloudflareaccess",
    "::warning::",
    "GITHUB_STEP_SUMMARY",
    '"verified"',
  ])
    assert.ok(step.run.includes(x), x)
  assert.equal((step.run.match(/exit 1/g) ?? []).length, 1)
  assert.equal(step["continue-on-error"], undefined)
})
