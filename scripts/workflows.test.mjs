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

test("the attribution check runs in the workflow lint job and gates CI OK", () => {
  const ci = wf["ci.yml"]
  const job = ci.jobs["workflow-lint"]
  assert.equal(ci.jobs.attribution, undefined)
  assert.deepEqual(ci.jobs["ci-ok"].needs, ["build-and-check", "browser", "workflow-lint"])
  assert.deepEqual(job.permissions, { contents: "read", "pull-requests": "read" })
  assert.equal(job.name, "Lint workflows and check attribution")
  const idx = (name) => job.steps.findIndex((s) => s.name === name)
  const attribution = idx("Require no tooling attribution")
  const step = job.steps[attribution]
  assert.match(step.run, /gh api "repos\/\$GH_REPO\/pulls\/\$PR_NUMBER"/)
  assert.doesNotMatch(step.run, /GITHUB_EVENT_PATH/)
  for (const key of [
    "EVENT_NAME",
    "PR_NUMBER",
    "PR_BASE",
    "PR_HEAD",
    "PUSH_BEFORE",
    "PUSH_AFTER",
    "GH_TOKEN",
    "GH_REPO",
  ]) {
    assert.ok(step.env[key], key)
  }
  assert.equal(job.env.PR_NUMBER, undefined)
  assert.equal(job.env.GH_TOKEN, undefined)
  assert.ok(attribution >= 0 && attribution < idx("Install actionlint"))
  assert.ok(attribution < idx("Install zizmor"))
  const checkout = job.steps.find((s) => (s.uses ?? "").startsWith("actions/checkout"))
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

test("the production guard requires the owner or an owner's Cut release", () => {
  const w = wf["deploy-production.yml"]
  const steps = w.jobs.guard.steps
  const actor = steps.findIndex((s) => s.run === ".github/scripts/require-release-actor.sh")
  const tag = steps.findIndex((s) => (s.run ?? "").includes("refs/tags/"))
  const ci = steps.findIndex((s) => s.run === ".github/scripts/require-ci-success.sh")
  assert.ok(tag >= 0 && actor > tag && ci > actor)
  assert.equal(steps[actor].env.ACTOR, "${{ github.actor }}")
  assert.equal(steps[actor].env.TRIGGERING_ACTOR, "${{ github.triggering_actor }}")
  assert.equal(steps[actor].if, undefined)
  assert.equal(steps[actor]["continue-on-error"], undefined)
  assert.ok([w.jobs.deploy.needs].flat().includes("guard"))
  assert.deepEqual(w.jobs.guard.permissions, { contents: "read", actions: "read" })
})

test("the browser job caches Playwright browsers keyed on the Playwright version", () => {
  const steps = wf["ci.yml"].jobs.browser.steps
  const at = (pred) => steps.findIndex(pred)
  const cache = at((s) => (s.uses ?? "").startsWith("actions/cache@"))
  const version = at((s) => s.id === "playwright")
  const install = at((s) => s.name === "Install browsers")
  const deps = at((s) => s.name === "Install browser system dependencies")
  const deps_ = at((s) => s.name === "Install dependencies")
  assert.ok(cache >= 0 && version >= 0 && install >= 0 && deps >= 0)
  assert.ok(deps_ < version && version < cache && cache < install && cache < deps)
  assert.equal(steps[cache].id, "pw-cache")
  assert.equal(steps[cache].with.path, "~/.cache/ms-playwright")
  assert.equal(
    steps[cache].with.key,
    "playwright-${{ runner.os }}-${{ steps.playwright.outputs.version }}-chromium-webkit",
  )
  assert.equal(steps[cache].with["restore-keys"], undefined)
  assert.ok(steps[version].run.includes("node_modules/playwright-core/package.json"))
  assert.equal(steps[install].if, "steps.pw-cache.outputs.cache-hit != 'true'")
  assert.match(steps[install].run, /install --with-deps chromium webkit$/)
  assert.equal(steps[deps].if, "steps.pw-cache.outputs.cache-hit == 'true'")
  assert.match(steps[deps].run, /^\.\/node_modules\/\.bin\/playwright install-deps chromium webkit/)
})

test("dependabot version updates run monthly", () => {
  const d = parse(readFileSync(join(root, ".github", "dependabot.yml"), "utf8"))
  assert.ok(d.updates.length > 0)
  for (const u of d.updates) {
    assert.equal(u.schedule.interval, "monthly", u.directory)
    assert.equal(u.schedule.day, undefined, u.directory)
  }
})

test("the deploy probes name the site, not the private repository, in the user agent", () => {
  for (const f of ["deploy-stage.yml", "deploy-production.yml"]) {
    assert.ok(raw[f].includes("notes-smoke-test/1 (+https://notes.szolotov.com)"), f)
    assert.ok(!raw[f].includes("github.com/greenblacked"), f)
  }
})

// Guard for the CI redesign: restructuring jobs must never drop, weaken, skip or defer a check.
const ciSteps = Object.entries(wf["ci.yml"].jobs).flatMap(([job, j]) =>
  (j.steps ?? []).map((step, index) => ({ job, index, step })),
)

test("every CI check still runs in ci.yml, unconditionally and without continue-on-error", () => {
  const required = [
    /\bnpm run check(\s|$)/,
    /\bnpm run check:browser(\s|$)/,
    /\bnpm run check:notes(\s|$)/,
    /\bnpm run build(\s|$)/,
    /\bnpm run check:links(\s|$)/,
    /check-artifact\.mjs --public public/,
    /\bnpm run test:scripts(\s|$)/,
    /\bnpm run format:check(\s|$)/,
    /\bnpm run check:contrast(\s|$)/,
    /\bnpm run deploy:dry-run(\s|$)/,
    /check-artifact\.mjs --root/,
    /build-csp\.mjs/,
    /\bnpm run test:browser(\s|$)/,
    /check-attribution\.mjs/,
    /actionlint\/actionlint/,
    /shellcheck scripts\/smoke-test\.sh \.github\/scripts\/\*\.sh/,
    /zizmor" --format=github \.github/,
  ]
  for (const re of required) {
    const hits = ciSteps.filter(({ step }) => re.test(step.run ?? ""))
    assert.ok(hits.length > 0, `${re} runs in ci.yml`)
    for (const { job, step } of hits) {
      assert.equal(step["continue-on-error"], undefined, `${re}: ${job}/${step.name}`)
      if (/format:check/.test(step.run)) {
        assert.ok([undefined, "matrix.format"].includes(step.if), `${job}/${step.name}`)
      } else {
        assert.equal(step.if, undefined, `${re}: ${job}/${step.name}`)
      }
      assert.equal(wf["ci.yml"].jobs[job]["continue-on-error"], undefined, job)
    }
  }
})

test("test:scripts, contrast and the deploy dry run stay in the build job after the build", () => {
  const steps = wf["ci.yml"].jobs["build-and-check"].steps
  const at = (re) => steps.findIndex((s) => re.test(s.run ?? ""))
  const build = at(/\bnpm run build(\s|$)/)
  assert.ok(build >= 0)
  for (const re of [
    /\bnpm run test:scripts(\s|$)/,
    /\bnpm run check:contrast(\s|$)/,
    /\bnpm run deploy:dry-run(\s|$)/,
  ]) {
    assert.ok(at(re) > build, `${re} runs after the build, in the build job`)
  }
})

test("ci triggers have no path or branch filters that could skip a check", () => {
  for (const trigger of Object.values(wf["ci.yml"].on)) {
    for (const key of ["paths", "paths-ignore", "branches-ignore", "tags", "tags-ignore"]) {
      assert.equal(trigger[key], undefined, key)
    }
  }
})

test("CI OK waits for every other job and always runs", () => {
  const jobs = wf["ci.yml"].jobs
  assert.equal(jobs["ci-ok"].if, "always()")
  assert.deepEqual(
    [...jobs["ci-ok"].needs].sort(),
    Object.keys(jobs)
      .filter((id) => id !== "ci-ok")
      .sort(),
  )
})
