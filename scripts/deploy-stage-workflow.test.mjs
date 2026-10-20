import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
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
    "Confirm the uploaded version is active",
    "Probe the custom domain",
    "Decide the stage result",
    "Take stage down after a failed check",
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

test("the custom domain probe fails only on an indexable 200 and reports its code", () => {
  const step = upload.steps.find((s) => s.name === "Probe the custom domain")
  assert.ok(step)
  assert.equal(step.id, "probe")
  assert.equal(step.env.SMOKE_RESULT, "${{ steps.smoke.outputs.result }}")
  for (const x of [
    '"403"',
    "noindex",
    "exit 1",
    "cloudflareaccess",
    "::warning::",
    '"verified"',
    '"code=$code" >>"$GITHUB_OUTPUT"',
  ])
    assert.ok(step.run.includes(x), x)
  assert.ok(!step.run.includes("not verified"))
  assert.ok(!step.run.includes("GITHUB_STEP_SUMMARY"))
  assert.equal((step.run.match(/exit 1/g) ?? []).length, 1)
  assert.equal(step["continue-on-error"], undefined)
})

test("the steps run in the order upload, read, confirm, smoke, probe, decide, teardown, summary", () => {
  const at = (pred) => upload.steps.findIndex(pred)
  const order = [
    at((s) => s.id === "preview"),
    at((s) => s.id === "parse"),
    at((s) => s.id === "active"),
    at((s) => s.id === "smoke"),
    at((s) => s.id === "probe"),
    at((s) => s.id === "level"),
    at((s) => /Take stage down/.test(s.name ?? "")),
    at((s) => s.id === "result"),
  ]
  assert.ok(
    order.every((i) => i >= 0),
    String(order),
  )
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  )
})

test("the active check compares the deployment this run uploaded", () => {
  const step = upload.steps.find((s) => s.id === "active")
  const preview = upload.steps.find((s) => s.id === "preview")
  assert.ok(step && preview)
  assert.equal(step.env.DEPLOYMENT_ID, "${{ steps.parse.outputs.deployment_id }}")
  assert.ok(step.env.CLOUDFLARE_API_TOKEN && step.env.CLOUDFLARE_ACCOUNT_ID)
  for (const x of [
    "node scripts/verify-preview-deployment.mjs",
    "--worker notes --preview stage",
    '--deployment "$DEPLOYMENT_ID"',
    '--tag "$SHA"',
    '--message "stage ${SHA::7}"',
  ]) {
    assert.ok(step.run.includes(x), x)
  }
  // The values the upload sets are the ones the check expects.
  assert.ok(preview.run.includes('--message "stage ${SHA::7}" --tag "$SHA"'))
  assert.equal(step["continue-on-error"], undefined)
})

const bash = (() => {
  const dir = mkdtempSync(join(tmpdir(), "stage-step-"))
  let n = 0
  /** Runs a step's script like GitHub does (`bash -e`) and returns what it wrote. */
  return (step, env, cwd) => {
    const script = join(dir, `step${n}.sh`)
    const out = join(dir, `output${n}`)
    const summary = join(dir, `summary${n}`)
    n++
    writeFileSync(script, step.run)
    writeFileSync(out, "")
    writeFileSync(summary, "")
    const r = spawnSync("/bin/bash", ["-e", script], {
      encoding: "utf8",
      cwd,
      env: {
        PATH: process.env.PATH,
        SHA: "a".repeat(40),
        GITHUB_OUTPUT: out,
        GITHUB_STEP_SUMMARY: summary,
        ...env,
      },
    })
    return {
      status: r.status,
      stdout: r.stdout,
      output: readFileSync(out, "utf8"),
      summary: readFileSync(summary, "utf8"),
    }
  }
})()

test("Decide the stage result maps the API check and the smoke result to a level", () => {
  const step = upload.steps.find((s) => s.id === "level")
  assert.ok(step)
  assert.ok(String(step.if).includes("steps.fresh.outputs.current == 'true'"))
  for (const [active, smoke, status, output] of [
    ["true", "verified", 0, "level=verified\n"],
    ["true", "access", 0, "level=uploaded-active\n"],
    ["true", "", 1, ""],
    ["true", "bogus", 1, ""],
    ["", "verified", 1, ""],
    ["false", "access", 1, ""],
  ]) {
    const r = bash(step, { ACTIVE: active, SMOKE_RESULT: smoke })
    assert.equal(r.status, status, `${active}/${smoke}`)
    assert.equal(r.output, output, `${active}/${smoke}`)
  }
})

test("Summary writes the result line and tells the truth about each level", () => {
  const step = upload.steps.find((s) => s.id === "result")
  assert.ok(step)
  assert.ok(step.if.includes("always()"))
  assert.ok(step.if.includes("steps.fresh.outputs.current == 'true'"))
  assert.equal(step.env.TEARDOWN_OUTCOME, "${{ steps.teardown.outcome }}")
  assert.ok(upload.steps.some((s) => s.id === "teardown" && /Take stage down/.test(s.name ?? "")))
  const base = { DEPLOYMENT_ID: "d1", PROBE_CODE: "403", PREVIEW_OUTCOME: "success" }

  const verified = bash(step, { ...base, LEVEL: "verified" })
  assert.equal(verified.status, 0)
  assert.match(verified.output, /^stage_result=verified$/m)
  assert.ok(verified.summary.includes("stage_result=verified"))
  assert.ok(verified.summary.includes("Checked from CI"))

  const active = bash(step, { ...base, LEVEL: "uploaded-active" })
  assert.equal(active.status, 0)
  assert.match(active.output, /^stage_result=uploaded-active$/m)
  assert.ok(active.summary.includes("not checked from CI"))
  assert.ok(active.summary.includes("version.txt"))
  assert.ok(active.summary.includes(`stage+${"a".repeat(40)}`))
  assert.ok(!/\bverified\b/.test(active.summary))
  assert.ok(!/\bverified\b/.test(active.stdout))

  const failed = bash(step, { ...base, LEVEL: "", PREVIEW_OUTCOME: "failure" })
  assert.equal(failed.status, 0)
  assert.match(failed.output, /^stage_result=failure$/m)
  assert.ok(failed.summary.includes("taken down"))

  // The teardown ran after the level was decided (for example a cancelled run): report failure.
  for (const teardown of ["failure", "success", "cancelled"]) {
    const torn = bash(step, { ...base, LEVEL: "verified", TEARDOWN_OUTCOME: teardown })
    assert.match(torn.output, /^stage_result=failure$/m, teardown)
    assert.ok(torn.summary.includes("taken down"), teardown)
    assert.ok(!/\bverified\b/.test(torn.summary), teardown)
  }
  const kept = bash(step, { ...base, LEVEL: "verified", TEARDOWN_OUTCOME: "skipped" })
  assert.match(kept.output, /^stage_result=verified$/m)

  const early = bash(step, { ...base, LEVEL: "", PREVIEW_OUTCOME: "" })
  assert.match(early.output, /^stage_result=failure$/m)
  assert.ok(early.summary.includes("nothing was uploaded"))
})

test("the upload job exposes stage_result, and a skipped run says skipped", () => {
  assert.equal(
    upload.outputs.stage_result,
    "${{ steps.result.outputs.stage_result || steps.skip.outputs.stage_result || 'failure' }}",
  )
  const skip = upload.steps.find((s) => s.id === "skip")
  assert.ok(skip)
  const r = bash(skip, {})
  assert.equal(r.status, 0)
  assert.equal(r.output, "stage_result=skipped\n")
})

test("the workflow never claims what it did not check", () => {
  for (const x of [
    "stage serves",
    "unless it is verified",
    "not fully verified",
    "verification used workers.dev",
  ]) {
    assert.ok(!raw.includes(x), x)
  }
})

test("the result job reports skipped only when main moved on, and failure otherwise", () => {
  const result = workflow.jobs.result
  assert.ok(result)
  assert.deepEqual(result.needs, ["build", "upload"])
  assert.equal(result.if, "${{ always() && github.repository == 'greenblacked/Notes' }}")
  const expr = result.outputs.stage_result
  assert.equal(
    expr,
    "${{ needs.build.result == 'success' && needs.build.outputs.current != 'true' && 'skipped' || needs.upload.outputs.stage_result || 'failure' }}",
  )
  assert.equal(result.steps[0].env.STAGE_RESULT, expr)
  // The result step always reports the final value: notice and summary line, env only.
  const run = result.steps[0].run
  assert.ok(run.includes('echo "::notice title=Stage result::$level"'))
  assert.ok(run.includes('echo "stage_result=$level"'))
  assert.ok(run.includes('>>"$GITHUB_STEP_SUMMARY"'))
  assert.ok(!run.includes("${{"))
  // Evaluate the expression the way Actions does (empty string is falsy).
  const evaluate = (buildResult, current, output) =>
    (buildResult === "success" && current !== "true" && "skipped") || output || "failure"
  assert.equal(evaluate("failure", "", ""), "failure")
  assert.equal(evaluate("cancelled", "", ""), "failure")
  assert.equal(evaluate("success", "false", ""), "skipped")
  assert.equal(evaluate("success", "true", ""), "failure")
  assert.equal(evaluate("success", "true", "verified"), "verified")
  assert.equal(evaluate("success", "true", "failure"), "failure")
  assert.equal(evaluate("success", "true", "uploaded-active"), "uploaded-active")
  assert.equal(JSON.stringify(result).includes("secrets."), false)
})

test("the active step passes the checker's status through and has no previous or superseded path", () => {
  const active = upload.steps.find((s) => s.id === "active")
  assert.equal(active["continue-on-error"], undefined)
  assert.ok(!active.run.includes("${{"))
  assert.equal(active.env.PREVIOUS_ID, undefined)
  assert.ok(!active.run.includes("--previous"))
  const fake = (code, lines) => {
    const dir = mkdtempSync(join(tmpdir(), "stage-node-"))
    writeFileSync(join(dir, "node"), `#!/bin/bash\nprintf '%s\\n' ${lines}\nexit ${code}\n`, {
      mode: 0o755,
    })
    return dir
  }
  const run = (code, lines) => {
    const dir = fake(code, lines)
    return bash(active, {
      DEPLOYMENT_ID: "d1",
      SHA: "a".repeat(40),
      PATH: `${dir}:${process.env.PATH}`,
    })
  }
  const failed = run(2, "'x'")
  assert.equal(failed.status, 2)
  assert.doesNotMatch(failed.stdout, /left in place/)
  const plain = run(1, "'x'")
  assert.equal(plain.status, 1)
  const ok = run(0, "'active=true' 'active_deployment_id=d1'")
  assert.equal(ok.status, 0)
  assert.match(ok.output, /^active=true$/m)
})

test("the teardown always deletes after an attempted upload, with no superseded or left-in-place path", () => {
  const step = upload.steps.find((s) => s.id === "teardown")
  assert.ok(step)
  assert.ok(!step.if.includes("superseded"))
  assert.equal(step.env.PREVIOUS_ID, undefined)
  assert.equal(step.env.DEPLOYMENT_ID, undefined)
  assert.ok(step.env.CLOUDFLARE_API_TOKEN && step.env.CLOUDFLARE_ACCOUNT_ID)
  assert.ok(!step.run.includes("${{"))
  assert.ok(!step.run.includes("--read-latest"))
  assert.ok(!step.run.includes("left_in_place"))
  assert.ok(step.run.includes("preview delete --name stage --skip-confirmation"))
  assert.ok(!upload.steps.some((s) => s.id === "before"))
  assert.ok(!upload.steps.some((s) => (s.run ?? "").includes("--read-previous")))
  // The token is scoped to the steps that need it.
  assert.equal(workflow.env?.CLOUDFLARE_API_TOKEN, undefined)
  assert.equal(upload.env?.CLOUDFLARE_API_TOKEN, undefined)

  const run = (deleteOk, listText) => {
    const dir = mkdtempSync(join(tmpdir(), "stage-teardown-"))
    const log = join(dir, "calls.log")
    mkdirSync(join(dir, "tools/node_modules/.bin"), { recursive: true })
    writeFileSync(
      join(dir, "tools/node_modules/.bin/wrangler"),
      `#!/bin/bash
echo "wrangler $*" >>'${log}'
if [[ "$2" == "delete" ]]; then
  ${deleteOk ? "echo deleted" : "echo delete-failed; exit 1"}
else
  echo '${listText}'
fi
`,
      { mode: 0o755 },
    )
    const r = bash(step, {}, dir)
    let calls = ""
    try {
      calls = readFileSync(log, "utf8")
    } catch {}
    return { ...r, deleted: /preview delete --name stage/.test(calls) }
  }

  const ok = run(true, "")
  assert.equal(ok.deleted, true)
  assert.equal(ok.status, 1)
  assert.match(ok.stdout, /::notice::Deleted the stage Preview/)
  assert.doesNotMatch(ok.output, /left_in_place/)

  const gone = run(false, 'The Preview "stage" was not found.')
  assert.equal(gone.status, 1)
  assert.match(gone.stdout, /nothing to delete/)

  const broken = run(false, "boom")
  assert.equal(broken.status, 1)
  assert.match(broken.stdout, /::error::Deleting the stage Preview failed/)

  // Summary: a failed check after the upload always says the Preview was taken down.
  const result = upload.steps.find((s) => s.id === "result")
  assert.equal(result.env.SUPERSEDED, undefined)
  assert.equal(result.env.LEFT_IN_PLACE, undefined)
  const r = bash(result, {
    LEVEL: "",
    DEPLOYMENT_ID: "d1",
    PREVIEW_OUTCOME: "success",
    TEARDOWN_OUTCOME: "success",
  })
  assert.match(r.output, /^stage_result=failure$/m)
  assert.ok(r.summary.includes("taken down"))
  assert.ok(!r.summary.includes("left in place"))
  assert.ok(!r.summary.includes("Superseded"))
})
