import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "smoke-test.sh")
const VERSION = "1.2.3+0123456789abcdef0123456789abcdef01234567"

const headers = {
  "strict-transport-security": "max-age=63072000",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=()",
  "x-robots-tag": "noindex, nofollow",
}

/** A site that serves a healthy noindex deployment; `overrides` maps a path to a handler. */
function site(overrides = {}) {
  const hits = []
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname
    hits.push(path)
    if (overrides[path]) return overrides[path](res)
    if (path === "/version.txt") {
      res.writeHead(200, { "cache-control": "no-store" }).end(`${VERSION}\n`)
    } else if (path === "/robots.txt") {
      res.writeHead(200, headers).end("User-agent: *\nDisallow: /\n")
    } else if (path === "/static/graph.json") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"v":2,"nodes":[],"links":[]}')
    } else if (path === "/") {
      res.writeHead(200, headers).end("<html></html>")
    } else {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}` }),
    )
  })
}

const servers = []
after(() => servers.forEach((s) => s.close()))

async function run(url, env = {}) {
  const child = spawn("bash", [script, url, VERSION, "noindex"], {
    env: {
      ...process.env,
      SMOKE_MAX_ATTEMPTS: "1",
      SMOKE_CHECK_ROUNDS: "1",
      SMOKE_CHECK_DELAY: "0",
      SMOKE_MAX_DELAY: "0",
      SMOKE_ALLOW_ACCESS: "",
      ...env,
    },
  })
  let out = ""
  child.stdout.on("data", (d) => (out += d))
  child.stderr.on("data", (d) => (out += d))
  const code = await new Promise((resolve) => child.on("close", resolve))
  return { code, out }
}

async function start(overrides) {
  const s = await site(overrides)
  servers.push(s.server)
  return s
}

const redirect =
  (location, status = 302) =>
  (res) =>
    res.writeHead(status, { location }).end()

test("a healthy site passes", async () => {
  const s = await start()
  const { code, out } = await run(s.url)
  assert.equal(code, 0, out)
  assert.match(out, /Smoke test passed/)
})

test("a redirect on /version.txt fails and is not followed", async () => {
  const target = await start()
  const s = await start({ "/version.txt": redirect(`${target.url}/version.txt`, 301) })
  const { code, out } = await run(s.url)
  assert.equal(code, 1, out)
  assert.match(out, /answered HTTP 301 redirecting to/)
  assert.match(out, /redirects are not followed/)
  assert.deepEqual(target.hits, [])
})

test("a redirect on / fails", async () => {
  const target = await start()
  const s = await start({ "/": redirect(`${target.url}/`, 307) })
  const { code, out } = await run(s.url)
  assert.equal(code, 1, out)
  assert.match(out, /GET \/ answered HTTP 307/)
  assert.deepEqual(target.hits, [])
})

test("a redirect on /robots.txt fails", async () => {
  const s = await start({ "/robots.txt": redirect("/elsewhere", 308) })
  const { code, out } = await run(s.url)
  assert.equal(code, 1, out)
  assert.match(out, /GET \/robots\.txt answered HTTP 308/)
  assert.ok(!s.hits.includes("/elsewhere"))
})

const access = redirect("https://team.cloudflareaccess.com/cdn-cgi/access/login/x")

test("a Cloudflare Access redirect fails by default", async () => {
  const s = await start({ "/version.txt": access })
  const { code, out } = await run(s.url)
  assert.equal(code, 1, out)
  assert.match(out, /redirects to a Cloudflare Access login/)
})

test("a Cloudflare Access redirect is a notice with SMOKE_ALLOW_ACCESS=1", async () => {
  const s = await start({ "/version.txt": access })
  const { code, out } = await run(s.url, { SMOKE_ALLOW_ACCESS: "1" })
  assert.equal(code, 0, out)
  assert.match(out, /::notice::.*behind Cloudflare Access/)
})

test("a 200 carrying an Access Location is not treated as Access", async () => {
  const s = await start({
    "/version.txt": (res) =>
      res
        .writeHead(200, { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/x" })
        .end("other\n"),
  })
  const { code, out } = await run(s.url, { SMOKE_ALLOW_ACCESS: "1" })
  assert.equal(code, 1, out)
  assert.doesNotMatch(out, /behind Cloudflare Access/)
  assert.match(out, /did not serve/)
})

test("another redirect still fails with SMOKE_ALLOW_ACCESS=1", async () => {
  const s = await start({ "/version.txt": redirect("https://example.com/") })
  const { code, out } = await run(s.url, { SMOKE_ALLOW_ACCESS: "1" })
  assert.equal(code, 1, out)
  assert.match(out, /redirects are not followed/)
})

test("a missing /static/graph.json fails", async () => {
  const s = await start({ "/static/graph.json": (res) => res.writeHead(404).end() })
  const { code, out } = await run(s.url)
  assert.notEqual(code, 0, out)
  assert.match(out, /graph\.json returned HTTP 404/)
})

test("graph.json with the wrong content-type or body fails", async () => {
  const wrongType = await start({
    "/static/graph.json": (res) =>
      res.writeHead(200, { "content-type": "text/html" }).end('{"v":1}'),
  })
  let r = await run(wrongType.url)
  assert.notEqual(r.code, 0, r.out)
  assert.match(r.out, /content-type should be application\/json/)
  const wrongBody = await start({
    "/static/graph.json": (res) =>
      res.writeHead(200, { "content-type": "application/json" }).end('{"v":1}'),
  })
  r = await run(wrongBody.url)
  assert.notEqual(r.code, 0, r.out)
  assert.match(r.out, /does not contain/)
})
