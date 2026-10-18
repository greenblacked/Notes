import assert from "node:assert/strict"
import { test } from "node:test"
import { coversStage, hostsOf, main, policyProblems } from "./cloudflare-stage.mjs"

const TOKEN = "tok-secret-123"
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc" }
const okPolicy = {
  id: "p1",
  name: "me",
  decision: "allow",
  include: [{ email: { email: "a@b.c" } }],
}

// routes: "METHOD path" (query stripped) -> result array or {status, body}
function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    const u = new URL(url)
    const key = `${init.method ?? "GET"} ${u.pathname.replace("/client/v4", "")}`
    calls.push({ key, search: u.search, body: init.body ? JSON.parse(init.body) : undefined })
    const r = routes[key]
    if (r === undefined)
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 })
    if (r.status)
      return new Response(JSON.stringify(r.body ?? { success: false, errors: [{ code: 10000 }] }), {
        status: r.status,
      })
    return new Response(
      JSON.stringify({ success: true, result: r, result_info: { total_pages: 1 } }),
      { status: 200 },
    )
  }
}

async function run(argv, routes, calls = []) {
  const lines = []
  const code = await main(argv, {
    fetch: fakeFetch(routes, calls),
    env: ENV,
    out: (l) => lines.push(l),
  })
  return { code, text: lines.join("\n"), calls }
}

const stageApp = {
  id: "a1",
  name: "s",
  type: "self_hosted",
  domain: "stage.notes.szolotov.com",
  policies: [okPolicy],
}
const cleanRoutes = (apps) => ({
  "GET /accounts/acc/access/apps": apps,
  "GET /zones": [{ id: "z1" }],
})

test("coversStage: exact host, wildcard, path, destinations", () => {
  assert.equal(coversStage({ domain: "stage.notes.szolotov.com" }), true)
  assert.equal(coversStage({ self_hosted_domains: ["*.notes.szolotov.com"] }), true)
  assert.equal(coversStage({ domain: "stage.notes.szolotov.com/x" }), false)
  assert.equal(coversStage({ domain: "stage.notes.szolotov.com/*" }), true)
  assert.equal(
    coversStage({ destinations: [{ type: "public", uri: "Stage.notes.szolotov.com" }] }),
    true,
  )
  assert.equal(coversStage({ domain: "dev.notes.szolotov.com" }), false)
  assert.deepEqual(
    hostsOf({ domain: "A.example/x", destinations: [{ type: "public", uri: "b.example" }] }),
    ["a.example", "b.example"],
  )
})

test("policyProblems: empty, bypass, non_identity, everyone", () => {
  assert.deepEqual(policyProblems([]), ["no policies"])
  assert.equal(policyProblems([{ name: "x", decision: "bypass", include: [] }]).length, 1)
  assert.equal(policyProblems([{ name: "x", decision: "non_identity", include: [] }]).length, 1)
  assert.equal(
    policyProblems([{ name: "x", decision: "allow", include: [{ everyone: {} }] }]).length,
    1,
  )
  assert.deepEqual(policyProblems([okPolicy]), [])
})

test("preflight passes with a covering app and a clean hostname", async () => {
  const r = await run(["preflight"], cleanRoutes([stageApp]))
  assert.equal(r.code, 0, r.text)
})

test("preflight fails with no app", async () => {
  const r = await run(["preflight"], cleanRoutes([]))
  assert.equal(r.code, 1)
})

test("preflight fails on a Custom Domain", async () => {
  const r = await run(["preflight"], {
    ...cleanRoutes([stageApp]),
    "GET /accounts/acc/workers/domains": [{ id: "d" }],
  })
  assert.equal(r.code, 1)
  assert.match(r.text, /Custom Domain/)
})

test("preflight fails on a DNS record", async () => {
  const r = await run(["preflight"], {
    ...cleanRoutes([stageApp]),
    "GET /zones/z1/dns_records": [{ id: "r" }],
  })
  assert.equal(r.code, 1)
  assert.match(r.text, /DNS record/)
})

test("a 403 on the apps endpoint gives the scope message, and the token is never printed", async () => {
  const r = await run(["preflight"], { "GET /accounts/acc/access/apps": { status: 403 } })
  assert.equal(r.code, 1)
  assert.match(r.text, /Access: Apps and Policies/)
  assert.ok(!r.text.includes(TOKEN))
  const ok = await run(["preflight"], cleanRoutes([stageApp]))
  assert.ok(!ok.text.includes(TOKEN))
  assert.ok(!ok.text.includes("a@b.c"))
})

test("ensure-access is a no-op when stage is covered", async () => {
  const r = await run(["ensure-access"], cleanRoutes([stageApp]))
  assert.equal(r.code, 0)
  assert.ok(!r.calls.some((c) => c.key.startsWith("POST")))
})

test("ensure-access creates the app with the dev app's reusable policy ids", async () => {
  const dev = {
    id: "d1",
    type: "self_hosted",
    domain: "dev.notes.szolotov.com",
    session_duration: "12h",
    policies: [{ id: "pol9", reusable: true, name: "me", decision: "allow", precedence: 1 }],
  }
  const calls = []
  let created = false
  const base = fakeFetch({ "GET /accounts/acc/access/apps": [dev] }, calls)
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url)
    if ((init.method ?? "GET") === "POST" && u.pathname.endsWith("/access/apps")) {
      created = true
      calls.push({ key: "POST apps", body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ success: true, result: { id: "new" } }), { status: 200 })
    }
    if (created && u.pathname.endsWith("/access/apps")) {
      return new Response(
        JSON.stringify({ success: true, result: [dev, { ...stageApp, policies: [okPolicy] }] }),
        { status: 200 },
      )
    }
    return base(url, init)
  }
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: fetchFn,
    env: ENV,
    out: (l) => lines.push(l),
  })
  assert.equal(code, 0, lines.join("\n"))
  const post = calls.find((c) => c.key === "POST apps")
  assert.equal(post.body.domain, "stage.notes.szolotov.com")
  assert.equal(post.body.session_duration, "12h")
  assert.deepEqual(post.body.policies, [{ id: "pol9", precedence: 1 }])
})

test("ensure-access fails when there is nothing to copy", async () => {
  const r = await run(["ensure-access"], cleanRoutes([]))
  assert.equal(r.code, 1)
})

test("retire-dev-access deletes only an exact dev-only app", async () => {
  const dev = { id: "d1", domain: "dev.notes.szolotov.com" }
  const wide = { id: "w1", self_hosted_domains: ["dev.notes.szolotov.com", "other.example"] }
  const wild = { id: "w2", domain: "*.notes.szolotov.com" }
  const r = await run(["retire-dev-access"], { "GET /accounts/acc/access/apps": [dev, wide, wild] })
  assert.equal(r.code, 0)
  const dels = r.calls.filter((c) => c.key.startsWith("DELETE"))
  assert.deepEqual(
    dels.map((c) => c.key),
    ["DELETE /accounts/acc/access/apps/d1"],
  )
})

test("retire-dev-access passes when nothing is found", async () => {
  const r = await run(["retire-dev-access"], { "GET /accounts/acc/access/apps": [stageApp] })
  assert.equal(r.code, 0)
  assert.ok(!r.calls.some((c) => c.key.startsWith("DELETE")))
})

test("unknown commands print usage and fail", async () => {
  const r = await run(["nope"], {})
  assert.equal(r.code, 2)
  assert.match(r.text, /usage/)
})
