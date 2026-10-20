import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { assetsBinding, contentType, resolveAsset } from "./serve-built-site.mjs"

const dir = mkdtempSync(join(tmpdir(), "serve-built-site-"))
mkdirSync(join(dir, "b"))
mkdirSync(join(dir, "static"))
writeFileSync(join(dir, "index.html"), "<h1>home</h1>")
writeFileSync(join(dir, "a.html"), "<h1>a</h1>")
writeFileSync(join(dir, "b", "index.html"), "<h1>b</h1>")
writeFileSync(join(dir, "404.html"), "<h1>missing</h1>")
writeFileSync(join(dir, "static", "x.js"), "export {}")

const file = (name, status = 200) => ({ kind: "file", file: join(dir, name), status })
const redirect = (location) => ({ kind: "redirect", location })

test("serves the home page, exact files and pretty URLs", () => {
  assert.deepEqual(resolveAsset(dir, "/"), file("index.html"))
  assert.deepEqual(resolveAsset(dir, "/static/x.js"), file("static/x.js"))
  assert.deepEqual(resolveAsset(dir, "/a"), file("a.html"))
  assert.deepEqual(resolveAsset(dir, "/b/"), file("b/index.html"))
})

test("redirects to the canonical URL", () => {
  assert.deepEqual(resolveAsset(dir, "/a.html"), redirect("/a"))
  assert.deepEqual(resolveAsset(dir, "/b/index.html"), redirect("/b/"))
  assert.deepEqual(resolveAsset(dir, "/index.html"), redirect("/"))
  assert.deepEqual(resolveAsset(dir, "/b"), redirect("/b/"))
  assert.deepEqual(resolveAsset(dir, "/a/"), redirect("/a"))
})

test("unknown paths serve the 404 page", () => {
  assert.deepEqual(resolveAsset(dir, "/nope"), file("404.html", 404))
  assert.deepEqual(resolveAsset(dir, "/nope/"), file("404.html", 404))
  assert.deepEqual(resolveAsset(dir, "/static/"), file("404.html", 404))
})

test("never leaves the public directory", () => {
  assert.deepEqual(resolveAsset(dir, "/../package.json"), file("404.html", 404))
  assert.deepEqual(resolveAsset(dir, "/%2e%2e/x"), file("404.html", 404))
  assert.deepEqual(resolveAsset(dir, "/%2e%2e%2f%2e%2e/etc/passwd"), file("404.html", 404))
  assert.deepEqual(resolveAsset(dir, "/%ZZ"), file("404.html", 404))
  assert.deepEqual(resolveAsset(dir, "/a%00"), file("404.html", 404))
})

test("content types", () => {
  assert.equal(contentType("x.html"), "text/html; charset=utf-8")
  assert.equal(contentType("x.css"), "text/css; charset=utf-8")
  assert.equal(contentType("x.js"), "text/javascript; charset=utf-8")
  assert.equal(contentType("x.mjs"), "text/javascript; charset=utf-8")
  assert.equal(contentType("x.json"), "application/json; charset=utf-8")
  assert.equal(contentType("x.map"), "application/json; charset=utf-8")
  assert.equal(contentType("x.png"), "image/png")
  assert.equal(contentType("x.ico"), "image/x-icon")
  assert.equal(contentType("x.svg"), "image/svg+xml")
  assert.equal(contentType("x.txt"), "text/plain; charset=utf-8")
  assert.equal(contentType("x.woff2"), "font/woff2")
  assert.equal(contentType("x.xml"), "application/xml; charset=utf-8")
  assert.equal(contentType("x.bin"), "application/octet-stream")
})

test("the assets binding keeps the query on redirects and sends no body for HEAD", async () => {
  const assets = assetsBinding(dir)
  const redirected = await assets.fetch(new Request("http://127.0.0.1/b?x=1"))
  assert.equal(redirected.status, 307)
  assert.equal(redirected.headers.get("location"), "/b/?x=1")

  const head = await assets.fetch(new Request("http://127.0.0.1/a", { method: "HEAD" }))
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")

  const get = await assets.fetch(new Request("http://127.0.0.1/nope"))
  assert.equal(get.status, 404)
  assert.equal(await get.text(), "<h1>missing</h1>")
})
