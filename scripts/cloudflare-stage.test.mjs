import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  coversPreview,
  coversStage,
  globToRegex,
  hasSafeAllow,
  hostsOf,
  main,
  policyProblems,
  strictGlobToRegex,
  touchesPreview,
  touchesStage,
} from "./cloudflare-stage.mjs"

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
  "GET /accounts/acc/workers/subdomain": { subdomain: "sub" },
})

test("coversStage: exact host, wildcard, path, destinations", () => {
  assert.equal(coversStage({ domain: "stage.notes.szolotov.com" }), true)
  assert.equal(coversStage({ self_hosted_domains: ["*.notes.szolotov.com"] }), true)
  assert.equal(coversStage({ domain: "*.szolotov.com" }), false)
  assert.equal(coversStage({ domain: "*.*.szolotov.com" }), true)
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
  assert.equal(
    policyProblems([{ name: "x", decision: "bypass", include: [{ email: { email: "a@b.c" } }] }])
      .length,
    1,
  )
  assert.equal(
    policyProblems([
      { name: "x", decision: "non_identity", include: [{ email: { email: "a@b.c" } }] },
    ]).length,
    1,
  )
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
  assert.match(r.text, /failed with HTTP 403 \(code 10000\): /)
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

test("ensure-access fails when nothing exists and no owner email is set", async () => {
  const r = await run(["ensure-access"], cleanRoutes([]))
  assert.equal(r.code, 1)
  assert.match(r.text, /STAGE_ACCESS_EMAIL/)
  assert.ok(!r.calls.some((c) => c.key.startsWith("POST")))
})

// A fake API that remembers the application created by POST and lists it afterwards.
function statefulApi(apps, extra = {}, { rejectWorkersDev = false } = {}) {
  const calls = []
  const list = [...apps]
  const base = fakeFetch({ ...cleanRoutes([]), ...extra }, calls)
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? "GET"
    if (u.pathname.endsWith("/access/apps")) {
      if (method === "POST") {
        const body = JSON.parse(init.body)
        calls.push({ key: "POST apps", body })
        list.push({
          id: "new",
          ...body,
          policies: body.policies.map((p, i) => ({ id: `pol${i}`, ...p })),
        })
        return new Response(JSON.stringify({ success: true, result: { id: "new" } }), {
          status: 200,
        })
      }
      return new Response(
        JSON.stringify({ success: true, result: list, result_info: { total_pages: 1 } }),
        { status: 200 },
      )
    }
    if (u.pathname.endsWith("/access/apps/new") && method === "PUT") {
      const body = JSON.parse(init.body)
      calls.push({ key: "PUT app", body })
      if (rejectWorkersDev) {
        return new Response(JSON.stringify({ success: false, errors: [{ code: 12130 }] }), {
          status: 400,
        })
      }
      const i = list.findIndex((a) => a.id === "new")
      list[i] = { ...list[i], destinations: body.destinations }
      return new Response(JSON.stringify({ success: true, result: { id: "new" } }), { status: 200 })
    }
    return base(url, init)
  }
  return { fetchFn, calls, list }
}

const OWNER_ENV = { ...ENV, STAGE_ACCESS_EMAIL: "owner@example.com" }

test("ensure-access creates an owner-only app when none exists, and it passes validation", async () => {
  const api = statefulApi([], { "GET /accounts/acc/workers/subdomain": { subdomain: "Sub" } })
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: api.fetchFn,
    env: OWNER_ENV,
    out: (l) => lines.push(l),
  })
  assert.equal(code, 0, lines.join("\n"))
  const posts = api.calls.filter((c) => c.key === "POST apps")
  assert.equal(posts.length, 1)
  assert.deepEqual(
    posts[0].body.destinations.map((d) => d.uri),
    ["stage.notes.szolotov.com"],
  )
  const body = posts[0].body
  const put = api.calls.find((c) => c.key === "PUT app").body
  assert.equal(body.type, "self_hosted")
  assert.equal(body.domain, "stage.notes.szolotov.com")
  assert.equal(body.session_duration, "24h")
  assert.deepEqual(
    put.destinations.map((d) => d.uri),
    ["stage.notes.szolotov.com", "stage-notes.sub.workers.dev"],
  )
  assert.equal(body.policies.length, 1)
  assert.equal(body.policies[0].decision, "allow")
  assert.deepEqual(body.policies[0].include, [{ email: { email: "owner@example.com" } }])
  assert.deepEqual(policyProblems(body.policies), [])
  assert.ok(coversStage(api.list[0]))
  assert.ok(!lines.join("\n").includes(TOKEN))
})

test("ensure-access keeps the app and prints a NOTE when workers.dev is rejected", async () => {
  const api = statefulApi(
    [],
    { "GET /accounts/acc/workers/subdomain": { subdomain: "sub" } },
    { rejectWorkersDev: true },
  )
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: api.fetchFn,
    env: OWNER_ENV,
    out: (l) => lines.push(l),
  })
  assert.equal(code, 0, lines.join("\n"))
  assert.match(lines.join("\n"), /NOTE: could not add stage-notes\.sub\.workers\.dev/)
  assert.equal(api.calls.filter((c) => c.key === "POST apps").length, 1)
})

test("a re-run adds the workers.dev host to the app it created", async () => {
  const stage = {
    id: "new",
    name: "Notes stage",
    type: "self_hosted",
    domain: "stage.notes.szolotov.com",
    destinations: [{ type: "public", uri: "stage.notes.szolotov.com" }],
    policies: [{ ...okPolicy, id: "pol0" }],
  }
  const api = statefulApi([stage], { "GET /accounts/acc/workers/subdomain": { subdomain: "sub" } })
  const code = await main(["ensure-access"], {
    fetch: api.fetchFn,
    env: OWNER_ENV,
    out: () => {},
  })
  assert.equal(code, 0)
  assert.ok(!api.calls.some((c) => c.key === "POST apps"))
  const put = api.calls.find((c) => c.key === "PUT app")
  assert.deepEqual(
    put.body.destinations.map((d) => d.uri),
    ["stage.notes.szolotov.com", "stage-notes.sub.workers.dev"],
  )
})

test("ensure-access does not create a second app beside a deny-only one", async () => {
  const deny = {
    id: "d1",
    type: "self_hosted",
    domain: "stage.notes.szolotov.com",
    policies: [{ id: "x", decision: "deny", include: [{ email: { email: "a@b.c" } }] }],
  }
  const api = statefulApi([deny])
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: api.fetchFn,
    env: OWNER_ENV,
    out: (l) => lines.push(l),
  })
  assert.equal(code, 1)
  assert.ok(!api.calls.some((c) => c.key === "POST apps"))
  assert.match(lines.join("\n"), /no safe allow policy/)
})

test("ensure-access says a malformed STAGE_ACCESS_EMAIL is invalid", async () => {
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: statefulApi([]).fetchFn,
    env: { ...ENV, STAGE_ACCESS_EMAIL: "nope" },
    out: (l) => lines.push(l),
  })
  assert.equal(code, 1)
  assert.match(lines.join("\n"), /not set or not a valid email address/)
})

test("ensure-access creates no duplicate when run again", async () => {
  const api = statefulApi([])
  for (let i = 0; i < 2; i++) {
    const code = await main(["ensure-access"], {
      fetch: api.fetchFn,
      env: OWNER_ENV,
      out: () => {},
    })
    assert.equal(code, 0)
  }
  assert.equal(api.calls.filter((c) => c.key === "POST apps").length, 1)
})

test("ensure-access does not create a second app beside an unsafe one", async () => {
  const bypass = {
    id: "b1",
    type: "self_hosted",
    domain: "stage.notes.szolotov.com",
    policies: [{ id: "x", decision: "bypass", include: [{ everyone: {} }] }],
  }
  const api = statefulApi([bypass])
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: api.fetchFn,
    env: OWNER_ENV,
    out: (l) => lines.push(l),
  })
  assert.equal(code, 1)
  assert.ok(!api.calls.some((c) => c.key === "POST apps"))
})

function ensureWith(routes, env = OWNER_ENV) {
  const dir = mkdtempSync(join(tmpdir(), "ensure-"))
  const outFile = join(dir, "output")
  const summaryFile = join(dir, "summary")
  const lines = []
  const calls = []
  return main(["ensure-access"], {
    fetch: fakeFetch(routes, calls),
    env: { ...env, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: summaryFile },
    out: (l) => lines.push(l),
  }).then((code) => {
    const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "")
    return {
      code,
      text: lines.join("\n"),
      calls,
      output: read(outFile),
      summary: read(summaryFile),
    }
  })
}

test("ensure-access skips stage (exit 0, deployable=false) when no app covers it and the create is 403", async () => {
  const r = await ensureWith({
    ...cleanRoutes([]),
    "POST /accounts/acc/access/apps": { status: 403 },
  })
  assert.equal(r.code, 0, r.text)
  assert.equal(r.output, "deployable=false\n")
  assert.match(r.text, /::notice::Stage skipped: the Cloudflare token has no Access permission/)
  assert.equal(
    r.summary,
    "Stage skipped: the Cloudflare token has no Access permission and no Access app protects stage.notes.szolotov.com; nothing was deployed.\n",
  )
  assert.ok(!r.text.includes(TOKEN))
})

test("ensure-access skips stage when the create is 403 with code 1010 (token without Access permission)", async () => {
  const r = await ensureWith({
    ...cleanRoutes([]),
    "POST /accounts/acc/access/apps": {
      status: 403,
      body: { success: false, errors: [{ code: 1010 }] },
    },
  })
  assert.equal(r.code, 0, r.text)
  assert.equal(r.output, "deployable=false\n")
  assert.match(r.text, /::notice::Stage skipped/)
})

test("ensure-access skips also when the dev app copy is refused with 403", async () => {
  const dev = {
    id: "d1",
    type: "self_hosted",
    domain: "dev.notes.szolotov.com",
    policies: [okPolicy],
  }
  const r = await ensureWith({
    ...cleanRoutes([dev]),
    "POST /accounts/acc/access/apps": { status: 403 },
  })
  assert.equal(r.code, 0, r.text)
  assert.equal(r.output, "deployable=false\n")
})

test("ensure-access reports deployable=true when stage is covered or created", async () => {
  const covered = await ensureWith(cleanRoutes([stageApp]))
  assert.equal(covered.code, 0, covered.text)
  assert.equal(covered.output, "deployable=true\n")
  assert.equal(covered.summary, "")
})

test("ensure-access reports deployable=true after creating the owner app", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ensure-"))
  const outFile = join(dir, "output")
  const api = statefulApi([])
  const code = await main(["ensure-access"], {
    fetch: api.fetchFn,
    env: { ...OWNER_ENV, GITHUB_OUTPUT: outFile },
    out: () => {},
  })
  assert.equal(code, 0)
  assert.equal(api.calls.filter((c) => c.key === "POST apps").length, 1)
  assert.equal(readFileSync(outFile, "utf8"), "deployable=true\n")
})

test("ensure-access fails without a valid STAGE_ACCESS_EMAIL and never posts", async () => {
  for (const email of [undefined, "nope"]) {
    const env = { ...OWNER_ENV }
    if (email === undefined) delete env.STAGE_ACCESS_EMAIL
    else env.STAGE_ACCESS_EMAIL = email
    const r = await ensureWith(
      { ...cleanRoutes([]), "POST /accounts/acc/access/apps": { status: 403 } },
      env,
    )
    assert.equal(r.code, 1)
    assert.equal(r.output, "")
    assert.ok(!r.calls.some((c) => c.key === "POST /accounts/acc/access/apps"))
  }
})

test("ensure-access fails on a network error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ensure-"))
  const outFile = join(dir, "output")
  const lines = []
  const code = await main(["ensure-access"], {
    fetch: async () => {
      throw new Error("boom")
    },
    env: { ...OWNER_ENV, GITHUB_OUTPUT: outFile },
    out: (l) => lines.push(l),
  })
  assert.equal(code, 1)
  assert.equal(existsSync(outFile) ? readFileSync(outFile, "utf8") : "", "")
})

test("ensure-access still fails on a 403 that is not an auth error (non-JSON or other code)", async () => {
  const bodies = [{ success: false, errors: [{ code: 1020 }] }, null]
  for (const body of bodies) {
    const dir = mkdtempSync(join(tmpdir(), "ensure-"))
    const outFile = join(dir, "output")
    const base = fakeFetch(cleanRoutes([]))
    const lines = []
    const code = await main(["ensure-access"], {
      fetch: async (url, init = {}) => {
        if (init.method === "POST")
          return new Response(body ? JSON.stringify(body) : "<html>blocked</html>", { status: 403 })
        return base(url, init)
      },
      env: { ...OWNER_ENV, GITHUB_OUTPUT: outFile },
      out: (l) => lines.push(l),
    })
    assert.equal(code, 1, lines.join("\n"))
    assert.equal(existsSync(outFile) ? readFileSync(outFile, "utf8") : "", "")
    const text = lines.join("\n")
    if (body) assert.match(text, /failed with HTTP 403 \(code 1020\)/)
    else assert.doesNotMatch(text, /\(code/)
    assert.ok(!text.includes(OWNER_ENV.CLOUDFLARE_API_TOKEN ?? TOKEN))
  }
})

test("ensure-access still fails on a 5xx from the create", async () => {
  const r = await ensureWith({
    ...cleanRoutes([]),
    "POST /accounts/acc/access/apps": { status: 500, body: { success: false } },
  })
  assert.equal(r.code, 1)
  assert.equal(r.output, "")
  assert.match(r.text, /::error::/)
})

test("ensure-access still fails on a 403 when the apps list itself is refused", async () => {
  const r = await ensureWith({ "GET /accounts/acc/access/apps": { status: 403 } })
  assert.equal(r.code, 1)
  assert.equal(r.output, "")
  assert.match(r.text, /Account · Access: Apps and Policies/)
})

test("ensure-access still fails on an unsafe app and never reaches the create", async () => {
  const bypass = {
    id: "b1",
    type: "self_hosted",
    domain: "stage.notes.szolotov.com",
    policies: [{ id: "x", decision: "bypass", include: [{ everyone: {} }] }],
  }
  const r = await ensureWith({
    ...cleanRoutes([bypass]),
    "POST /accounts/acc/access/apps": { status: 403 },
  })
  assert.equal(r.code, 1)
  assert.equal(r.output, "")
  assert.ok(!r.calls.some((c) => c.key === "POST /accounts/acc/access/apps"))
})

test("ensure-access fails on a 502 from the apps list", async () => {
  const r = await ensureWith({ "GET /accounts/acc/access/apps": { status: 502, body: {} } })
  assert.equal(r.code, 1)
  assert.equal(r.output, "")
})

test("retire-dev-access deletes only an exact dev-only app", async () => {
  const dev = { id: "d1", domain: "dev.notes.szolotov.com" }
  const wide = { id: "w1", self_hosted_domains: ["dev.notes.szolotov.com", "other.example"] }
  const wild = { id: "w2", domain: "*.notes.szolotov.com", policies: [okPolicy] }
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

test("policyProblems: only identity include rules are accepted", () => {
  const pol = (include) => [{ name: "x", decision: "allow", include }]
  assert.equal(policyProblems(pol([{ email_domain: { domain: "gmail.com" } }])).length, 1)
  assert.equal(policyProblems(pol([{ login_method: { id: "otp" } }])).length, 1)
  assert.equal(policyProblems(pol([{ any_valid_service_token: {} }])).length, 1)
  assert.equal(policyProblems(pol([{ ip: { ip: "1.2.3.4/32" } }])).length, 1)
  const groups = { g: { id: "g", name: "team", include: [{ email: { email: "a@b.c" } }] } }
  assert.deepEqual(
    policyProblems(pol([{ email: { email: "a@b.c" } }, { group: { id: "g" } }]), groups),
    [],
  )
})

test("preflight fails when a wildcard app allows a public email domain", async () => {
  const wild = {
    id: "w",
    domain: "*.notes.szolotov.com",
    policies: [
      {
        id: "p",
        name: "dom",
        decision: "allow",
        include: [{ email_domain: { domain: "gmail.com" } }],
      },
    ],
  }
  const r = await run(["preflight"], cleanRoutes([wild]))
  assert.equal(r.code, 1)
  assert.match(r.text, /non-identity rule type email_domain/)
})

test("preflight fails when an exact-host bypass app sits next to a safe wildcard app", async () => {
  const exact = {
    id: "x",
    domain: "stage.notes.szolotov.com",
    policies: [{ id: "b", name: "open", decision: "bypass", include: [{ everyone: {} }] }],
  }
  const wild = { id: "w", domain: "*.notes.szolotov.com", policies: [okPolicy] }
  const r = await run(["preflight"], cleanRoutes([wild, exact]))
  assert.equal(r.code, 1, r.text)
  assert.doesNotMatch(r.text, /OK: an Access application protects/)
})

test("preflight fails when a path-scoped bypass app sits on the stage host", async () => {
  const scoped = {
    id: "s",
    domain: "stage.notes.szolotov.com/public/*",
    policies: [{ id: "b", name: "open", decision: "bypass", include: [{ everyone: {} }] }],
  }
  const r = await run(["preflight"], cleanRoutes([stageApp, scoped]))
  assert.equal(r.code, 1, r.text)
  assert.match(r.text, /decision bypass/)
})

test("preflight passes with a safe path-scoped app next to a safe root app", async () => {
  const scoped = { id: "s", domain: "stage.notes.szolotov.com/admin/*", policies: [okPolicy] }
  const r = await run(["preflight"], cleanRoutes([stageApp, scoped]))
  assert.equal(r.code, 0, r.text)
})

test("preflight accepts a safe workers.dev Preview app and notes when none names it", async () => {
  const wd = { id: "wd", name: "wd", domain: "stage-notes.sub.workers.dev", policies: [okPolicy] }
  const r = await run(["preflight"], cleanRoutes([stageApp, wd]))
  assert.equal(r.code, 0, r.text)
  const none = await run(["preflight"], cleanRoutes([stageApp]))
  assert.equal(none.code, 0, none.text)
  assert.match(none.text, /NOTE: no Access application names the workers.dev Preview host/)
  const other = { id: "o", name: "o", domain: "dev-notes.sub.workers.dev", policies: [okPolicy] }
  const unrelated = await run(["preflight"], cleanRoutes([stageApp, other]))
  assert.equal(unrelated.code, 0, unrelated.text)
  assert.match(unrelated.text, /NOTE: workers.dev Access app o /)
})

test("preflight fails closed on an unsafe workers.dev Preview app", async () => {
  const bypass = { decision: "bypass", name: "open", include: [{ everyone: {} }] }
  for (const policies of [
    [okPolicy, bypass],
    [],
    [{ ...okPolicy, include: [{ email_domain: { domain: "b.c" } }] }],
  ]) {
    const wd = { id: "wd", name: "wd", domain: "stage-notes.sub.workers.dev", policies }
    const r = await run(["preflight"], cleanRoutes([stageApp, wd]))
    assert.equal(r.code, 1, r.text)
    assert.match(r.text, /workers.dev Preview host/)
  }
  const wildcard = {
    id: "w",
    domain: "*.sub.workers.dev",
    policies: [okPolicy, { ...okPolicy, id: "p2", decision: "non_identity" }],
  }
  assert.equal((await run(["preflight"], cleanRoutes([stageApp, wildcard]))).code, 1)
})

test("preflight fails when the workers.dev Preview apps have no safe allow", async () => {
  const deny = { id: "d", name: "deny", decision: "deny", include: [{ email: { email: "a@b.c" } }] }
  const denyOnly = { id: "wd", domain: "stage-notes.sub.workers.dev", policies: [deny] }
  assert.equal((await run(["preflight"], cleanRoutes([stageApp, denyOnly]))).code, 1)
  const pathScoped = { id: "wd", domain: "stage-notes.sub.workers.dev/x", policies: [okPolicy] }
  assert.equal((await run(["preflight"], cleanRoutes([stageApp, pathScoped]))).code, 1)
})

test("an app with only deny policies does not cover stage", async () => {
  const deny = { id: "d", name: "deny", decision: "deny", include: [{ email: { email: "a@b.c" } }] }
  assert.equal(hasSafeAllow([deny]), false)
  assert.equal(hasSafeAllow([deny, okPolicy]), true)
  assert.equal(hasSafeAllow([{ ...okPolicy, include: [{ everyone: {} }] }]), false)
  const denyApp = { ...stageApp, policies: [deny] }
  const r = await run(["preflight"], cleanRoutes([denyApp]))
  assert.equal(r.code, 1, r.text)
  assert.match(r.text, /no safe allow policy/)
  const both = await run(["preflight"], cleanRoutes([denyApp, stageApp]))
  assert.equal(both.code, 0, both.text)
})

test("ensure-access copies non-reusable policies inline with every field but the ids", async () => {
  const dev = {
    id: "d1",
    type: "self_hosted",
    domain: "dev.notes.szolotov.com",
    policies: [
      {
        id: "i1",
        uid: "u1",
        created_at: "x",
        updated_at: "y",
        name: "me",
        decision: "allow",
        include: [{ email: { email: "a@b.c" } }],
        approval_required: false,
        purpose_justification_required: true,
        session_duration: "6h",
        precedence: 2,
      },
    ],
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
      return new Response(JSON.stringify({ success: true, result: [dev, stageApp] }), {
        status: 200,
      })
    }
    return base(url, init)
  }
  const code = await main(["ensure-access"], { fetch: fetchFn, env: ENV, out: () => {} })
  assert.equal(code, 0)
  const post = calls.find((c) => c.key === "POST apps")
  assert.deepEqual(post.body.policies, [
    {
      name: "me",
      decision: "allow",
      include: [{ email: { email: "a@b.c" } }],
      approval_required: false,
      purpose_justification_required: true,
      session_duration: "6h",
      precedence: 2,
    },
  ])
})

test("retire-dev-access fails when stage is left without a safe app", async () => {
  const dev = { id: "d1", domain: "dev.notes.szolotov.com" }
  const r = await run(["retire-dev-access"], { "GET /accounts/acc/access/apps": [dev] })
  assert.equal(r.code, 1)
  assert.match(r.text, /after retiring the dev app/)
})

test("unknown commands print usage and fail", async () => {
  const r = await run(["nope"], {})
  assert.equal(r.code, 2)
  assert.match(r.text, /usage/)
})

test("policyProblems: a policy without include rules is a problem", () => {
  for (const include of [undefined, []]) {
    const p = policyProblems([{ name: "x", decision: "allow", include }])
    assert.deepEqual(p, ["policy x has no include rules"])
  }
})

test("policyProblems: group rules are resolved and checked like policy rules", () => {
  const pol = [{ name: "x", decision: "allow", include: [{ group: { id: "g" } }] }]
  const everyone = { g: { id: "g", name: "all", include: [{ everyone: {} }] } }
  const emails = { g: { id: "g", name: "me", include: [{ email: { email: "a@b.c" } }] } }
  assert.equal(policyProblems(pol, everyone).length, 1)
  assert.deepEqual(policyProblems(pol, emails), [])
  assert.equal(policyProblems(pol, {}).length, 1)
  assert.equal(policyProblems(pol).length, 1)
})

test("preflight resolves Access groups through the API", async () => {
  const mk = (include) => ({
    ...cleanRoutes([
      {
        ...stageApp,
        policies: [{ id: "p", name: "g", decision: "allow", include: [{ group: { id: "g1" } }] }],
      },
    ]),
    "GET /accounts/acc/access/groups": [{ id: "g1", name: "grp", include }],
  })
  assert.equal((await run(["preflight"], mk([{ everyone: {} }]))).code, 1)
  assert.equal((await run(["preflight"], mk([{ email: { email: "a@b.c" } }]))).code, 0)
})

test("touchesStage: stage, notes wildcard, zone wildcard and apex", () => {
  assert.equal(touchesStage({ domain: "stage.notes.szolotov.com/x" }), true)
  assert.equal(touchesStage({ domain: "*.szolotov.com" }), true)
  assert.equal(touchesStage({ domain: "szolotov.com/admin" }), true)
  assert.equal(touchesStage({ domain: "dev.notes.szolotov.com" }), false)
  assert.equal(touchesStage({ domain: "other.example.com" }), false)
})

test("policyProblems: null, non-object and empty include entries are problems", () => {
  for (const include of [[{}], [null], ["x"]]) {
    const p = policyProblems([{ name: "x", decision: "allow", include }])
    assert.deepEqual(p, ["policy x has an invalid include rule"])
  }
})

test("workers.dev wildcards inside a label are treated as covering the Preview", async () => {
  const bypass = { id: "b", name: "open", decision: "bypass", include: [{ everyone: {} }] }
  for (const domain of [
    "*-notes.sub.workers.dev",
    "stage-*.sub.workers.dev",
    "*.sub.workers.dev",
  ]) {
    const unsafe = { id: "w", domain, policies: [okPolicy, bypass] }
    const r = await run(["preflight"], cleanRoutes([stageApp, unsafe]))
    assert.equal(r.code, 1, `${domain}: ${r.text}`)
    const safe = { id: "w", domain, policies: [okPolicy] }
    const ok = await run(["preflight"], cleanRoutes([stageApp, safe]))
    assert.equal(ok.code, 0, `${domain}: ${ok.text}`)
    assert.doesNotMatch(ok.text, /NOTE: no Access application names the workers.dev/)
  }
  for (const domain of ["*-other.sub.workers.dev", "dev-*.sub.workers.dev"]) {
    const unrelated = { id: "w", domain, policies: [{ ...okPolicy, decision: "bypass" }] }
    const r = await run(["preflight"], cleanRoutes([stageApp, unrelated]))
    assert.equal(r.code, 0, `${domain}: ${r.text}`)
  }
})

test("a workers.dev app with a login_method include fails the preflight", async () => {
  const wd = {
    id: "wd",
    domain: "stage-notes.sub.workers.dev",
    policies: [{ ...okPolicy, include: [{ login_method: { id: "idp" } }] }],
  }
  assert.equal((await run(["preflight"], cleanRoutes([stageApp, wd]))).code, 1)
})

test("the Access groups endpoint is fetched once for the stage and Preview checks", async () => {
  const groupPolicy = {
    id: "p",
    name: "g",
    decision: "allow",
    include: [{ group: { id: "g1" } }],
  }
  const wd = { id: "wd", domain: "*-notes.sub.workers.dev", policies: [groupPolicy] }
  const calls = []
  const routes = {
    ...cleanRoutes([{ ...stageApp, policies: [groupPolicy] }, wd]),
    "GET /accounts/acc/access/groups": [
      { id: "g1", name: "grp", include: [{ email: { email: "a@b.c" } }] },
    ],
  }
  const r = await run(["preflight"], routes, calls)
  assert.equal(r.code, 0, r.text)
  assert.equal(calls.filter((c) => c.key === "GET /accounts/acc/access/groups").length, 1)
})

test("globToRegex: literal characters, * as any text, anchored, case-insensitive", () => {
  assert.equal(globToRegex("a.b").test("axb"), false)
  assert.equal(globToRegex("a*.b").test("A-long.B"), true)
  assert.equal(globToRegex("a*").test("xa"), false)
})

test("stage: any glob that can match the stage host is checked", async () => {
  const bypass = { decision: "bypass", name: "open", include: [{ everyone: {} }] }
  const unsafe = (domain) => ({ id: "u", domain, policies: [okPolicy, bypass] })
  for (const domain of ["st*.notes.szolotov.com", "*.*.szolotov.com"]) {
    const r = await run(["preflight"], cleanRoutes([stageApp, unsafe(domain)]))
    assert.equal(r.code, 1, `${domain}: ${r.text}`)
  }
  const unrelated = await run(
    ["preflight"],
    cleanRoutes([stageApp, unsafe("x*.notes.szolotov.com")]),
  )
  assert.equal(unrelated.code, 0, unrelated.text)
})

test("Preview: a *-notes.ac*.workers.dev glob is checked and can cover", async () => {
  const bypass = { decision: "bypass", name: "open", include: [{ everyone: {} }] }
  const domain = "*-notes.ac*.workers.dev"
  const acme = { "GET /accounts/acc/workers/subdomain": { subdomain: "acme" } }
  const bad = await run(["preflight"], {
    ...cleanRoutes([stageApp, { id: "w", domain, policies: [okPolicy, bypass] }]),
    ...acme,
  })
  assert.equal(bad.code, 1, bad.text)
  const ok = await run(["preflight"], {
    ...cleanRoutes([stageApp, { id: "w", domain, policies: [okPolicy] }]),
    ...acme,
  })
  assert.equal(ok.code, 0, ok.text)
  assert.doesNotMatch(ok.text, /NOTE: no Access application names the workers.dev/)
})

test("strictGlobToRegex: * stays inside one label", () => {
  assert.equal(strictGlobToRegex("*.szolotov.com").test("stage.notes.szolotov.com"), false)
  assert.equal(strictGlobToRegex("*.*.szolotov.com").test("stage.notes.szolotov.com"), true)
  assert.equal(strictGlobToRegex("S*.notes.szolotov.com").test("stage.notes.szolotov.com"), true)
})

test("a safe *.szolotov.com app touches but does not cover stage", async () => {
  const wild = { id: "w", name: "w", domain: "*.szolotov.com", policies: [okPolicy] }
  assert.equal(touchesStage(wild), true)
  assert.equal(coversStage(wild), false)
  const alone = await run(["preflight"], cleanRoutes([wild]))
  assert.equal(alone.code, 1, alone.text)
  const withStage = await run(["preflight"], cleanRoutes([stageApp, wild]))
  assert.equal(withStage.code, 0, withStage.text)
  const multi = { id: "m", domain: "*.*.szolotov.com", policies: [okPolicy] }
  assert.equal((await run(["preflight"], cleanRoutes([multi]))).code, 0)
})

test("a safe *.workers.dev app touches but does not cover the Preview", async () => {
  const wild = { id: "w", name: "w", domain: "*.workers.dev", policies: [okPolicy] }
  const acme = { "GET /accounts/acc/workers/subdomain": { subdomain: "acme" } }
  assert.equal(touchesPreview(wild, "stage-notes.acme.workers.dev"), true)
  assert.equal(coversPreview(wild, "stage-notes.acme.workers.dev"), false)
  const r = await run(["preflight"], { ...cleanRoutes([stageApp, wild]), ...acme })
  assert.equal(r.code, 1, r.text)
  const bypass = { ...wild, policies: [okPolicy, { ...okPolicy, id: "b", decision: "bypass" }] }
  assert.equal((await run(["preflight"], cleanRoutes([stageApp, bypass]))).code, 1)
})

test("Preview coverage uses the real account subdomain", async () => {
  const acme = { "GET /accounts/acc/workers/subdomain": { subdomain: "acme" } }
  const safe = (domain) => ({ id: "w", domain, policies: [okPolicy] })
  const ok = await run(["preflight"], {
    ...cleanRoutes([stageApp, safe("*-notes.acme.workers.dev")]),
    ...acme,
  })
  assert.equal(ok.code, 0, ok.text)
  const wrong = await run(["preflight"], {
    ...cleanRoutes([stageApp, safe("stage-notes.x*.workers.dev")]),
    ...acme,
  })
  assert.equal(wrong.code, 1, wrong.text)
})

test("a failed subdomain lookup counts no app as covering the Preview", async () => {
  const failing = { "GET /accounts/acc/workers/subdomain": { status: 403 } }
  const wd = { id: "wd", domain: "stage-notes.sub.workers.dev", policies: [okPolicy] }
  const r = await run(["preflight"], { ...cleanRoutes([stageApp, wd]), ...failing })
  assert.equal(r.code, 1, r.text)
  assert.match(r.text, /NOTE: cannot read the workers.dev subdomain/)
  assert.match(r.text, /Workers Scripts: Read/)
  const none = await run(["preflight"], { ...cleanRoutes([stageApp]), ...failing })
  assert.equal(none.code, 0, none.text)
  assert.match(none.text, /NOTE: no Access application names the workers.dev Preview host/)
})
