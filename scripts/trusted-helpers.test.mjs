// The text/ gate and the Text release helpers must run from a trusted revision (the pull request's
// base commit, the latest release tag), never from the code under judgement. These tests run the
// real `run` blocks of the workflows against throwaway repositories.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { makeRepo } from "./git-test-repo.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const workflow = (f) => parse(readFileSync(join(root, ".github", "workflows", f), "utf8"))
const realScript = (f) => readFileSync(join(root, ".github", "scripts", f), "utf8")
const cleanups = []
after(() => {
  for (const c of cleanups) c()
})

function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function newRepo(prefix) {
  const repo = makeRepo(prefix)
  cleanups.push(() => repo.cleanup())
  return repo
}

function runStep(run, repo, env) {
  const runnerTemp = tmp("runner-temp-")
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", run], {
    cwd: repo.dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: runnerTemp, ...env },
  })
  return { code: r.status, out: r.stdout + r.stderr, runnerTemp }
}

// ---- ci.yml: the text/ gate runs from the base commit ----

const gate = workflow("ci.yml").jobs["workflow-lint"].steps.find(
  (s) => s.name === "Require only content changes on a text/ branch",
).run
const gateScripts = ["require-text-paths.sh", "require-content-only.sh"]

function gateRepo({ withScripts = true } = {}) {
  const repo = newRepo("gate-")
  repo.write("README.md", "readme\n")
  repo.write("content/a.md", "a\n")
  if (withScripts) {
    for (const f of gateScripts) repo.write(`.github/scripts/${f}`, realScript(f), 0o755)
  }
  const base = repo.commit("base")
  return { repo, base }
}

const gateEnv = (base, head, headRef = "text/fix-typo") => ({
  EVENT_NAME: "pull_request",
  HEAD_REF: headRef,
  PR_BASE: base,
  PR_HEAD: head,
})

test("a text/ pull request that rewrites the gate scripts is still judged by the base's scripts", () => {
  const { repo, base } = gateRepo()
  repo.branch("text/fix-typo", base)
  for (const f of gateScripts) {
    repo.write(`.github/scripts/${f}`, "#!/usr/bin/env bash\nexit 0\n", 0o755)
  }
  repo.write("package.json", "{}\n")
  const head = repo.commit("hostile")
  const r = runStep(gate, repo, gateEnv(base, head))
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /package\.json/)
})

test("a content-only text/ pull request passes the gate from the base", () => {
  const { repo, base } = gateRepo()
  repo.branch("text/fix-typo", base)
  repo.write("content/a.md", "a2\n")
  const head = repo.commit("typo")
  const r = runStep(gate, repo, gateEnv(base, head))
  assert.equal(r.code, 0, r.out)
})

test("a text/ pull request whose base has no gate scripts fails closed", () => {
  const { repo, base } = gateRepo({ withScripts: false })
  repo.branch("text/fix-typo", base)
  repo.write("content/a.md", "a2\n")
  const head = repo.commit("typo")
  const r = runStep(gate, repo, gateEnv(base, head))
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /has no executable \.github\/scripts\/require-text-paths\.sh/)
})

test("a pull request from another branch needs no gate scripts on its base", () => {
  const { repo, base } = gateRepo({ withScripts: false })
  repo.branch("ci/x", base)
  repo.write("package.json", "{}\n")
  const head = repo.commit("code")
  const r = runStep(gate, repo, gateEnv(base, head, "ci/x"))
  assert.equal(r.code, 0, r.out)
})

test("a push event is not restricted and needs no git", () => {
  const { repo } = gateRepo()
  const r = runStep(gate, repo, { EVENT_NAME: "push", HEAD_REF: "", GIT_DIR: "/nonexistent" })
  assert.equal(r.code, 0, r.out)
})

test("a text/ pull request whose base commit is not in the checkout fails closed", () => {
  const { repo, base } = gateRepo()
  const r = runStep(gate, repo, gateEnv("0".repeat(40), base))
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /not in this checkout/)
})

// ---- text-release.yml: the helpers come from the latest release tag ----

const trustedStep = workflow("text-release.yml").jobs.detect.steps.find(
  (s) => s.id === "trusted",
).run
const helperNames = [
  "verify-text-merge.sh",
  "wait-for-ci.sh",
  "text-release-plan.sh",
  "text-release-version.sh",
  "text-release-notes.sh",
  "require-content-only.sh",
  "require-ci-success.sh",
]

function releaseRepo() {
  const repo = newRepo("trusted-")
  repo.write("README.md", "readme\n")
  for (const f of helperNames) repo.write(`.github/scripts/${f}`, realScript(f), 0o755)
  const a = repo.commit("A")
  repo.git("tag", "-a", "-m", "v0.1.0", "v0.1.0")
  repo.write(".github/scripts/verify-text-merge.sh", "#!/usr/bin/env bash\necho PWNED\n", 0o755)
  const b = repo.commit("B")
  return { repo, a, b }
}

function trustedRun(repo, sha, mode = "skip") {
  const outFile = join(tmp("gh-output-"), "out")
  const r = runStep(trustedStep, repo, { SHA: sha, ON_MISSING: mode, GITHUB_OUTPUT: outFile })
  let outputs = {}
  try {
    for (const line of readFileSync(outFile, "utf8").split("\n")) {
      const i = line.indexOf("=")
      if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1)
    }
  } catch {
    outputs = {}
  }
  return { ...r, outputs }
}

test("the helpers come from the latest release tag, not from the pushed commit", () => {
  const { repo, b } = releaseRepo()
  const r = trustedRun(repo, b)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.ready, "true")
  assert.equal(r.outputs.tag, "v0.1.0")
  const got = readFileSync(
    join(r.runnerTemp, "trusted/.github/scripts/verify-text-merge.sh"),
    "utf8",
  )
  assert.equal(got, realScript("verify-text-merge.sh"))
})

test("tags that are not strict vX.Y.Z are ignored", () => {
  const { repo, b } = releaseRepo()
  for (const t of ["v9.9", "v01.0.0", "v1.0.0-rc.1"]) repo.git("tag", t, b)
  const r = trustedRun(repo, b)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.tag, "v0.1.0")
})

test("a release tag on a merged branch commit is refused", () => {
  const { repo, a, b } = releaseRepo()
  repo.branch("side", a)
  repo.write(".github/scripts/wait-for-ci.sh", "#!/usr/bin/env bash\nexit 0\n", 0o755)
  const c = repo.commit("C")
  repo.git("tag", "-a", "-m", "v0.2.0", "v0.2.0", c)
  repo.checkout("main")
  repo.git("merge", "-q", "--no-ff", "-m", "M", "side")
  const m = repo.git("rev-parse", "HEAD")
  assert.notEqual(m, b)
  const r = trustedRun(repo, m)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /first-parent/)
})

test("a commit already in the latest tag is not released again", () => {
  const { repo, a, b } = releaseRepo()
  repo.git("tag", "-a", "-m", "v0.3.0", "v0.3.0", b)
  const r = trustedRun(repo, a)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.outputs.ready, "false")
  assert.match(r.out, /already in v0\.3\.0/)
})

test("without a release tag the step skips or fails by mode", () => {
  const repo = newRepo("no-tag-")
  repo.write("README.md", "x\n")
  const sha = repo.commit("A")
  const skip = trustedRun(repo, sha, "skip")
  assert.equal(skip.code, 0, skip.out)
  assert.equal(skip.outputs.ready, "false")
  assert.match(skip.out, /run Cut release first/)
  const fail = trustedRun(repo, sha, "fail")
  assert.equal(fail.code, 1, fail.out)
})

test("a tag that predates the helpers skips or fails by mode", () => {
  const repo = newRepo("old-tag-")
  repo.write(".github/scripts/is-branch-head.sh", realScript("is-branch-head.sh"), 0o755)
  repo.commit("A")
  repo.git("tag", "-a", "-m", "v0.6.0", "v0.6.0")
  repo.write("content/a.md", "a\n")
  const sha = repo.commit("B")
  const skip = trustedRun(repo, sha, "skip")
  assert.equal(skip.code, 0, skip.out)
  assert.equal(skip.outputs.ready, "false")
  const fail = trustedRun(repo, sha, "fail")
  assert.equal(fail.code, 1, fail.out)
  assert.match(fail.out, /has no executable \.github\/scripts\/verify-text-merge\.sh/)
})
