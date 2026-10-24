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

test("the workflow set is exactly ci, cleanup-deployments, cut-release, delete-merged-branches, deploy-production, deploy-stage and text-release", () => {
  assert.deepEqual(files, [
    "ci.yml",
    "cleanup-deployments.yml",
    "cut-release.yml",
    "delete-merged-branches.yml",
    "deploy-production.yml",
    "deploy-stage.yml",
    "text-release.yml",
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

test("a text/ pull request may change only notes: the check runs early in the workflow lint job, from the base commit", () => {
  const job = wf["ci.yml"].jobs["workflow-lint"]
  const idx = (name) => job.steps.findIndex((s) => s.name === name)
  const step = job.steps[idx("Require only content changes on a text/ branch")]
  assert.ok(step)
  // Before any step that runs the pull request's own code.
  assert.ok(idx(step.name) > idx("Check out"))
  assert.ok(idx(step.name) < idx("Set up Node.js"))
  assert.ok(idx(step.name) < idx("Require no tooling attribution"))
  assert.ok(idx(step.name) < idx("Install actionlint"))
  assert.match(step.run, /git cat-file -e "\$PR_BASE\^\{commit\}"/)
  assert.match(
    step.run,
    /git archive --format=tar "\$PR_BASE" \.github\/scripts \| tar -x -f - -C "\$trusted"/,
  )
  assert.match(step.run, /"\$trusted\/\.github\/scripts\/require-text-paths\.sh"/)
  assert.ok(step.run.indexOf("text/*") < step.run.indexOf("git archive"))
  // Never the pull request's own copy of a gate script.
  assert.ok(!/(?<![\w/$])\.?\/?\.github\/scripts\/[\w.-]+\.sh/.test(step.run), step.run)
  const lintCheckout = job.steps.find((s) => (s.uses ?? "").startsWith("actions/checkout"))
  assert.equal(lintCheckout.with["fetch-depth"], 0)
  assert.deepEqual(step.env, {
    EVENT_NAME: "${{ github.event_name }}",
    HEAD_REF: "${{ github.head_ref }}",
    PR_BASE: "${{ github.event.pull_request.base.sha }}",
    PR_HEAD: "${{ github.event.pull_request.head.sha }}",
    GIT_NO_REPLACE_OBJECTS: "1",
  })
  assert.equal(step.if, undefined)
  assert.equal(step["continue-on-error"], undefined)
  assert.deepEqual(wf["ci.yml"].jobs["ci-ok"].needs, [
    "build-and-check",
    "browser",
    "workflow-lint",
  ])
})

test("the browser smoke tests run in ci and gate CI OK", () => {
  const ci = wf["ci.yml"]
  const job = ci.jobs.browser
  assert.ok(job)
  assert.equal(job.needs, undefined)
  assert.deepEqual(job.permissions, { contents: "read", actions: "read" })
  assert.ok(ci.jobs["ci-ok"].needs.includes("browser"))
  const runs = job.steps.map((s) => s.run ?? "")
  assert.ok(runs.some((r) => r.includes("npm run test:browser")))
  assert.ok(runs.some((r) => r.includes("node scripts/check-artifact.mjs --root")))
  const report = job.steps.find((s) => (s.uses ?? "").startsWith("actions/upload-artifact"))
  assert.equal(report.if, "failure()")
})

test("browser shards start with the build job, wait for it in a step and use only its output", () => {
  const ci = wf["ci.yml"]
  const job = ci.jobs.browser
  const steps = job.steps
  const idx = (f) => steps.findIndex(f)
  assert.equal(job.needs, undefined)
  assert.equal(job.permissions.actions, "read")
  const wait = idx((s) => s.name === "Wait for the build job")
  assert.ok(wait >= 0)
  assert.equal(steps[wait].run.trim(), "node .github/scripts/wait-for-build-job.mjs")
  assert.deepEqual(steps[wait].env, { GH_TOKEN: "${{ github.token }}" })
  assert.ok(!steps.some((s) => (s.run ?? "").includes("gh api")))
  const setup = idx((s) => (s.uses ?? "").startsWith("actions/setup-node@"))
  const install = idx((s) => s.name === "Install build output")
  const download = idx((s) => (s.uses ?? "").startsWith("actions/download-artifact@"))
  const tests = idx((s) => (s.run ?? "").includes("npm run test:browser"))
  assert.ok(setup >= 0 && setup < wait && wait < download && download < install && install < tests)
  for (const s of steps.slice(0, wait)) {
    assert.doesNotMatch(s.run ?? "", /public\/|\$RUNNER_TEMP\/site/, s.name)
  }
  // The wait gives up after 1500 s; the job limit covers it plus setup, and the test step has
  // its own shorter limit (a build that long means the tests rarely use theirs).
  const testStep = steps[tests]
  assert.equal(testStep["timeout-minutes"], 15)
  assert.equal(job["timeout-minutes"], 35)
  assert.ok(job["timeout-minutes"] * 60 > 1500 + 300)
  assert.ok(testStep["timeout-minutes"] < job["timeout-minutes"])
  assert.ok(ci.jobs["build-and-check"]["timeout-minutes"] !== undefined)
  assert.equal(steps[download].with.name, "ci-site")
})

test("the wait script is committed, used only by the browser job", () => {
  const src = readFileSync(join(root, ".github", "scripts", "wait-for-build-job.mjs"), "utf8")
  assert.match(src, /GITHUB_RUN_ID/)
  assert.match(src, /Build and check/)
  assert.equal(wf["ci.yml"].jobs["build-and-check"].name, "Build and check")
  for (const [name, j] of Object.entries(wf["ci.yml"].jobs)) {
    const uses = (j.steps ?? []).some((s) => (s.run ?? "").includes("wait-for-build-job.mjs"))
    assert.equal(uses, name === "browser", name)
  }
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
  for (const job of Object.values(wf["ci.yml"].jobs)) {
    for (const s of job.steps ?? []) {
      assert.doesNotMatch(s.run ?? "", /playwright\s+install(-deps)?\b/, s.name)
    }
  }
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

test("Cloudflare credentials come from the repository secret and a variable or secret account id", () => {
  let tokens = 0
  let accounts = 0
  for (const f of files) {
    for (const job of Object.values(wf[f].jobs)) {
      for (const env of [job.env, ...(job.steps ?? []).map((s) => s.env)]) {
        if (env?.CLOUDFLARE_ACCOUNT_ID !== undefined) {
          accounts++
          assert.equal(
            env.CLOUDFLARE_ACCOUNT_ID,
            "${{ vars.CLOUDFLARE_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID }}",
            f,
          )
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

test("Deploy stage fails on missing Cloudflare credentials before anything is uploaded", () => {
  const steps = wf["deploy-stage.yml"].jobs.upload.steps
  const names = steps.map((s) => s.name)
  const check = names.indexOf("Require Cloudflare credentials")
  assert.ok(check >= 0, "the credential check step exists")
  assert.ok(
    check < names.indexOf("Delete the old dev Preview"),
    "it runs before the old Preview is deleted",
  )
  assert.ok(check < names.indexOf("Update the stage Preview"), "it runs before the upload")
  const step = steps[check]
  assert.equal(step.env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}")
  assert.equal(
    step.env.CLOUDFLARE_ACCOUNT_ID,
    "${{ vars.CLOUDFLARE_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID }}",
  )
  assert.match(step.run, /-z "\$CLOUDFLARE_API_TOKEN"/)
  assert.match(step.run, /-z "\$CLOUDFLARE_ACCOUNT_ID"/)
  assert.match(step.run, /exit 1/)
})

test("the production guard requires the owner, an owner's Cut release or an owner's text/ merge release", () => {
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
  assert.equal(steps[actor].env.TAG, "${{ github.ref_name }}")
  assert.equal(
    steps[actor].name,
    "Require the owner, a Cut release by the owner, or an owner's text/ merge release",
  )
  assert.deepEqual(w.jobs.guard.permissions, {
    contents: "read",
    actions: "read",
    "pull-requests": "read",
  })
})

test("the browser job runs in the official Playwright image, pinned by digest to the locked Playwright version", () => {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
  const v = lock.packages["node_modules/playwright-core"].version
  assert.equal(lock.packages["node_modules/@playwright/test"].version, v)
  const job = wf["ci.yml"].jobs.browser
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  assert.match(
    job.container.image,
    new RegExp(`^mcr\\.microsoft\\.com\\/playwright:v${esc}-noble@sha256:[0-9a-f]{64}$`),
  )
  assert.ok(job.container.options.includes("--ipc=host"))
  assert.ok(job.container.options.includes("--init"))
  assert.equal(job.container.credentials, undefined)
  assert.doesNotMatch(JSON.stringify(job.container.env ?? {}), /\$\{\{ secrets/)
  for (const s of job.steps) {
    assert.ok(!(s.uses ?? "").startsWith("actions/cache@"), s.name)
    assert.ok(s.id !== "pw-cache" && s.id !== "playwright", s.name)
    assert.doesNotMatch(s.run ?? "", /\bapt(-get)?\b|install-deps|--with-deps/, s.name)
  }
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
    /require-text-paths\.sh/,
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

// The browser suite is split over a (project, shard) matrix so that wall-clock time is the
// slowest shard, not the sum of four projects.
const browserJob = wf["ci.yml"].jobs.browser
const matrixEntries = browserJob.strategy?.matrix?.include ?? []
const configProjects = [
  ...readFileSync(join(root, "playwright.config.ts"), "utf8").matchAll(
    /name:\s*"([^"]+)",\s*use:\s*\{\s*browserName:\s*"(\w+)"/g,
  ),
].map((m) => ({ project: m[1], browser: m[2] }))

test("the browser matrix covers every Playwright project and browser", () => {
  assert.equal(configProjects.length, 4)
  const seen = new Set(matrixEntries.map((e) => `${e.project}/${e.browser}`))
  assert.deepEqual([...seen].sort(), configProjects.map((p) => `${p.project}/${p.browser}`).sort())
})

test("each project's shards are exactly 1/N to N/N and the ids are unique", () => {
  const ids = matrixEntries.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const { project } of configProjects) {
    const mine = matrixEntries.filter((e) => e.project === project)
    // WebKit shards run slower (measured 2026-10-23), so WebKit gets more shards than Chromium.
    const total = Number(mine[0].shard.split("/")[1])
    assert.equal(total, project.startsWith("webkit-") ? 3 : 2, project)
    assert.deepEqual(
      mine.map((e) => e.shard).sort(),
      Array.from({ length: total }, (_, k) => `${k + 1}/${total}`),
    )
    for (const e of mine) assert.equal(e.id, `${project}-${e.shard.split("/")[0]}`)
  }
})

test("the browser matrix is exactly ten shards: three per WebKit project, two per Chromium project", () => {
  assert.equal(matrixEntries.length, 10)
  assert.deepEqual(
    matrixEntries.map((e) => `${e.id} ${e.shard}`),
    [
      "chromium-desktop-1 1/2",
      "chromium-desktop-2 2/2",
      "chromium-phone-1 1/2",
      "chromium-phone-2 2/2",
      "webkit-desktop-1 1/3",
      "webkit-desktop-2 2/3",
      "webkit-desktop-3 3/3",
      "webkit-phone-1 1/3",
      "webkit-phone-2 2/3",
      "webkit-phone-3 3/3",
    ],
  )
})

test("the browser matrix runs every shard and passes its values through env, not expressions", () => {
  assert.equal(browserJob.strategy["fail-fast"], false)
  assert.equal(browserJob.name, "Browser ${{ matrix.id }}")
  assert.equal(browserJob.env.PROJECT, "${{ matrix.project }}")
  assert.equal(browserJob.env.SHARD, "${{ matrix.shard }}")
  const run = browserJob.steps.find((s) => (s.run ?? "").includes("npm run test:browser")).run
  assert.ok(run.includes('--project="$PROJECT"') && run.includes('--shard="$SHARD"'))
  assert.match(run, /\^\[a-z\]\+-\[a-z\]\+\$.*\^\[1-9\]\/\[1-9\]\$.*exit 1/s)
})

test("a failed browser shard uploads its own report", () => {
  const report = browserJob.steps.find((s) => (s.uses ?? "").startsWith("actions/upload-artifact"))
  assert.equal(report.with.name, "playwright-report-${{ matrix.id }}")
  assert.equal(report.if, "failure()")
})

test("the format check runs once, in one browser shard, off the build critical path", () => {
  const build = wf["ci.yml"].jobs["build-and-check"].steps
  assert.ok(!build.some((s) => (s.run ?? "").includes("format:check")))
  assert.deepEqual(
    matrixEntries.filter((e) => e.format === true).map((e) => e.id),
    ["chromium-desktop-1"],
  )
  const steps = browserJob.steps
  const format = steps.findIndex((s) => (s.run ?? "").includes("npm run format:check"))
  const types = steps.findIndex((s) => (s.run ?? "").includes("npm run check:browser"))
  assert.ok(types >= 0 && format > types)
  assert.equal(steps[format].if, "matrix.format")
})
