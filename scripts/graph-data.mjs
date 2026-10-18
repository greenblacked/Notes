// Builds the slim graph index (public/static/graph.json) from Quartz's contentIndex.json.
// Pure function, no I/O, so it is unit-tested and shared by scripts/postprocess-build.mjs.
//
// Output: { v: 2, nodes: [{ id, title, section, tags, d? }], links: [[from, to]] }
//   id       the slug without a trailing "/index" ("index" stays "index")
//   d        1 only on folder index notes (the slug ended in "/index"): they live at "<id>/"
//   section  the first slug segment when it is one of SECTIONS, otherwise "other"
//   links    directed pairs of indices into nodes (which are sorted by id), no self-links,
//            de-duplicated, sorted; decodeGraphData() in graph-model.mjs turns them back into ids
// There is no page text: the file stays a small fraction of contentIndex.json.

import { isFolderSlug, simplifySlug } from "../local-plugins/graph-launcher/scripts/graph-model.mjs"

// Keep in step with local-plugins/top-bar/sections.ts (graph-data.test.mjs compares the two).
export const SECTIONS = [
  "adr",
  "architecture",
  "patterns",
  "tools",
  "runbooks",
  "compliance",
  "ai",
  "management",
  "standards",
  "learn",
]

export { simplifySlug, isFolderSlug }

/**
 * @param {Record<string, {title?: string, links?: string[], tags?: string[]}>} contentIndex
 * @param {string[]} [sections]
 */
export function buildGraphData(contentIndex, sections = SECTIONS) {
  const known = new Set(sections)
  const nodes = []
  for (const key of Object.keys(contentIndex)) {
    if (key.startsWith("tags/")) continue
    const entry = contentIndex[key] ?? {}
    const id = simplifySlug(key)
    const first = id.split("/")[0]
    const node = {
      id,
      title: typeof entry.title === "string" && entry.title ? entry.title : id,
      section: known.has(first) ? first : "other",
      tags: [...new Set(Array.isArray(entry.tags) ? entry.tags.map(String) : [])].sort(),
    }
    if (isFolderSlug(key)) node.d = 1
    nodes.push(node)
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ids = new Set(nodes.map((n) => n.id))

  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const pairs = new Set()
  for (const key of Object.keys(contentIndex)) {
    if (key.startsWith("tags/")) continue
    const from = simplifySlug(key)
    for (const target of contentIndex[key]?.links ?? []) {
      const to = simplifySlug(target)
      if (to !== from && ids.has(to)) pairs.add(JSON.stringify([index.get(from), index.get(to)]))
    }
  }
  const links = [...pairs].map((p) => JSON.parse(p))
  links.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]))
  return { v: 2, nodes, links }
}
