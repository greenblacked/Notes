import assert from "node:assert/strict"
import { test } from "node:test"
import { isIndexable, PRODUCTION_ORIGIN, robotsTxt } from "./indexing.js"

const at = (host) => new URL(`https://${host}/`)

test("indexable only in production on the canonical host", () => {
  assert.equal(isIndexable({ ENVIRONMENT: "production" }, at("notes.szolotov.com")), true)
})

test("everything else is noindex", () => {
  const production = { ENVIRONMENT: "production" }
  assert.equal(isIndexable({ ENVIRONMENT: "preview" }, at("notes.szolotov.com")), false)
  assert.equal(isIndexable({}, at("notes.szolotov.com")), false)
  assert.equal(isIndexable(production, at("stage.notes.szolotov.com")), false)
  assert.equal(isIndexable(production, at("other.notes.szolotov.com")), false)
  assert.equal(isIndexable(production, at("notes.sub.workers.dev")), false)
  assert.equal(isIndexable(production, at("1a2b3c4d-notes.sub.workers.dev")), false)
  assert.equal(isIndexable(production, new URL("http://localhost:8787/")), false)
})

test("production robots.txt allows crawling and lists the sitemap", () => {
  const body = robotsTxt(true)
  assert.equal(body, "User-agent: *\nAllow: /\n\nSitemap: https://notes.szolotov.com/sitemap.xml\n")
  assert.ok(body.includes(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`))
  assert.doesNotMatch(body, /^\s*Disallow:/im)
})

test("non-production robots.txt is crawlable and has no sitemap", () => {
  const body = robotsTxt(false)
  assert.equal(body, "User-agent: *\nAllow: /\n")
  assert.doesNotMatch(body, /^\s*Disallow:/im)
  assert.doesNotMatch(body, /sitemap/i)
})

test("every non-production host gets the crawlable robots.txt", () => {
  const production = { ENVIRONMENT: "production" }
  const cases = [
    [{ ENVIRONMENT: "preview" }, at("notes.szolotov.com")],
    [{}, at("notes.szolotov.com")],
    [production, at("stage.notes.szolotov.com")],
    [production, at("other.notes.szolotov.com")],
    [production, at("notes.sub.workers.dev")],
    [production, at("1a2b3c4d-notes.sub.workers.dev")],
    [production, new URL("http://localhost:8787/")],
  ]
  for (const [env, url] of cases) {
    const body = robotsTxt(isIndexable(env, url))
    assert.doesNotMatch(body, /^\s*Disallow:/im, url.href)
    assert.doesNotMatch(body, /sitemap/i, url.href)
  }
})
