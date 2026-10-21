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
  for (const f of gateScripts)
    repo.write(`.github/scripts/${f}`, "#!/usr/bin/env bash\nexit 0\n", 0o755)
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
