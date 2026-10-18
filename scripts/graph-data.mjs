// Builds the slim graph index (public/static/graph.json) from Quartz's contentIndex.json.
// Pure function, no I/O, so it is unit-tested and shared by scripts/postprocess-build.mjs.
//
// Output: { v: 1, nodes: [{ id, title, section, tags }], links: [[from, to]] }
//   id       the slug without a trailing "/index" ("index" stays "index")
//   section  the first slug segment when it is one of SECTIONS, otherwise "other"
//   links    directed, resolved to existing node ids, no self-links, de-duplicated, sorted
// There is no page text: the file stays a small fraction of contentIndex.json.

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

/** The plugin's simplifySlug rule: drop a trailing "/index"; "index" stays "index". */
export function simplifySlug(slug) {
  const s = String(slug).split("#")[0]
  return s.endsWith("/index") ? s.slice(0, -"/index".length) : s
}

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
    nodes.push({
      id,
      title: typeof entry.title === "string" && entry.title ? entry.title : id,
      section: known.has(first) ? first : "other",
      tags: [...new Set(Array.isArray(entry.tags) ? entry.tags.map(String) : [])].sort(),
    })
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ids = new Set(nodes.map((n) => n.id))

  const pairs = new Set()
  for (const key of Object.keys(contentIndex)) {
    if (key.startsWith("tags/")) continue
    const from = simplifySlug(key)
    for (const target of contentIndex[key]?.links ?? []) {
      const to = simplifySlug(target)
      if (to !== from && ids.has(to)) pairs.add(JSON.stringify([from, to]))
    }
  }
  const links = [...pairs].map((p) => JSON.parse(p))
  links.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  )
  return { v: 1, nodes, links }
}
