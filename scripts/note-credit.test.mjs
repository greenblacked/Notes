import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const read = (p) => fs.readFileSync(p, "utf8")
const credit = read("local-plugins/linked-from/credit.ts")
const component = read("local-plugins/linked-from/NoteCredit.tsx")
const linkedFrom = read("local-plugins/linked-from/LinkedFrom.tsx")

test("the canonical host matches the worker's", () => {
  const w = read("worker/indexing.js").match(/CANONICAL_HOST = "([^"]+)"/)
  const c = credit.match(/CANONICAL_HOST = "([^"]+)"/)
  assert.ok(w && c)
  assert.equal(c[1], w[1])
})

test("the repo URL matches the one in the smoke test", () => {
  const c = credit.match(/REPO_URL = "([^"]+)"/)
  assert.ok(c)
  assert.ok(read("scripts/smoke-test.sh").includes(c[1]))
})

test("only known absolute URLs appear", () => {
  const urls = (credit + component).match(/https?:\/\/[^\s"'`)\\]+/g) ?? []
  assert.ok(urls.length > 0)
  for (const u of urls) {
    assert.match(
      u,
      /^https:\/\/(\$\{CANONICAL_HOST\}|github\.com\/greenblacked\/Notes|ai\.szolotov\.com|notes\.szolotov\.com)(\/|$)/,
      u,
    )
  }
})

test("the report link encodes its parts and has no forbidden constructs", () => {
  const all = credit + component
  assert.match(credit, /encodeURIComponent/)
  assert.doesNotMatch(all, /cfg\.baseUrl|baseUrl/)
  assert.doesNotMatch(all, /<form/)
  assert.doesNotMatch(all, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(all, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(all, /rgba?\(/)
})

test("LinkedFrom renders the credit even without sources", () => {
  assert.doesNotMatch(linkedFrom, /sources\.length === 0\) return null/)
  assert.match(linkedFrom, /<NoteCredit/)
  assert.match(linkedFrom, /LinkedFrom\.css = noteCreditCss/)
})
