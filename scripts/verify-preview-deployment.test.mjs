import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  checkDeployment,
  deploymentPath,
  fetchLatest,
  main,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAY_MS,
  EXIT_SUPERSEDED,
  SupersededError,
  parseArgs,
  readPrevious,
} from "./verify-preview-deployment.mjs"

const SHA = "a".repeat(40)
const ACCOUNT = "0123456789abcdef0123456789abcdef"
const TOKEN = "tok-SECRET"
const MESSAGE = "stage aaaaaaa"
const argv = [
  "--worker",
  "notes",
  "--preview",
  "stage",
  "--deployment",
  "d1",
  "--tag",
  SHA,
  "--message",
  MESSAGE,
]
const argvPrev = [...argv, "--previous", "d0"]
const env = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }
const good = (over = {}, annotations = {}) => ({
  success: true,
  errors: [],
  result: {
    id: "d1",
    annotations: {
      "workers/tag": SHA,
      "workers/message": MESSAGE,
      "workers/commit_sha": SHA,
      ...annotations,
    },
    ...over,
  },
})
const reply = (status, body) => ({ status, json: async () => body })

/** A fake fetch that answers from a list, repeating the last answer. */
function fakeFetch(...answers) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (answer instanceof Error) throw answer
    return answer
  }
  fn.calls = calls
  return fn
}
const deps = (fetchImpl, attempts = 5) => ({
  fetchImpl,
  attempts,
  delayMs: 0,
  sleep: async () => {},
})

test("a matching latest deployment is active", async () => {
  const fetchImpl = fakeFetch(reply(200, good()))
  const out = await main(argv, env, deps(fetchImpl))
  assert.equal(out, "active=true\nactive_deployment_id=d1")
  assert.equal(fetchImpl.calls.length, 1)
})

test("a missing commit_sha annotation is not an error", async () => {
  const body = good()
  delete body.result.annotations["workers/commit_sha"]
  assert.equal(
    await main(argv, env, deps(fakeFetch(reply(200, body)))),
    "active=true\nactive_deployment_id=d1",
  )
})

test("a wrong tag, message, commit_sha or shape fails and names the field", () => {
  const expected = { deployment: "d1", tag: SHA, message: MESSAGE }
  assert.throws(
    () => checkDeployment(good({}, { "workers/tag": "b".repeat(40) }), expected),
    /workers\/tag/,
  )
  assert.throws(
    () => checkDeployment(good({}, { "workers/message": "other" }), expected),
    /workers\/message/,
  )
  assert.throws(
    () => checkDeployment(good({}, { "workers/commit_sha": "c".repeat(40) }), expected),
    /commit_sha/,
  )
  assert.throws(
    () => checkDeployment(good({ annotations: undefined, other: 1 }), expected),
    /annotations.*result keys: annotations, id, other/,
  )
  assert.throws(() => checkDeployment({ success: true }, expected), /no result/)
  assert.throws(() => checkDeployment(null, expected), /without success/)
})

test("an id mismatch is retried, then fails after exactly the attempts", async () => {
  const stale = reply(200, good({ id: "old" }))
  const never = fakeFetch(stale)
  await assert.rejects(
    main(argv, env, deps(never, 3)),
    /latest stage deployment is old.*3 attempts/,
  )
  assert.equal(never.calls.length, 3)
  const lag = fakeFetch(stale, reply(200, good()))
  assert.equal(await main(argv, env, deps(lag)), "active=true\nactive_deployment_id=d1")
  assert.equal(lag.calls.length, 2)
})

test("HTTP 5xx and network errors are retried; 403 and 404 fail at once", async () => {
  const flaky = fakeFetch(reply(500, {}), new Error("boom"), reply(429, {}), reply(200, good()))
  assert.equal(await main(argv, env, deps(flaky)), "active=true\nactive_deployment_id=d1")
  assert.equal(flaky.calls.length, 4)
  const down = fakeFetch(reply(503, {}))
  await assert.rejects(main(argv, env, deps(down, 2)), /HTTP 503.*2 attempts/)
  for (const status of [403, 404]) {
    const f = fakeFetch(reply(status, {}))
    await assert.rejects(main(argv, env, deps(f)), new RegExp(`HTTP ${status}`))
    assert.equal(f.calls.length, 1)
  }
})

test("API error codes 10025 and 10222 give a specific message", async () => {
  for (const [code, text] of [
    [10025, /Preview "stage" does not exist/],
    [10222, /Preview has no deployment/],
  ]) {
    for (const status of [200, 404]) {
      const f = fakeFetch(reply(status, { success: false, errors: [{ code, message: "x" }] }))
      await assert.rejects(main(argv, env, deps(f)), text)
      assert.equal(f.calls.length, 1)
    }
  }
})

test("arguments and environment are validated", async () => {
  const set = (flag, value) => {
    const copy = [...argv]
    copy[copy.indexOf(flag) + 1] = value
    return copy
  }
  for (const [flag, value] of [
    ["--worker", "No/pe"],
    ["--preview", "a/b"],
    ["--preview", "../x"],
    ["--deployment", "a b"],
    ["--tag", "abc"],
    ["--message", ""],
    ["--message", "x".repeat(101)],
  ]) {
    assert.throws(() => parseArgs(set(flag, value)), /usage/, `${flag} ${value}`)
  }
  assert.throws(() => parseArgs(argv.slice(0, -2)), /missing --message/)
  assert.throws(() => parseArgs([...argv, "--worker", "x"]), /usage/)
  assert.throws(() => parseArgs([...argv, "--other", "x"]), /usage/)
  assert.throws(() => parseArgs([...argv, "--worker"]), /usage/)
  await assert.rejects(
    main(argv, { ...env, CLOUDFLARE_API_TOKEN: "" }, deps(fakeFetch())),
    /API_TOKEN is not set/,
  )
  const bad = "not-hex-account-ID-value"
  await assert.rejects(
    main(argv, { ...env, CLOUDFLARE_ACCOUNT_ID: bad }, deps(fakeFetch())),
    (error) => /32-character hex/.test(error.message) && !error.message.includes(bad),
  )
})

test("the request is exactly the latest path and secrets never reach an error", async () => {
  assert.equal(
    deploymentPath(ACCOUNT, "notes", "stage"),
    `/accounts/${ACCOUNT}/workers/workers/notes/previews/stage/deployments/latest`,
  )
  const ok = fakeFetch(reply(200, good()))
  await main(argv, env, deps(ok))
  assert.equal(
    ok.calls[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/workers/notes/previews/stage/deployments/latest`,
  )
  assert.equal(ok.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`)
  const failures = [
    fakeFetch(reply(500, {})),
    fakeFetch(new Error(`connect failed ${TOKEN} ${ACCOUNT}`)),
    fakeFetch(reply(403, { success: false, errors: [{ code: 1, message: "denied" }] })),
    fakeFetch(reply(200, good({ id: "old" }))),
    fakeFetch(reply(200, good({}, { "workers/tag": "zzz" }))),
  ]
  for (const f of failures) {
    await assert.rejects(main(argv, env, deps(f, 2)), (error) => {
      for (const secret of [TOKEN, ACCOUNT, "api.cloudflare.com"]) {
        assert.ok(!error.message.includes(secret), `message leaks ${secret}: ${error.message}`)
      }
      return true
    })
  }
})

test("fetchLatest returns the parsed body", async () => {
  const body = good()
  const out = await fetchLatest({
    token: TOKEN,
    accountId: ACCOUNT,
    worker: "notes",
    preview: "stage",
    ...deps(fakeFetch(reply(200, body))),
  })
  assert.deepEqual(out, body)
})

test("the script imports only Node built-ins", () => {
  const source = readFileSync(new URL("./verify-preview-deployment.mjs", import.meta.url), "utf8")
  const specs = [...source.matchAll(/^import .* from "(.+)"/gm)].map((m) => m[1])
  assert.ok(specs.length > 0)
  for (const spec of specs) assert.ok(spec.startsWith("node:"), spec)
})

test("transient errors and stale answers share ONE bounded budget", async () => {
  const stale = reply(200, good({ id: "old" }))
  const mixes = [
    [reply(500, {}), stale, new Error("boom"), stale, reply(429, {}), stale, stale],
    [new Error("boom")],
    [reply(503, {}), stale],
    [stale, reply(502, {})],
  ]
  for (const answers of mixes) {
    const f = fakeFetch(...answers)
    const sleeps = []
    await assert.rejects(
      main(argv, env, {
        fetchImpl: f,
        sleep: async (ms) => void sleeps.push(ms),
      }),
      new RegExp(`after ${MAX_ATTEMPTS} attempts`),
    )
    // Not 25: exactly one request per attempt, and one pause between attempts.
    assert.equal(f.calls.length, MAX_ATTEMPTS)
    assert.equal(sleeps.length, MAX_ATTEMPTS - 1)
  }
  // Worst case wall time stays far below the upload job's 15-minute timeout.
  const worstMs = MAX_ATTEMPTS * REQUEST_TIMEOUT_MS + (MAX_ATTEMPTS - 1) * RETRY_DELAY_MS
  assert.ok(worstMs <= 3 * 60 * 1000, `worst case ${worstMs} ms`)
})

test("fetchLatest makes a single request and does not retry or sleep", async () => {
  const f = fakeFetch(reply(503, {}))
  await assert.rejects(
    fetchLatest({
      token: TOKEN,
      accountId: ACCOUNT,
      worker: "notes",
      preview: "stage",
      fetchImpl: f,
    }),
    /HTTP 503/,
  )
  assert.equal(f.calls.length, 1)
})

test("outcomes still map: success after transient errors, hard failure at once", async () => {
  const stale = reply(200, good({ id: "old" }))
  const f = fakeFetch(new Error("boom"), stale, reply(500, {}), reply(200, good()))
  assert.equal(await main(argv, env, deps(f)), "active=true\nactive_deployment_id=d1")
  assert.equal(f.calls.length, 4)
  const wrongTag = fakeFetch(
    reply(500, {}),
    reply(200, good({}, { "workers/tag": "b".repeat(40) })),
  )
  await assert.rejects(main(argv, env, deps(wrongTag)), /workers\/tag/)
  assert.equal(wrongTag.calls.length, 2)
})

test("superseded: a different valid deployment after the whole budget", async () => {
  const newer = reply(200, good({ id: "d2" }))
  // A brief lag is still retried first: ours appears on the 3rd attempt, so not superseded.
  const lag = fakeFetch(newer, newer, reply(200, good()))
  assert.equal(await main(argvPrev, env, deps(lag)), "active=true\nactive_deployment_id=d1")
  const f = fakeFetch(newer)
  await assert.rejects(main(argvPrev, env, deps(f, 4)), (error) => {
    assert.ok(error instanceof SupersededError)
    assert.equal(error.deploymentId, "d2")
    assert.match(error.message, /d2.*after 4 attempts/)
    return true
  })
  assert.equal(f.calls.length, 4)
  // Transient errors earlier in the budget do not hide a superseded final answer.
  const mixed = fakeFetch(reply(500, {}), newer)
  await assert.rejects(main(argvPrev, env, deps(mixed, 3)), SupersededError)
  assert.equal(EXIT_SUPERSEDED, 3)
})

test("not superseded: a stale answer equal to the previous id, or no usable previous id", async () => {
  const stale = reply(200, good({ id: "d0" }))
  // Lag keeps returning the deployment this upload replaced: an ordinary failure, teardown runs.
  const f = fakeFetch(stale)
  await assert.rejects(main(argvPrev, env, deps(f, 3)), (error) => {
    return !(error instanceof SupersededError) && /d0.*after 3 attempts/.test(error.message)
  })
  assert.equal(f.calls.length, 3)
  // No --previous (pre-read failed or unknown): never superseded.
  const other = reply(200, good({ id: "d2" }))
  await assert.rejects(main(argv, env, deps(fakeFetch(other), 2)), (error) => {
    return !(error instanceof SupersededError) && /after 2 attempts/.test(error.message)
  })
  // The Preview did not exist before (`none`): a different id is a real newer upload.
  await assert.rejects(
    main([...argv, "--previous", "none"], env, deps(fakeFetch(other), 2)),
    SupersededError,
  )
})

test("readPrevious: id, none for a missing Preview, unknown otherwise", async () => {
  const opts = { token: TOKEN, accountId: ACCOUNT, worker: "notes", preview: "stage" }
  const read = (f) => readPrevious({ ...opts, fetchImpl: f })
  assert.equal(await read(fakeFetch(reply(200, good({ id: "d0" })))), "d0")
  const err = (code) => reply(404, { success: false, errors: [{ code, message: "x" }] })
  assert.equal(await read(fakeFetch(err(10025))), "none")
  assert.equal(await read(fakeFetch(err(10222))), "none")
  assert.equal(await read(fakeFetch(reply(500, {}))), "unknown")
  assert.equal(await read(fakeFetch(new Error("boom"))), "unknown")
  assert.equal(await read(fakeFetch(reply(200, good({ id: "bad id!" })))), "unknown")
  assert.equal(await readPrevious({ ...opts, accountId: "nope" }), "unknown")
})

test("not superseded: transient last attempt, malformed answer, or our own mismatch", async () => {
  const newer = reply(200, good({ id: "d2" }))
  // The last attempt was a transient error: unknown state, ordinary failure.
  const transient = fakeFetch(newer, reply(502, {}))
  await assert.rejects(main(argv, env, deps(transient, 2)), (error) => {
    return !(error instanceof SupersededError) && /after 2 attempts/.test(error.message)
  })
  // A malformed id or no annotations object is not a valid other deployment.
  for (const body of [
    good({ id: undefined }),
    good({ id: "bad id!" }),
    good({ id: "d2", annotations: null }),
  ]) {
    await assert.rejects(main(argv, env, deps(fakeFetch(reply(200, body)), 2)), (error) => {
      return !(error instanceof SupersededError) && /after 2 attempts/.test(error.message)
    })
  }
  // Our deployment with a wrong tag, message or commit_sha fails at once, never superseded.
  for (const ann of [
    { "workers/tag": "b".repeat(40) },
    { "workers/message": "x" },
    { "workers/commit_sha": "c".repeat(40) },
  ]) {
    const f = fakeFetch(reply(200, good({}, ann)))
    await assert.rejects(main(argv, env, deps(f)), (error) => !(error instanceof SupersededError))
    assert.equal(f.calls.length, 1)
  }
})

test("the CLI prints superseded outputs and exits 3, other failures exit 1", async () => {
  const src = readFileSync(new URL("./verify-preview-deployment.mjs", import.meta.url), "utf8")
  assert.ok(src.includes("superseded=true"))
  assert.ok(src.includes("process.exit(EXIT_SUPERSEDED)"))
  assert.ok(src.includes("process.exit(1)"))
})
