import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const scss = fs.readFileSync("quartz/styles/custom.scss", "utf8")
const index = fs.readFileSync("local-plugins/note-index/NoteIndex.tsx", "utf8")
const meta = fs.readFileSync("local-plugins/note-meta/NoteMeta.tsx", "utf8")
const format = fs.readFileSync("local-plugins/note-meta/format.ts", "utf8")

test("no status display in the components", () => {
  for (const src of [index, meta, format]) {
    assert.doesNotMatch(src, /statusTone|STATUS_TONES|chip-status|note-index-status/)
  }
  assert.doesNotMatch(meta, /"Status"/)
})

test("no status styles or tokens left", () => {
  assert.doesNotMatch(scss, /chip-status|note-index-status|--chip-(accepted|proposed|warning)-/)
  assert.doesNotMatch(scss, /"type status no"/)
})

test("index header and grid have the same number of columns", () => {
  const head = index.match(/<div class="note-index-head"[^>]*>([\s\S]*?)<\/div>/)
  assert.ok(head, "note-index-head not found")
  const labels = [...head[1].matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1])
  assert.deepEqual(labels, ["No.", "Title", "Type", "Date"])
  const cols = scss.match(/--ni-cols:\s*([^;]+);/)
  assert.ok(cols, "--ni-cols not found")
  const tracks = cols[1].trim().split(/\s+(?![^(]*\))/)
  assert.equal(tracks.length, labels.length)
})
