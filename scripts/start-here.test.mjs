import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { EVIDENCE_LEVELS } from "./check-notes.mjs"

const read = (p) => fs.readFileSync(p, "utf8")
const goals = JSON.parse(read("local-plugins/start-here/goals.json"))
const frontmatter = (slug) => read(`content/${slug}.md`).match(/^---\n([\s\S]*?)\n---/)[1]
const field = (slug, key) => frontmatter(slug).match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]

test("goals.json has the four goals in order", () => {
  assert.deepEqual(
    goals.map((g) => [g.id, g.title]),
    [
      ["ops", "Resolve an operational problem"],
      ["design", "Design or improve a platform"],
      ["skills", "Develop engineering skills"],
      ["lead", "Lead a platform team"],
    ],
  )
  for (const g of goals) assert.ok(g.blurb && g.browse.length > 0, g.id)
})

test("every slug resolves to a note", () => {
  for (const g of goals) {
    const slugs = [...g.browse.map((b) => b.slug), ...(g.featured ?? []), ...(g.more ?? [])]
    for (const slug of slugs) assert.ok(fs.existsSync(`content/${slug}.md`), slug)
  }
})

test("featured notes carry an evidence level and are published", () => {
  for (const g of goals) {
    for (const slug of g.featured ?? []) {
      assert.ok(EVIDENCE_LEVELS.includes(field(slug, "evidence")), `${slug} evidence`)
      assert.equal(field(slug, "draft"), "false", `${slug} draft`)
    }
  }
  for (const id of ["ops", "design"]) {
    assert.ok(goals.find((g) => g.id === id).featured.length >= 1, id)
  }
})

test("the All notes page is not a typed note", () => {
  const fm = frontmatter("all-notes")
  assert.doesNotMatch(fm, /^(evidence|type):/m)
  assert.match(read("local-plugins/note-index/notes.ts"), /all-notes/)
})

test("components are configured and registered", () => {
  const cfg = read("quartz.config.yaml")
  assert.match(cfg, /\.\/local-plugins\/note-index\n(?:.*\n){1,6}?\s+condition: all-notes/)
  assert.match(cfg, /\.\/local-plugins\/start-here\n(?:.*\n){1,6}?\s+condition: home/)
  const ts = read("quartz.ts")
  assert.match(ts, /registerCondition\("all-notes"/)
  assert.match(ts, /"start-here"/)
  assert.match(ts, /"note-index"/)
})

test("Start here shows no status", () => {
  assert.doesNotMatch(
    read("local-plugins/start-here/StartHere.tsx"),
    /chip-status|data-status|statusTone/,
  )
})
