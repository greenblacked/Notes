import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_SETTINGS,
  applyFilters,
  linkClickCloses,
  buildModel,
  contentIndexToData,
  decodeGraphData,
  depthToSlider,
  fitTransform,
  groupByHops,
  groupBySection,
  neighbourhood,
  placeLabels,
  radius,
  sanitizeSettings,
  sliderToDepth,
  truncateLabel,
} from "../local-plugins/graph-launcher/scripts/graph-model.mjs"

// a - b - c - d is a chain; e links nowhere (an orphan). a and d share the tag "x".
const note = (id, section, tags = []) => ({ id, title: id.toUpperCase(), section, tags })
const data = {
  v: 1,
  nodes: [
    note("a", "patterns", ["x"]),
    note("b", "patterns"),
    note("c", "adr"),
    note("d", "tools", ["x", "y"]),
    note("e", "other"),
  ],
  links: [
    ["a", "b"],
    ["b", "a"],
    ["b", "c"],
    ["c", "d"],
    ["d", "d"],
    ["a", "missing"],
  ],
}
const ids = (view) =>
  view.nodes
    .map((n) => n.id)
    .sort()
    .join(",")

test("model: degree counts unique neighbours in both directions, no self or dangling links", () => {
  const m = buildModel(data)
  assert.equal(m.degree.get("a"), 1)
  assert.equal(m.degree.get("b"), 2)
  assert.equal(m.degree.get("d"), 1)
  assert.equal(m.degree.get("e"), 0)
  assert.equal(m.linkCount, 3)
  assert.equal(m.noteCount, 5)
})

test("model: tag nodes exist only when tags are on", () => {
  assert.ok(!buildModel(data).byId.has("tag:x"))
  const m = buildModel(data, { tags: true })
  assert.equal(m.byId.get("tag:x").uses, 2)
  assert.equal(m.byId.get("tag:y").kind, "tag")
  assert.equal(m.linkCount, 3)
})

test("depth 1 and 2 are undirected BFS hops from the centre", () => {
  const m = buildModel(data)
  const one = neighbourhood(m, "b", 1)
  assert.equal(ids(one), "a,b,c")
  assert.equal(one.hops.get("b"), 0)
  assert.equal(one.hops.get("a"), 1)
  assert.equal(ids(neighbourhood(m, "a", 2)), "a,b,c")
  assert.equal(ids(neighbourhood(m, "a", 3)), "a,b,c,d")
  assert.equal(one.fellBack, false)
})

test("depth all returns every note, orphans included", () => {
  const view = neighbourhood(buildModel(data), "a", "all")
  assert.equal(ids(view), "a,b,c,d,e")
  assert.equal(view.fellBack, false)
})

test("tags are never a hop", () => {
  const m = buildModel(data, { tags: true })
  // a and d share a tag, but only the note links connect them.
  const view = neighbourhood(m, "a", 1)
  assert.deepEqual(
    view.nodes
      .filter((n) => n.kind === "note")
      .map((n) => n.id)
      .sort(),
    ["a", "b"],
  )
  // The tag nodes of the visible notes come along: x (from a), not y (only on d).
  assert.deepEqual(
    view.nodes.filter((n) => n.kind === "tag").map((n) => n.id),
    ["tag:x"],
  )
  assert.ok(view.links.every((l) => view.nodes.some((n) => n.id === l.target)))
})

test("a centre that is not a node falls back to all notes", () => {
  const view = neighbourhood(buildModel(data), "tags/x", 2)
  assert.equal(view.fellBack, true)
  assert.equal(view.centre, null)
  assert.equal(ids(view), "a,b,c,d,e")
})

test("filters: orphans drop unless they are the centre", () => {
  const m = buildModel(data)
  const all = neighbourhood(m, "a", "all")
  assert.equal(ids(applyFilters(all, m, { orphans: false })), "a,b,c,d")
  assert.equal(ids(applyFilters(all, m, { orphans: true })), "a,b,c,d,e")
  const fromOrphan = neighbourhood(m, "e", "all")
  assert.equal(ids(applyFilters(fromOrphan, m, { orphans: false })), "a,b,c,d,e")
})

test("filters: hidden sections drop, the centre stays, links follow", () => {
  const m = buildModel(data)
  const view = neighbourhood(m, "a", "all")
  const out = applyFilters(view, m, { hiddenSections: ["patterns", "adr"] })
  assert.equal(ids(out), "a,d,e")
  assert.equal(out.links.length, 0)
  const noCentre = applyFilters(neighbourhood(m, "c", "all"), m, { hiddenSections: ["adr"] })
  assert.ok(noCentre.nodes.some((n) => n.id === "c"))
})

test("filters: tags hide with the tag section and vanish when no note shows them", () => {
  const m = buildModel(data, { tags: true })
  const view = neighbourhood(m, "a", "all")
  assert.equal(view.nodes.filter((n) => n.kind === "tag").length, 2)
  assert.equal(
    applyFilters(view, m, { hiddenSections: ["tag"] }).nodes.filter((n) => n.kind === "tag").length,
    0,
  )
  const noTools = applyFilters(view, m, { hiddenSections: ["tools"] })
  assert.deepEqual(
    noTools.nodes.filter((n) => n.kind === "tag").map((n) => n.id),
    ["tag:x"],
  )
})

test("filters: the query only reports matches, case-insensitively, on title or id", () => {
  const m = buildModel({
    ...data,
    nodes: [
      ...data.nodes,
      { id: "patterns/terraform-modules", title: "Modules", section: "patterns", tags: [] },
    ],
  })
  const view = neighbourhood(m, "a", "all")
  const out = applyFilters(view, m, { query: "TERRAFORM" })
  assert.equal(out.nodes.length, view.nodes.length)
  assert.deepEqual([...out.matches], ["patterns/terraform-modules"])
  assert.deepEqual([...applyFilters(view, m, { query: "b" }).matches].sort(), ["b"])
  assert.equal(applyFilters(view, m, { query: "  " }).matches.size, 0)
})

test("contentIndexToData: slugs, sections, tag pages and links", () => {
  const index = {
    index: { title: "Home", links: ["patterns/foo", "tags/x"], tags: [] },
    "patterns/index": { title: "Patterns", links: [], tags: [] },
    "patterns/foo": { title: "Foo", links: ["patterns", "patterns/foo", "nope"], tags: ["x"] },
    "tags/x": { title: "x", links: [], tags: [] },
    "misc/bar": { title: "Bar", links: [], tags: [] },
  }
  const d = contentIndexToData(index, ["patterns"])
  assert.deepEqual(
    d.nodes.map((n) => [n.id, n.section]),
    [
      ["index", "other"],
      ["misc/bar", "other"],
      ["patterns", "patterns"],
      ["patterns/foo", "patterns"],
    ],
  )
  assert.deepEqual(d.links, [
    ["index", "patterns/foo"],
    ["patterns/foo", "patterns"],
  ])
})

test("settings: defaults, valid values and bad input", () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(sanitizeSettings("{not json"), DEFAULT_SETTINGS)
  assert.deepEqual(sanitizeSettings("[1]"), DEFAULT_SETTINGS)
  const ok = {
    v: 1,
    localDepth: 3,
    fullDepth: 2,
    tags: true,
    orphans: false,
    hidden: ["adr", "tag"],
  }
  assert.deepEqual(sanitizeSettings(JSON.stringify(ok)), ok)
  assert.equal(sanitizeSettings({ localDepth: "all" }).localDepth, "all")
})

test("settings: out-of-range and wrong-typed fields fall back one by one", () => {
  const s = sanitizeSettings({
    localDepth: 9,
    fullDepth: 0,
    tags: "yes",
    orphans: 1,
    hidden: ["adr", "adr", 7, "Bad Name", "../x"],
  })
  assert.equal(s.localDepth, DEFAULT_SETTINGS.localDepth)
  assert.equal(s.fullDepth, DEFAULT_SETTINGS.fullDepth)
  assert.equal(s.tags, false)
  assert.equal(s.orphans, true)
  assert.deepEqual(s.hidden, ["adr"])
  assert.equal(sanitizeSettings({ localDepth: 2.5 }).localDepth, 1)
})

test("slider: 6 is All", () => {
  assert.equal(sliderToDepth("6"), "all")
  assert.equal(sliderToDepth("3"), 3)
  assert.equal(sliderToDepth("junk"), 1)
  assert.equal(depthToSlider("all"), 6)
  assert.equal(depthToSlider(2), 2)
})

test("radius, label and fit helpers", () => {
  const m = buildModel(data, { tags: true })
  assert.equal(radius(m.byId.get("e"), 0, false), 3)
  assert.equal(radius(m.byId.get("e"), 0, true), 5)
  assert.equal(radius(m.byId.get("a"), 10000, false), 14)
  assert.ok(Math.abs(radius(m.byId.get("tag:x"), 2, false) - (2 + Math.sqrt(2))) < 1e-9)
  assert.equal(truncateLabel("short"), "short")
  assert.equal(truncateLabel("x".repeat(40)).length, 28)
  assert.ok(truncateLabel("x".repeat(40)).endsWith("…"))
  const t = fitTransform({ x0: -100, y0: -50, x1: 100, y1: 50 }, 400, 300, 24)
  assert.ok(Math.abs(t.k - 1.76) < 1e-9)
  assert.ok(Math.abs(t.x - 200) < 1e-9)
  assert.ok(Math.abs(0 * t.k + t.y - 150) < 1e-9)
  assert.equal(fitTransform({ x0: 0, y0: 0, x1: 0, y1: 0 }, 100, 100).k, 6)
})

test("placeLabels keeps the first of two overlapping boxes", () => {
  const kept = placeLabels([
    { id: 1, x: 0, y: 0, w: 50, h: 12 },
    { id: 2, x: 40, y: 5, w: 50, h: 12 },
    { id: 3, x: 60, y: 5, w: 50, h: 12 },
  ])
  assert.deepEqual(
    kept.map((k) => k.id),
    [1, 3],
  )
})

test("list groupings: by hop count and by section", () => {
  const m = buildModel(data)
  const view = neighbourhood(m, "b", 2)
  const hops = groupByHops(view)
  assert.deepEqual(
    hops.map((g) => [g.hop, g.items.map((n) => n.id)]),
    [
      [0, ["b"]],
      [1, ["a", "c"]],
      [2, ["d"]],
    ],
  )
  const secs = groupBySection(neighbourhood(m, "b", "all"), ["adr", "patterns", "tools"])
  assert.deepEqual(
    secs.map((g) => g.section),
    ["adr", "patterns", "tools", "other"],
  )
})

test("decodeGraphData: v 2 index pairs become id pairs, anything else is null", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }]
  assert.deepEqual(
    decodeGraphData({
      v: 2,
      nodes,
      links: [
        [0, 1],
        [2, 0],
        [0, 9],
      ],
    }).links,
    [
      ["a", "b"],
      ["c", "a"],
    ],
  )
  assert.equal(decodeGraphData({ v: 1, nodes, links: [] }), null)
  assert.equal(decodeGraphData({ v: 2, nodes }), null)
  assert.equal(decodeGraphData(null), null)
})

test("filters: searching is true for any non-empty query, even with zero matches", () => {
  const m = buildModel(data)
  const view = neighbourhood(m, "a", "all")
  assert.equal(applyFilters(view, m, {}).searching, false)
  assert.equal(applyFilters(view, m, { query: "   " }).searching, false)
  const none = applyFilters(view, m, { query: "zzzzqq" })
  assert.equal(none.searching, true)
  assert.equal(none.matches.size, 0)
})

test("link clicks close only on plain primary clicks on a note link", () => {
  assert.equal(linkClickCloses({ onLink: true }), true)
  assert.equal(linkClickCloses({ onLink: true, button: 0 }), true)
  assert.equal(linkClickCloses({ onLink: false }), false)
  assert.equal(linkClickCloses({ onLink: true, ctrlKey: true }), false)
  assert.equal(linkClickCloses({ onLink: true, metaKey: true }), false)
  assert.equal(linkClickCloses({ onLink: true, shiftKey: true }), false)
  assert.equal(linkClickCloses({ onLink: true, button: 1 }), false)
})
