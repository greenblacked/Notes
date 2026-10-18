import assert from "node:assert/strict"
import { test } from "node:test"
import { isIndexable } from "./indexing.js"

const at = (host) => new URL(`https://${host}/`)

test("indexable only in production on the canonical host", () => {
  assert.equal(isIndexable({ ENVIRONMENT: "production" }, at("notes.szolotov.com")), true)
})

test("everything else is noindex", () => {
  const production = { ENVIRONMENT: "production" }
  assert.equal(isIndexable({ ENVIRONMENT: "preview" }, at("notes.szolotov.com")), false)
  assert.equal(isIndexable({}, at("notes.szolotov.com")), false)
  assert.equal(isIndexable(production, at("stage.notes.szolotov.com")), false)
  assert.equal(isIndexable(production, at("dev.notes.szolotov.com")), false)
  assert.equal(isIndexable(production, at("notes.sub.workers.dev")), false)
  assert.equal(isIndexable(production, at("1a2b3c4d-notes.sub.workers.dev")), false)
  assert.equal(isIndexable(production, new URL("http://localhost:8787/")), false)
})
