import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (f) => readFileSync(join(root, ".github", "workflows", f), "utf8")
const rawText = read("text-release.yml")
const text = parse(rawText)
const cut = parse(read("cut-release.yml"))
const { detect, release } = text.jobs
const names = (job) => job.steps.map((s) => s.name)

test("Text release runs on pushes to main only and drops all token permissions", () => {
  assert.deepEqual(text.on, { push: { branches: ["main"] } })
  assert.deepEqual(text.permissions, {})
  assert.equal(text.concurrency, undefined)
  assert.deepEqual(Object.keys(text.jobs), ["detect", "release"])
})

test("detect holds no concurrency group, reads only and outlasts the CI wait", () => {
  assert.equal(detect.concurrency, undefined)
  assert.deepEqual(detect.permissions, {
    contents: "read",
    "pull-requests": "read",
    actions: "read",
  })
  assert.equal(detect.if, "github.repository == 'greenblacked/Notes'")
  const wait = detect.steps.find((s) => s.run === ".github/scripts/wait-for-ci.sh")
  assert.ok(wait)
  assert.ok(detect["timeout-minutes"] * 60 > 2700, "the job timeout exceeds the default wait")
  assert.deepEqual(detect.outputs, {
    text: "${{ steps.merge.outputs.text }}",
    pr: "${{ steps.merge.outputs.pr }}",
    head_ref: "${{ steps.merge.outputs.head_ref }}",
  })
})

test("detect checks the actor, then checks out, verifies the merge and waits for CI", () => {
  const order = detect.steps.map((s) => s.id ?? s.name)
  assert.equal(detect.steps.length, 4)
  assert.match(detect.steps[0].name, /^Refuse anything but a push to main by the owner/)
  assert.match(detect.steps[1].uses, /^actions\/checkout@[0-9a-f]{40}$/)
  assert.equal(detect.steps[1].with["persist-credentials"], false)
  assert.equal(detect.steps[1].with["sparse-checkout"], ".github/scripts")
  assert.equal(detect.steps[1].with.ref, "${{ github.sha }}")
  assert.equal(detect.steps[2].id, "merge")
  assert.match(detect.steps[2].run, /verify-text-merge\.sh/)
  assert.match(detect.steps[2].run, /text=true/)
  assert.match(detect.steps[2].run, /text=false/)
  assert.equal(detect.steps[3].if, "steps.merge.outputs.text == 'true'")
  assert.ok(order.length)
})

test("both jobs refuse anything but a push to main by the owner", () => {
  for (const job of [detect, release]) {
    const run = job.steps[0].run
    assert.ok(run.includes("exit 1"))
    for (const part of [
      "greenblacked/Notes",
      '"$EVENT_NAME" != "push"',
      "refs/heads/main",
      '"$ACTOR" != "greenblacked"',
      '"$TRIGGERING_ACTOR" != "greenblacked"',
    ]) {
      assert.ok(run.includes(part), part)
    }
    assert.equal(job.env.EVENT_NAME, "${{ github.event_name }}")
    assert.equal(job.env.REF, "${{ github.ref }}")
    assert.equal(job.env.ACTOR, "${{ github.actor }}")
    assert.equal(job.env.TRIGGERING_ACTOR, "${{ github.triggering_actor }}")
  }
})

test("release needs detect and joins the Cut release concurrency group", () => {
  assert.equal(release.needs, "detect")
  assert.equal(release.if, "needs.detect.outputs.text == 'true'")
  assert.deepEqual(release.concurrency, cut.concurrency)
  assert.deepEqual(release.concurrency, { group: "cut-release", "cancel-in-progress": false })
  assert.deepEqual(release.permissions, { contents: "write", actions: "write" })
  assert.equal(release.env.PR, "${{ needs.detect.outputs.pr }}")
  assert.equal(release.env.HEAD_REF, "${{ needs.detect.outputs.head_ref }}")
  assert.equal(release.env.GH_TOKEN, "${{ github.token }}")
  assert.equal(release.env.SHA, "${{ github.sha }}")
})

test("release steps run in order and all but the first three are gated on the plan", () => {
  const s = release.steps
  assert.match(s[0].name, /^Refuse anything but a push to main by the owner/)
  assert.match(s[1].uses, /^actions\/checkout@[0-9a-f]{40}$/)
  assert.equal(s[1].with["fetch-depth"], 0)
  assert.equal(s[1].with["persist-credentials"], false)
  assert.equal(s[2].id, "validate")
  assert.equal(s[2].run, ".github/scripts/text-release-plan.sh")
  assert.equal(s[3].run, ".github/scripts/require-ci-success.sh")
  assert.equal(s[4].run, ".github/scripts/text-release-version.sh >/dev/null")
  assert.equal(s[4].env.EXPECT_LATEST, "${{ steps.validate.outputs.latest }}")
  assert.equal(s[5].name, "Create the annotated tag")
  assert.equal(s[6].name, "Create the GitHub Release")
  assert.equal(s[7].name, "Dispatch Deploy production on the tag")
  assert.equal(s.length, 8)
  for (const step of s.slice(3)) {
    assert.equal(step.if, "steps.validate.outputs.release == 'true'", step.name)
  }
  for (const step of s.slice(0, 3)) assert.equal(step.if, undefined, step.name)
})

test("the tag, Release and dispatch steps are exactly Cut release's", () => {
  const pick = ({ name, env, run }) => ({ name, env, run })
  for (const name of [
    "Create the annotated tag",
    "Create the GitHub Release",
    "Dispatch Deploy production on the tag",
  ]) {
    const mine = release.steps.find((s) => s.name === name)
    const theirs = cut.jobs.cut.steps.find((s) => s.name === name)
    assert.deepEqual(pick(mine), pick(theirs), name)
  }
})

test("stage is never required and nothing here interpolates expressions in run blocks", () => {
  assert.ok(!rawText.includes("require-stage-success"))
  for (const job of [detect, release]) {
    for (const s of job.steps) assert.ok(!(s.run ?? "").includes("${{"), s.name)
  }
})
