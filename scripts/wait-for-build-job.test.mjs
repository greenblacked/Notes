import assert from "node:assert/strict"
import { test } from "node:test"
import {
  GIVE_UP_SECONDS,
  MAX_API_FAILURES,
  pollDelaySeconds,
  waitForBuildJob,
} from "../.github/scripts/wait-for-build-job.mjs"

const env = {
  GITHUB_API_URL: "https://api.example.test",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_RUN_ID: "42",
  GH_TOKEN: "t0ken",
}
const job = (over = {}) => ({
  name: "Build and check",
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  ...over,
})

// `pages` is a list of responses served in order (the last repeats). A response is
// { jobs, next?, status? } or an Error to throw.
function harness(pages) {
  const calls = []
  const sleeps = []
  let t = 0
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const p = pages[Math.min(calls.length, pages.length) - 1]
    if (p instanceof Error) throw p
    const status = p.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (h === "link" && p.next ? `<${p.next}>; rel="next"` : null) },
      json: async () => ({ jobs: p.jobs }),
    }
  }
  const sleep = async (ms) => {
    sleeps.push(ms / 1000)
    t += ms
  }
  const logs = []
  const run = () => waitForBuildJob({ env, fetch, sleep, now: () => t, log: (l) => logs.push(l) })
  return { run, calls, sleeps, logs }
}

test("succeeds at once when the build job is completed and successful", async () => {
  const h = harness([{ jobs: [job({ name: "Other", conclusion: "failure" }), job()] }])
  assert.equal(await h.run(), 0)
  assert.equal(h.calls.length, 1)
  assert.equal(h.sleeps.length, 0)
  const { url, init } = h.calls[0]
  assert.equal(
    url,
    "https://api.example.test/repos/o/r/actions/runs/42/jobs?filter=all&per_page=100",
  )
  assert.equal(init.headers.Authorization, "Bearer t0ken")
  assert.equal(init.headers.Accept, "application/vnd.github+json")
  assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28")
})

test("fails at once on any other conclusion", async () => {
  for (const conclusion of ["failure", "cancelled", "skipped", "timed_out"]) {
    const h = harness([{ jobs: [job({ conclusion })] }])
    assert.equal(await h.run(), 1, conclusion)
    assert.equal(h.sleeps.length, 0)
    assert.match(h.logs.join("\n"), new RegExp(`ended with '${conclusion}'`))
  }
})

test("waits while queued or running, then succeeds", async () => {
  const running = { jobs: [job({ status: "in_progress", conclusion: null })] }
  const h = harness([{ jobs: [] }, running, running, { jobs: [job()] }])
  assert.equal(await h.run(), 0)
  assert.equal(h.calls.length, 4)
  assert.deepEqual(h.sleeps, [5, 5, 5])
})

test("the latest attempt wins, in either order", async () => {
  const failed1 = job({ run_attempt: 1, conclusion: "failure" })
  const ok2 = job({ run_attempt: 2 })
  assert.equal(await harness([{ jobs: [failed1, ok2] }]).run(), 0)
  assert.equal(await harness([{ jobs: [ok2, failed1] }]).run(), 0)
  const ok1 = job({ run_attempt: 1 })
  const failed2 = job({ run_attempt: 2, conclusion: "failure" })
  assert.equal(await harness([{ jobs: [ok1, failed2] }]).run(), 1)
  // A running newer attempt hides an older success.
  const running2 = job({ run_attempt: 2, status: "in_progress", conclusion: null })
  const h = harness([{ jobs: [ok1, running2] }, { jobs: [ok1, job({ run_attempt: 2 })] }])
  assert.equal(await h.run(), 0)
  assert.equal(h.calls.length, 2)
})

test("follows Link rel=next across pages", async () => {
  const next =
    "https://api.example.test/repos/o/r/actions/runs/42/jobs?filter=all&per_page=100&page=2"
  const h = harness([{ jobs: [job({ name: "Other" })], next }, { jobs: [job()] }])
  assert.equal(await h.run(), 0)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].url, next)
  assert.equal(h.calls[1].init.headers.Authorization, "Bearer t0ken")
})

test("retries API errors and resets the count after a good answer", async () => {
  const err = new Error("boom")
  const h = harness([
    err,
    { status: 502, jobs: [] },
    { status: 403, jobs: [] },
    { jobs: [job({ status: "queued", conclusion: null })] },
    err,
    { jobs: [job()] },
  ])
  assert.equal(await h.run(), 0)
  assert.equal(h.calls.length, 6)
})

test("gives up after 10 consecutive API errors", async () => {
  const h = harness([{ status: 500, jobs: [] }])
  assert.equal(await h.run(), 1)
  assert.equal(h.calls.length, MAX_API_FAILURES)
  assert.equal(h.sleeps.length, MAX_API_FAILURES - 1)
  assert.match(h.logs.join("\n"), /stayed unreadable/)
})

test("gives up after 1500 s with the polling steps 5, 15 and 30 s", async () => {
  const h = harness([{ jobs: [job({ status: "in_progress", conclusion: null })] }])
  assert.equal(await h.run(), 1)
  assert.match(h.logs.join("\n"), /Timed out after 15\d\d s/)
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= GIVE_UP_SECONDS)
  assert.deepEqual(h.sleeps.slice(0, 19), Array(18).fill(5).concat(15))
  assert.equal(h.sleeps.at(-1), 30)
})

test("the poll delay is 5 s under 90 s, 15 s under 300 s, then 30 s", () => {
  assert.deepEqual([0, 89, 90, 299, 300, 1499].map(pollDelaySeconds), [5, 5, 15, 15, 30, 30])
})

test("refuses to run without its environment", async () => {
  const logs = []
  const code = await waitForBuildJob({ env: {}, log: (l) => logs.push(l) })
  assert.equal(code, 1)
  assert.match(logs[0], /required/)
})
