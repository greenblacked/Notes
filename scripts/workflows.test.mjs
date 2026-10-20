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

// The environment no longer scopes secrets on a private Free repository; kept so that jobs
// holding secrets stay the deploy jobs (deployment records, environment URL, cleanup).
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

test("cut-release requires a green Deploy stage run after CI and before the notes", () => {
  const cut = wf["cut-release.yml"].jobs.cut
  const steps = cut.steps
  const ci = steps.findIndex((s) => s.name === "Require a successful CI run for this commit")
  const stage = steps.findIndex((s) => s.run === ".github/scripts/require-stage-success.sh")
  const notes = steps.findIndex((s) => s.name === "Write the release notes from CHANGELOG.md")
  assert.ok(ci >= 0 && stage > ci && notes > stage)
  for (const key of ["if", "continue-on-error", "env", "with"]) {
    assert.equal(steps[stage][key], undefined, key)
  }
  assert.equal(cut.env.GH_TOKEN, "${{ github.token }}")
  assert.equal(cut.env.SHA, "${{ github.sha }}")
  assert.equal(cut.permissions.actions, "write")
})

test("the stage gate names match deploy-stage.yml", () => {
  const w = wf["deploy-stage.yml"]
  assert.equal(w.name, "Deploy stage")
  assert.equal(w.jobs.upload.name, "Update stage Preview")
  const preview = w.jobs.upload.steps.filter((s) => s.name === "Update the stage Preview")
  assert.equal(preview.length, 1)
  assert.equal(preview[0].id, "preview")
  const script = readFileSync(join(root, ".github", "scripts", "require-stage-success.sh"), "utf8")
  for (const part of [
    'workflow="deploy-stage.yml"',
    "actions/workflows/$workflow/runs",
    'job_name="Update stage Preview"',
    'step_name="Update the stage Preview"',
    "set -euo pipefail",
  ]) {
    assert.ok(script.includes(part), part)
  }
  assert.ok(!script.includes("event="))
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

test("the browser smoke tests run in ci and gate CI OK", () => {
  const ci = wf["ci.yml"]
  const job = ci.jobs.browser
  assert.ok(job)
  assert.deepEqual([job.needs].flat(), ["build-and-check"])
  assert.deepEqual(job.permissions, { contents: "read" })
  assert.ok(ci.jobs["ci-ok"].needs.includes("browser"))
  const runs = job.steps.map((s) => s.run ?? "")
  assert.ok(runs.some((r) => r.includes("npm run test:browser")))
  assert.ok(runs.some((r) => r.includes("node scripts/check-artifact.mjs --root")))
  const report = job.steps.find((s) => (s.uses ?? "").startsWith("actions/upload-artifact"))
  assert.equal(report.if, "failure()")
})

test("playwright is never fetched by npx", () => {
  for (const f of files) {
    for (const job of Object.values(wf[f].jobs)) {
      for (const s of job.steps ?? []) {
        assert.doesNotMatch(
          s.run ?? "",
          /\bnpx\s+(?!--no-install\b)\S*playwright/,
          `${f}: "${s.name}"`,
        )
      }
    }
  }
  const install = wf["ci.yml"].jobs.browser.steps.find((s) => s.name === "Install browsers")
  assert.match(install.run, /^\.\/node_modules\/\.bin\/playwright install /)
})

test("the CI build hands its output to the browser job", () => {
  const upload = wf["ci.yml"].jobs["build-and-check"].steps.find((s) =>
    (s.uses ?? "").startsWith("actions/upload-artifact@"),
  )
  assert.ok(upload)
  assert.equal(upload.with.name, "ci-site")
  assert.equal(upload.with["retention-days"], 1)
  assert.equal(upload.with["if-no-files-found"], "error")
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

test("scripts run in the deploy jobs import only Node built-ins", () => {
  const jobs = [
    ["deploy-stage.yml", "upload"],
    ["deploy-production.yml", "deploy"],
  ]
  const used = new Set()
  for (const [f, job] of jobs) {
    for (const s of wf[f].jobs[job].steps ?? []) {
      for (const m of (s.run ?? "").matchAll(/node scripts\/([\w.-]+\.mjs)/g)) used.add(m[1])
    }
  }
  for (const name of ["verify-preview-deployment.mjs", "read-wrangler-output.mjs"]) {
    assert.ok(used.has(name), `${name} is run in a deploy job`)
  }
  for (const name of used) {
    const source = readFileSync(join(root, "scripts", name), "utf8")
    const specs = [
      ...source.matchAll(/^\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']/gm),
      ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
      ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1])
    for (const spec of specs) assert.ok(spec.startsWith("node:"), `${name} imports ${spec}`)
  }
})

test("Cloudflare credentials come from the repository secret and variable", () => {
  let tokens = 0
  let accounts = 0
  for (const f of files) {
    assert.ok(!raw[f].includes("secrets.CLOUDFLARE_ACCOUNT_ID"), `${f} reads an account id secret`)
    for (const job of Object.values(wf[f].jobs)) {
      for (const env of [job.env, ...(job.steps ?? []).map((s) => s.env)]) {
        if (env?.CLOUDFLARE_ACCOUNT_ID !== undefined) {
          accounts++
          assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "${{ vars.CLOUDFLARE_ACCOUNT_ID }}", f)
        }
        if (env?.CLOUDFLARE_API_TOKEN !== undefined) {
          tokens++
          assert.equal(env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}", f)
        }
      }
    }
  }
  assert.ok(tokens > 0 && accounts > 0)
})
