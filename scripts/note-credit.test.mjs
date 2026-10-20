import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const read = (p) => fs.readFileSync(p, "utf8")
const credit = read("local-plugins/linked-from/credit.ts")
const component = read("local-plugins/linked-from/NoteCredit.tsx")
const linkedFrom = read("local-plugins/linked-from/LinkedFrom.tsx")

test("the credit links no source repository or issue tracker", () => {
  assert.doesNotMatch(credit + component, /github\.com/)
  assert.doesNotMatch(credit + component, /REPO_URL|sourceUrl|reportUrl|issues\/new/)
})

test("the smoke test user agent names the site, not the repository", () => {
  const smoke = read("scripts/smoke-test.sh")
  assert.ok(smoke.includes("notes-smoke-test/1 (+https://notes.szolotov.com)"))
  assert.doesNotMatch(smoke, /github\.com\/greenblacked/)
})

test("only known absolute URLs appear", () => {
  const urls = (credit + component).match(/https?:\/\/[^\s"'`)\\]+/g) ?? []
  assert.ok(urls.length > 0)
  for (const u of urls) {
    assert.match(u, /^https:\/\/ai\.szolotov\.com(\/|$)/, u)
  }
})

test("the credit has no forbidden constructs", () => {
  const all = credit + component
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
