// The pure part of the graph: data in, views out. No DOM, so node:test covers it
// (scripts/graph-model.test.mjs). graph.inline.ts draws what this module computes.

/**
 * @typedef {{ id: string, title: string, section: string, tags: string[] }} NoteData
 * @typedef {{ v: number, nodes: NoteData[], links: [string, string][] }} GraphData
 * @typedef {{ id: string, title: string, section: string, kind: "note" | "tag", tags: string[], uses: number }} GraphNode
 * @typedef {{ source: string, target: string, kind: "link" | "tag" }} GraphLink
 * @typedef {{ nodes: GraphNode[], links: GraphLink[], degree: Map<string, number>, adj: Map<string, Set<string>>, byId: Map<string, GraphNode>, noteCount: number, linkCount: number }} Model
 * @typedef {{ nodes: GraphNode[], links: GraphLink[], centre: string | null, hops: Map<string, number>, fellBack: boolean }} View
 * @typedef {{ v: 1, localDepth: number | "all", fullDepth: number | "all", tags: boolean, orphans: boolean, hidden: string[] }} Settings
 */

export const SETTINGS_KEY = "notes.graph.v1"
export const MAX_DEPTH = 5
export const TAG_PREFIX = "tag:"
export const OTHER_SECTION = "other"
export const TAG_SECTION = "tag"

/** @type {Settings} */
export const DEFAULT_SETTINGS = Object.freeze({
  v: 1,
  localDepth: 1,
  fullDepth: "all",
  tags: false,
  orphans: true,
  hidden: Object.freeze([]),
})

/** The slug rule of the content index: a trailing "/index" goes, "index" stays. */
export function simplifySlug(slug) {
  const s = String(slug).replace(/\/index$/, "")
  return s === "" ? "index" : s
}

/**
 * Turns graph.json (v 2: links are pairs of indices into nodes) into the in-memory shape, links
 * as pairs of ids. Null when the data is not v 2.
 * @param {any} data
 * @returns {GraphData | null}
 */
export function decodeGraphData(data) {
  if (!data || data.v !== 2 || !Array.isArray(data.nodes) || !Array.isArray(data.links)) return null
  /** @type {[string, string][]} */
  const links = []
  for (const l of data.links) {
    const a = data.nodes[l?.[0]]
    const b = data.nodes[l?.[1]]
    if (a && b) links.push([a.id, b.id])
  }
  return { v: 2, nodes: data.nodes, links }
}

/**
 * Converts contentIndex.json (the fallback when graph.json is missing, e.g. on the dev server) to
 * the shape of graph.json.
 * @param {Record<string, any>} index
 * @param {string[]} folders the section folders
 * @returns {GraphData}
 */
export function contentIndexToData(index, folders) {
  const keys = Object.keys(index ?? {})
    .filter((k) => !k.startsWith("tags/"))
    .sort()
  const ids = new Set(keys.map(simplifySlug))
  const nodes = keys.map((k) => {
    const entry = index[k] ?? {}
    const id = simplifySlug(k)
    const first = id.split("/")[0]
    return {
      id,
      title: String(entry.title ?? id),
      section: folders.includes(first) ? first : OTHER_SECTION,
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
    }
  })
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const seen = new Set()
  /** @type {[string, string][]} */
  const links = []
  for (const k of keys) {
    const from = simplifySlug(k)
    for (const raw of index[k]?.links ?? []) {
      const to = simplifySlug(raw)
      if (to === from || !ids.has(to)) continue
      const key = `${from}\u0000${to}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push([from, to])
    }
  }
  links.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  )
  return { v: 2, nodes, links }
}

/**
 * @param {GraphData} data
 * @param {{ tags?: boolean }} [opts]
 * @returns {Model}
 */
export function buildModel(data, opts = {}) {
  const withTags = !!opts.tags
  /** @type {Map<string, GraphNode>} */
  const byId = new Map()
  /** @type {GraphNode[]} */
  const nodes = []
  for (const n of data.nodes) {
    if (byId.has(n.id)) continue
    const node = {
      id: n.id,
      title: n.title || n.id,
      section: n.section || OTHER_SECTION,
      kind: /** @type {const} */ ("note"),
      tags: Array.isArray(n.tags) ? n.tags : [],
      uses: 0,
    }
    byId.set(node.id, node)
    nodes.push(node)
  }
  /** @type {Map<string, Set<string>>} */
  const adj = new Map(nodes.map((n) => [n.id, new Set()]))
  /** @type {GraphLink[]} */
  const links = []
  // One drawn link per pair of notes: a reverse pair (A links B, B links A) is the same edge.
  for (const [a, b] of data.links) {
    if (a === b || !adj.has(a) || !adj.has(b) || adj.get(a).has(b)) continue
    adj.get(a).add(b)
    adj.get(b).add(a)
    links.push({ source: a, target: b, kind: "link" })
  }
  const noteLinks = links.length
  /** @type {Map<string, number>} */
  const degree = new Map(nodes.map((n) => [n.id, adj.get(n.id).size]))

  if (withTags) {
    /** @type {Map<string, GraphNode>} */
    const tagNodes = new Map()
    for (const n of [...nodes]) {
      for (const t of n.tags) {
        const id = TAG_PREFIX + t
        let tag = tagNodes.get(id)
        if (!tag) {
          tag = { id, title: `#${t}`, section: TAG_SECTION, kind: "tag", tags: [], uses: 0 }
          tagNodes.set(id, tag)
        }
        tag.uses += 1
        links.push({ source: n.id, target: id, kind: "tag" })
      }
    }
    for (const tag of [...tagNodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      byId.set(tag.id, tag)
      nodes.push(tag)
      degree.set(tag.id, tag.uses)
    }
  }
  return {
    nodes,
    links,
    degree,
    adj,
    byId,
    noteCount: data.nodes.length,
    linkCount: noteLinks,
  }
}

/**
 * The notes within `depth` hops of the centre (undirected, note links only: a tag is never a hop),
 * or every note for "all". Tag nodes of the visible notes are added afterwards.
 * @param {Model} model
 * @param {string | null} centreId
 * @param {number | "all"} depth
 * @returns {View}
 */
export function neighbourhood(model, centreId, depth) {
  const centreKnown = centreId != null && model.adj.has(centreId)
  const all = depth === "all"
  const fellBack = !all && !centreKnown
  /** @type {Map<string, number>} */
  const hops = new Map()
  if (all || fellBack) {
    for (const n of model.nodes) if (n.kind === "note") hops.set(n.id, 0)
    if (centreKnown) {
      hops.clear()
      bfs(model, /** @type {string} */ (centreId), Infinity, hops)
      // Notes the centre cannot reach (other components, orphans) get no hop count.
      for (const n of model.nodes) if (n.kind === "note" && !hops.has(n.id)) hops.set(n.id, -1)
    }
  } else {
    bfs(model, /** @type {string} */ (centreId), Math.max(1, Math.min(MAX_DEPTH, depth)), hops)
  }
  const nodes = model.nodes.filter((n) => n.kind === "note" && hops.has(n.id))
  const visible = new Set(nodes.map((n) => n.id))
  /** @type {GraphLink[]} */
  const links = []
  const tagIds = new Set()
  for (const l of model.links) {
    if (l.kind === "link") {
      if (visible.has(l.source) && visible.has(l.target)) links.push(l)
    } else if (visible.has(l.source)) {
      links.push(l)
      tagIds.add(l.target)
    }
  }
  for (const n of model.nodes) if (n.kind === "tag" && tagIds.has(n.id)) nodes.push(n)
  return { nodes, links, centre: centreKnown ? centreId : null, hops, fellBack }
}

function bfs(model, start, maxDepth, hops) {
  hops.set(start, 0)
  let frontier = [start]
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next = []
    for (const id of frontier) {
      for (const nb of model.adj.get(id) ?? []) {
        if (hops.has(nb)) continue
        hops.set(nb, d)
        next.push(nb)
      }
    }
    frontier = next
  }
}

/**
 * Drops orphans and hidden sections (never the centre) and finds the search matches. The query
 * does not remove anything: the renderer dims what does not match.
 * @param {View} view
 * @param {Model} model
 * @param {{ orphans?: boolean, hiddenSections?: Iterable<string>, query?: string }} opts
 * @returns {View & { matches: Set<string>, searching: boolean }}
 */
export function applyFilters(view, model, opts = {}) {
  const orphans = opts.orphans !== false
  const hidden = new Set(opts.hiddenSections ?? [])
  const query = String(opts.query ?? "")
    .trim()
    .toLowerCase()
  const keep = (n) => {
    if (n.id === view.centre) return true
    if (hidden.has(n.section)) return false
    if (n.kind === "note" && !orphans && (model.degree.get(n.id) ?? 0) === 0) return false
    return true
  }
  let nodes = view.nodes.filter(keep)
  let ids = new Set(nodes.map((n) => n.id))
  let links = view.links.filter((l) => ids.has(l.source) && ids.has(l.target))
  // A tag whose notes are all gone has nothing to show.
  const used = new Set()
  for (const l of links) if (l.kind === "tag") used.add(l.target)
  nodes = nodes.filter((n) => n.kind !== "tag" || used.has(n.id))
  ids = new Set(nodes.map((n) => n.id))
  links = links.filter((l) => ids.has(l.source) && ids.has(l.target))
  const matches = new Set()
  if (query) {
    for (const n of nodes) {
      if (n.title.toLowerCase().includes(query) || n.id.toLowerCase().includes(query))
        matches.add(n.id)
    }
  }
  return { ...view, nodes, links, matches, searching: query !== "" }
}

/**
 * Whether a click should close the dialog: only a plain primary click on a note link (list or selection bar).
 * Headings, padding, text selection and modified clicks (new tab or window) keep it open.
 * @param {{ onLink: boolean, button?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }} c
 */
export function linkClickCloses(c) {
  if (!c.onLink) return false
  if ((c.button ?? 0) !== 0) return false
  return !(c.ctrlKey || c.metaKey || c.shiftKey || c.altKey)
}

/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Node radius in CSS px at zoom 1. @param {GraphNode} node @param {number} degree @param {boolean} isCentre */
export function radius(node, degree, isCentre) {
  if (node.kind === "tag") return clamp(2 + Math.sqrt(node.uses || degree), 3, 8)
  return clamp(3 + 1.6 * Math.sqrt(degree), 3, 14) + (isCentre ? 2 : 0)
}

/** @param {string} title @param {number} [max] */
export function truncateLabel(title, max = 28) {
  const t = String(title)
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…"
}

/**
 * The transform that frames bounds in a w x h box.
 * @param {{ x0: number, y0: number, x1: number, y1: number }} b
 * @returns {{ k: number, x: number, y: number }}
 */
export function fitTransform(b, w, h, pad = 24, minK = 0.2, maxK = 6) {
  const bw = Math.max(b.x1 - b.x0, 1)
  const bh = Math.max(b.y1 - b.y0, 1)
  const k = clamp(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh), minK, maxK)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return { k, x: w / 2 - cx * k, y: h / 2 - cy * k }
}

/**
 * Greedy label placement: candidates in priority order, a label whose box overlaps an earlier
 * kept one is dropped. Boxes are { x, y, w, h } on screen.
 * @template {{ x: number, y: number, w: number, h: number }} T
 * @param {T[]} candidates sorted, most important first
 * @returns {T[]}
 */
export function placeLabels(candidates) {
  /** @type {T[]} */
  const kept = []
  for (const c of candidates) {
    const clash = kept.some(
      (k) => c.x < k.x + k.w && k.x < c.x + c.w && c.y < k.y + k.h && k.y < c.y + c.h,
    )
    if (!clash) kept.push(c)
  }
  return kept
}

/** The view's notes grouped by hop count (0 is the centre), for the note panel's list. @param {View} view */
export function groupByHops(view) {
  /** @type {Map<number, GraphNode[]>} */
  const groups = new Map()
  for (const n of view.nodes) {
    if (n.kind !== "note") continue
    const h = view.hops.get(n.id) ?? -1
    if (!groups.has(h)) groups.set(h, [])
    groups.get(h).push(n)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === -1 ? 1 : b[0] === -1 ? -1 : a[0] - b[0]))
    .map(([hop, items]) => ({ hop, items: items.sort(byTitle) }))
}

/** The view's notes grouped by section, alphabetical. @param {View} view @param {string[]} order */
export function groupBySection(view, order) {
  /** @type {Map<string, GraphNode[]>} */
  const groups = new Map()
  for (const n of view.nodes) {
    if (n.kind !== "note") continue
    if (!groups.has(n.section)) groups.set(n.section, [])
    groups.get(n.section).push(n)
  }
  const rank = (s) => {
    const i = order.indexOf(s)
    return i === -1 ? order.length : i
  }
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([section, items]) => ({ section, items: items.sort(byTitle) }))
}

const byTitle = (a, b) => a.title.localeCompare(b.title, "en")

/** The slider value of a depth (6 is "All") and back. */
export const depthToSlider = (d) => (d === "all" ? MAX_DEPTH + 1 : d)
export const sliderToDepth = (v) => {
  const n = Math.round(Number(v))
  return n > MAX_DEPTH ? "all" : clamp(Number.isFinite(n) ? n : 1, 1, MAX_DEPTH)
}

/** @param {unknown} d @param {number | "all"} fallback */
function validDepth(d, fallback) {
  if (d === "all") return "all"
  if (typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= MAX_DEPTH) return d
  return fallback
}

/**
 * Settings from whatever is stored: every field is validated, anything invalid is the default.
 * @param {unknown} raw an object, or the stored JSON text
 * @returns {Settings}
 */
export function sanitizeSettings(raw) {
  let obj = raw
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = null
    }
  }
  const o = obj && typeof obj === "object" && !Array.isArray(obj) ? /** @type {any} */ (obj) : {}
  const hidden = Array.isArray(o.hidden)
    ? [
        ...new Set(o.hidden.filter((s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s))),
      ].slice(0, 20)
    : []
  return {
    v: 1,
    localDepth: validDepth(o.localDepth, DEFAULT_SETTINGS.localDepth),
    fullDepth: validDepth(o.fullDepth, DEFAULT_SETTINGS.fullDepth),
    tags: typeof o.tags === "boolean" ? o.tags : DEFAULT_SETTINGS.tags,
    orphans: typeof o.orphans === "boolean" ? o.orphans : DEFAULT_SETTINGS.orphans,
    hidden,
  }
}
