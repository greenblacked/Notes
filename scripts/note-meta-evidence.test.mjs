import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { EVIDENCE_LEVELS } from "./check-notes.mjs"

const scss = fs.readFileSync("quartz/styles/custom.scss", "utf8")
const index = fs.readFileSync("local-plugins/note-index/NoteIndex.tsx", "utf8")
const meta = fs.readFileSync("local-plugins/note-meta/NoteMeta.tsx", "utf8")
const format = fs.readFileSync("local-plugins/note-meta/format.ts", "utf8")

test("the spec sheet has Evidence and Reviewed items", () => {
  assert.match(meta, /item\(\s*"Evidence"/)
  assert.match(meta, /item\(\s*"Reviewed"/)
})

test("the sheet is still empty when no sheet field is set, and evidence and reviewed count", () => {
  const early = meta.match(/if \(([^)]*)\) return null/)
  assert.ok(early, "early return not found")
  assert.match(early[1], /!evidence/)
  assert.match(early[1], /!reviewed/)
})

test("the evidence level is plain text: no chip or data attribute", () => {
  for (const src of [meta, format, scss]) {
    assert.doesNotMatch(src, /chip-evidence|data-evidence/)
  }
})

test("the display labels cover exactly the levels the check accepts", () => {
  const block = format.match(/EVIDENCE_LABELS[^=]*=\s*\{([\s\S]*?)\n\}/)
  assert.ok(block, "EVIDENCE_LABELS not found")
  const keys = [...block[1].matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1])
  assert.deepEqual(keys, EVIDENCE_LEVELS)
})

test("the home page index does not show evidence", () => {
  assert.doesNotMatch(index, /evidence/i)
})
