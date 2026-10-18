import assert from "node:assert/strict"
import fs from "node:fs"
import { gzipSync } from "node:zlib"
import { test } from "node:test"
import { contentIndexToData } from "../local-plugins/graph-launcher/scripts/graph-model.mjs"
import { SECTIONS, buildGraphData, isFolderSlug, simplifySlug } from "./graph-data.mjs"

const entry = (title, links = [], tags = [], extra = {}) => ({
  slug: "x",
  filePath: "x.md",
  title,
  links,
  tags,
  content: "BODY TEXT",
  ...extra,
})

const index = {
  index: entry("Home", ["patterns/foo", "adr/index"]),
  "adr/index": entry("ADRs", ["adr/0001-bar", "adr"]),
  "adr/0001-bar": entry(
    "Bar",
    ["patterns/foo#section", "patterns/foo", "missing/page", "adr/0001-bar"],
    ["b", "a", "a"],
  ),
  "patterns/foo": entry("Foo", ["adr/0001-bar"], ["gke"]),
  tags: entry("Tags"),
  "tags/index": entry("Tags again"),
  "tags/gke": entry("Tag: gke"),
  "misc/one": entry("One"),
}

test("simplifySlug drops a trailing /index and keeps index", () => {
  assert.equal(simplifySlug("adr/index"), "adr")
  assert.equal(simplifySlug("index"), "index")
  assert.equal(simplifySlug("a/b#c"), "a/b")
  assert.equal(simplifySlug("a/indexer"), "a/indexer")
})

test("nodes: tags/* keys are not nodes, ids simplified, sorted", () => {
  const g = buildGraphData(index)
  assert.equal(g.v, 2)
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ["adr", "adr/0001-bar", "index", "misc/one", "patterns/foo", "tags"],
  )
})

test("folder index notes get d: 1, other notes none", () => {
  const g = buildGraphData(index)
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]))
  assert.equal(byId["adr"].d, 1)
  assert.equal("d" in byId["adr/0001-bar"], false)
  assert.equal("d" in byId["index"], false)
  for (const n of g.nodes) assert.ok(!("d" in n) || n.d === 1, `${n.id}: d is absent or 1`)
  assert.equal(isFolderSlug("a/index#x"), true)
  assert.equal(isFolderSlug("a/indexer"), false)
  assert.equal(isFolderSlug("index"), false)
})

test("section is the first segment when known, else other", () => {
  const by = Object.fromEntries(buildGraphData(index).nodes.map((n) => [n.id, n.section]))
  assert.equal(by["adr"], "adr")
  assert.equal(by["adr/0001-bar"], "adr")
  assert.equal(by["patterns/foo"], "patterns")
  assert.equal(by["index"], "other")
  assert.equal(by["tags"], "other")
  assert.equal(by["misc/one"], "other")
})

test("tags are de-duplicated and sorted", () => {
  const n = buildGraphData(index).nodes.find((x) => x.id === "adr/0001-bar")
  assert.deepEqual(n.tags, ["a", "b"])
})

test("links resolve to existing ids, no self-links, de-duplicated, sorted", () => {
  const g = buildGraphData(index)
  assert.equal(g.v, 2)
  const ids = g.nodes.map((n) => n.id)
  assert.deepEqual(
    g.links.map(([a, b]) => [ids[a], ids[b]]),
    [
      ["adr", "adr/0001-bar"],
      ["adr/0001-bar", "patterns/foo"],
      ["index", "adr"],
      ["index", "patterns/foo"],
      ["patterns/foo", "adr/0001-bar"],
    ],
  )
  assert.ok(g.links.every((l) => l.every(Number.isInteger)))
})

test("no page text is carried over", () => {
  const text = JSON.stringify(buildGraphData(index))
  assert.ok(!text.includes("BODY TEXT"))
  assert.ok(!text.includes('"content"'))
  for (const n of buildGraphData(index).nodes)
    assert.deepEqual(
      Object.keys(n).filter((k) => k !== "d"),
      ["id", "title", "section", "tags"],
    )
})

test("output is deterministic regardless of key order", () => {
  const reversed = Object.fromEntries(Object.entries(index).reverse())
  assert.equal(JSON.stringify(buildGraphData(index)), JSON.stringify(buildGraphData(reversed)))
})

test("SECTIONS matches local-plugins/top-bar/sections.ts", () => {
  const src = fs.readFileSync("local-plugins/top-bar/sections.ts", "utf8")
  const folders = [...src.matchAll(/folder:\s*"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(SECTIONS, folders)
})

test("a built contentIndex.json, when present, gives a small graph", (t) => {
  const file = "public/static/contentIndex.json"
  if (!fs.existsSync(file)) return t.skip("no build output")
  const g = buildGraphData(JSON.parse(fs.readFileSync(file, "utf8")))
  assert.ok(g.nodes.length >= 100)
  const text = JSON.stringify(g)
  assert.ok(text.length <= 80 * 1024, `graph.json is ${text.length} bytes`)
  assert.ok(gzipSync(text).length <= 24 * 1024)
})

test("contentIndexToData (dev fallback) agrees with buildGraphData", () => {
  const g = buildGraphData(index)
  const f = contentIndexToData(index, SECTIONS)
  assert.deepEqual(f.nodes, g.nodes)
  const ids = g.nodes.map((n) => n.id)
  assert.deepEqual(
    f.links,
    g.links.map(([a, b]) => [ids[a], ids[b]]),
  )
  assert.ok(f.links.some(([a, b]) => a === "adr/0001-bar" && b === "patterns/foo"))
})
