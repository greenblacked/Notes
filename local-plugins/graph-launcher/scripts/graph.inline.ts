// The graph: the full-screen dialog of every note (toolbar button, Ctrl/Cmd+G) and the local graph
// at the end of a note (local-plugins/note-graph, markup only). One script drives both, bundled
// into postscript.js with a tree-shaken subset of d3. What is shown is computed by the pure
// graph-model.mjs (unit tested); this file draws it on a Canvas 2D, on demand: a frame is only
// drawn after a simulation tick, a zoom or pan, a hover, a resize or a filter change, so an idle
// graph costs nothing. Everything is same-origin and needs no eval, worker or blob, so the CSP
// of the site is unchanged. Runs once per page load; the parts that touch the page are set up on
// every SPA navigation ("nav") and torn down by window.addCleanup.

import {
  drag,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  pointer,
  select,
  zoom,
  zoomIdentity,
} from "d3"
import {
  OTHER_SECTION,
  SETTINGS_KEY,
  TAG_SECTION,
  applyFilters,
  buildModel,
  contentIndexToData,
  depthToSlider,
  fitTransform,
  groupByHops,
  groupBySection,
  neighbourhood,
  placeLabels,
  radius,
  sanitizeSettings,
  simplifySlug,
  sliderToDepth,
  truncateLabel,
} from "./graph-model.mjs"

// --- Types ----------------------------------------------------------------------------------------
import type {
  Depth,
  FilteredView as ViewData,
  GNode,
  GraphData,
  Model,
  Settings,
  View,
} from "./graph-model.mjs"
interface SimNode {
  id: string
  node: GNode
  r: number
  deg: number
  x: number
  y: number
  fx?: number | null
  fy?: number | null
}
interface SimLink {
  source: SimNode
  target: SimNode
  kind: "link" | "tag"
}
interface SectionInfo {
  folder: string
  label: string
}
type Mode = "panel" | "dialog"
interface Palette {
  colours: Map<string, string>
  link: string
  dark: string
  secondary: string
  bg: string
  font: string
}

const SELECTION_HOLD_MS = 500
const FIT_PAD = 24
const FIT_MAX_K = 2.5

// --- Shared state of the page load -------------------------------------------------------------
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
let reduced = reducedQuery.matches
const onReducedChange = (e: MediaQueryListEvent) => (reduced = e.matches)
if (reducedQuery.addEventListener) reducedQuery.addEventListener("change", onReducedChange)
else reducedQuery.addListener?.(onReducedChange)

function readSettings(): Settings {
  try {
    return sanitizeSettings(localStorage.getItem(SETTINGS_KEY))
  } catch {
    return sanitizeSettings(null)
  }
}
let settings: Settings = readSettings()
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage is blocked or full: the settings simply do not persist.
  }
}

// The relative path to the site root, from the slug of the current page.
function siteRoot(): string {
  const slug = document.body.dataset.slug ?? "index"
  const depth = slug.split("/").length - 1
  return depth > 0 ? "../".repeat(depth) : "./"
}

let sections: SectionInfo[] = []
const folders = () => sections.map((s) => s.folder)
const sectionLabel = (key: string) =>
  key === OTHER_SECTION
    ? "Other"
    : key === TAG_SECTION
      ? "Tags"
      : (sections.find((s) => s.folder === key)?.label ?? key)

let dataPromise: Promise<GraphData> | null = null
function loadData(): Promise<GraphData> {
  dataPromise ??= fetchData().catch((err) => {
    dataPromise = null
    throw err
  })
  return dataPromise
}
async function fetchData(): Promise<GraphData> {
  const base = siteRoot()
  try {
    const res = await fetch(`${base}static/graph.json`)
    if (res.ok) {
      const data = await res.json()
      if (data && data.v === 1 && Array.isArray(data.nodes) && Array.isArray(data.links))
        return data
    }
  } catch {
    // Fall through to the content index (the dev server does not build graph.json).
  }
  const res = await fetch(`${base}static/contentIndex.json`)
  if (!res.ok) throw new Error(`graph data: HTTP ${res.status}`)
  return contentIndexToData(await res.json(), folders())
}

const models = new Map<boolean, Model>()
function modelFor(data: GraphData, tags: boolean): Model {
  let m = models.get(tags)
  if (!m) {
    m = buildModel(data, { tags })
    models.set(tags, m)
  }
  return m
}

const currentId = () => simplifySlug(document.body.dataset.slug ?? "index")
const hrefOf = (node: GNode) => {
  const base = siteRoot()
  if (node.kind === "tag") return `${base}tags/${node.id.slice(4)}`
  return node.id === "index" ? base : `${base}${node.id}`
}

function navigate(href: string) {
  const url = new URL(href, location.href)
  const go = (window as any).spaNavigate
  if (typeof go === "function") go(url)
  else location.assign(url.href)
}

const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`
const depthText = (d: Depth) => (d === "all" ? "All" : String(d))

function readPalette(mode: Mode): Palette {
  const cs = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  const colours = new Map<string, string>()
  for (const key of [...folders(), OTHER_SECTION, TAG_SECTION])
    colours.set(key, get(`--graph-${key}`, get("--dark", "#333")))
  return {
    colours,
    link: get("--graph-link", "#999"),
    dark: get("--dark", "#222"),
    secondary: get("--secondary", "#555"),
    bg: get(mode === "dialog" ? "--light" : "--surface", "#fff"),
    font: get("--ui", "system-ui, sans-serif"),
  }
}

function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

const liveViews = new Set<GraphView>()
let openDialog: (() => void) | null = null

// --- One graph view (the panel at the end of a note, or the dialog) ------------------------------
interface ViewOptions {
  mode: Mode
  root: HTMLElement
  data: GraphData
  positions: Map<string, { x: number; y: number }>
}

class GraphView {
  readonly mode: Mode
  readonly root: HTMLElement
  private data: GraphData
  private positions: Map<string, { x: number; y: number }>
  private wrap: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private abort = new AbortController()
  private model!: Model
  private base!: View
  private view!: ViewData
  private simNodes: SimNode[] = []
  private simLinks: SimLink[] = []
  private nbr = new Map<string, string[]>()
  private topLabelled = new Set<string>()
  private sim: any = null
  private zoomBehavior: any
  private t = { x: 0, y: 0, k: 1 }
  private w = 0
  private h = 0
  private dpr = 1
  private hoverId: string | null = null
  private selectedId: string | null = null
  private hl: Set<string> | null = null
  private query = ""
  private userMoved = false
  private fitted = false
  private raf = 0
  private downAt = 0
  private lastType = "mouse"
  private dragging: SimNode | null = null
  private pal: Palette
  private ro: ResizeObserver | null = null
  private legendSig = ""
  private measureCache = new Map<string, number>()
  active = false

  constructor(opts: ViewOptions) {
    this.mode = opts.mode
    this.root = opts.root
    this.data = opts.data
    this.positions = opts.positions
    this.wrap = this.q(".graph-canvas-wrap")!
    this.pal = readPalette(this.mode)
    this.canvas = document.createElement("canvas")
    this.canvas.setAttribute("role", "img")
    this.canvas.style.touchAction = this.mode === "dialog" ? "none" : "pan-y"
    this.canvas.style.display = "block"
    this.canvas.style.width = "100%"
    this.canvas.style.height = "100%"
    this.ctx = this.canvas.getContext("2d")!
    this.wrap.replaceChildren(this.canvas, this.buildZoomButtons())
    liveViews.add(this)
    this.bindControls()
    this.bindCanvas()
    this.ro = new ResizeObserver(() => this.onResize())
    this.ro.observe(this.wrap)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) {
    return this.root.querySelector<T>(sel)
  }
  private listen<K extends keyof HTMLElementEventMap>(
    el: EventTarget | null | undefined,
    type: K | string,
    fn: (e: any) => void,
  ) {
    el?.addEventListener(type, fn, { signal: this.abort.signal })
  }

  // -- Controls -------------------------------------------------------------------------------
  private get depthKey(): "localDepth" | "fullDepth" {
    return this.mode === "panel" ? "localDepth" : "fullDepth"
  }

  private bindControls() {
    const range = this.q<HTMLInputElement>(".graph-depth input[type=range]")
    this.listen(range, "input", () => {
      settings[this.depthKey] = sliderToDepth(range!.value)
      saveSettings()
      this.syncControls()
      this.refresh(true)
    })
    const tags = this.q<HTMLInputElement>(".graph-tags-toggle")
    this.listen(tags, "change", () => {
      settings.tags = tags!.checked
      if (!settings.tags) settings.hidden = settings.hidden.filter((h) => h !== TAG_SECTION)
      saveSettings()
      broadcast()
    })
    const orphans = this.q<HTMLInputElement>(".graph-orphans-toggle")
    this.listen(orphans, "change", () => {
      settings.orphans = orphans!.checked
      saveSettings()
      broadcast()
    })
    const search = this.q<HTMLInputElement>(".graph-search input")
    this.listen(search, "input", () => {
      this.query = search!.value
      this.updateMatches()
    })
    this.listen(search, "keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      const first = [...this.view.matches][0]
      if (first) this.focusNode(first)
    })
    // The list is the text alternative: focusing a link highlights its node.
    const list = this.q(".graph-list")
    this.listen(list, "focusin", (e: FocusEvent) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("a[data-id]")?.dataset.id
      if (id) this.setHover(id)
    })
    this.listen(list, "focusout", () => this.setHover(null))
    this.listen(this.q(".graph-selection-open"), "click", () => this.afterNavigateClick())
    this.listen(this.q(".graph-list-body"), "click", () => this.afterNavigateClick())
  }

  private afterNavigateClick() {
    if (this.mode === "dialog") this.root.closest("dialog")?.close()
  }

  syncControls() {
    const depth = settings[this.depthKey]
    const range = this.q<HTMLInputElement>(".graph-depth input[type=range]")
    if (range) {
      range.value = String(depthToSlider(depth))
      range.setAttribute("aria-valuetext", depth === "all" ? "All notes" : `Depth ${depth}`)
    }
    const out = this.q(".graph-depth output")
    if (out) out.textContent = depthText(depth)
    const tags = this.q<HTMLInputElement>(".graph-tags-toggle")
    if (tags) tags.checked = settings.tags
    const orphans = this.q<HTMLInputElement>(".graph-orphans-toggle")
    if (orphans) orphans.checked = settings.orphans
  }

  private buildZoomButtons(): HTMLElement {
    const box = document.createElement("div")
    box.className = "graph-zoom"
    const mk = (text: string, label: string, fn: () => void) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = text
      b.setAttribute("aria-label", label)
      b.title = label
      this.listen(b, "click", fn)
      return b
    }
    box.append(
      mk("+", "Zoom in", () => this.zoomBy(1.5)),
      mk("−", "Zoom out", () => this.zoomBy(1 / 1.5)),
      mk("Fit", "Fit", () => {
        this.userMoved = false
        this.fit()
      }),
    )
    return box
  }

  private zoomBy(factor: number) {
    this.userMoved = true
    select(this.canvas).call(this.zoomBehavior.scaleBy, factor)
  }

  // -- Canvas events --------------------------------------------------------------------------
  private bindCanvas() {
    const canvas = this.canvas
    this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 6])
      .filter((e: Event) => {
        if ((e as MouseEvent).button) return false
        if (e.type === "dblclick") return false
        // In the note panel the page must still scroll: wheel needs Ctrl/Cmd (a pinch on a
        // trackpad sends it) and a touch needs two fingers.
        if (this.mode === "panel") {
          if (e.type === "wheel") return (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey
          if (e.type === "touchstart") return (e as TouchEvent).touches.length >= 2
        }
        return true
      })
      .on("zoom", (e: any) => {
        this.t = { x: e.transform.x, y: e.transform.y, k: e.transform.k }
        if (e.sourceEvent) this.userMoved = true
        this.requestDraw()
      })

    const dragBehavior = drag<HTMLCanvasElement, unknown>()
      .container(canvas)
      .filter((e: Event) => {
        if ((e as MouseEvent).button || (e as MouseEvent).ctrlKey) return false
        // A finger on the panel scrolls the page; nodes are dragged in the dialog.
        return this.mode === "dialog" || e.type.startsWith("mouse")
      })
      .subject((e: any) => {
        const [px, py] = pointer(e, canvas)
        const n = this.nodeAtPoint(px, py)
        return n ? { x: px, y: py, sim: n } : null
      })
      .on("start", (e: any) => {
        const n: SimNode = e.subject.sim
        this.dragging = n
        n.fx = n.x
        n.fy = n.y
        if (!reduced && this.sim) {
          if (!e.active) this.sim.alphaTarget(0.3).restart()
          this.wrap.dataset.state = "running"
        }
      })
      .on("drag", (e: any) => {
        const n: SimNode = e.subject.sim
        const [px, py] = pointer(e.sourceEvent, canvas)
        n.fx = (px - this.t.x) / this.t.k
        n.fy = (py - this.t.y) / this.t.k
        if (reduced) {
          n.x = n.fx
          n.y = n.fy
          this.requestDraw()
        }
      })
      .on("end", (e: any) => {
        const n: SimNode = e.subject.sim
        if (!e.active && this.sim && !reduced) this.sim.alphaTarget(0)
        n.fx = null
        n.fy = null
        this.dragging = null
        this.requestDraw()
      })

    select(canvas).call(dragBehavior as any)
    select(canvas).call(this.zoomBehavior).on("dblclick.zoom", null)

    this.listen(canvas, "pointerdown", (e: PointerEvent) => {
      this.downAt = performance.now()
      this.lastType = e.pointerType
    })
    this.listen(canvas, "pointermove", (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || this.dragging) return
      const rect = canvas.getBoundingClientRect()
      const n = this.nodeAtPoint(e.clientX - rect.left, e.clientY - rect.top)
      canvas.style.cursor = n ? "pointer" : ""
      this.setHover(n?.id ?? null)
    })
    this.listen(canvas, "pointerleave", () => {
      canvas.style.cursor = ""
      if (!this.dragging) this.setHover(null)
    })
    this.listen(canvas, "click", (e: MouseEvent) => {
      // d3 swallows the click that ends a drag or a pan; a long press is not a click either.
      if (performance.now() - this.downAt > SELECTION_HOLD_MS) return
      const rect = canvas.getBoundingClientRect()
      const n = this.nodeAtPoint(e.clientX - rect.left, e.clientY - rect.top)
      if (!n) return this.select(null)
      if (this.lastType === "mouse") return this.open(n.node)
      if (this.selectedId === n.id) return this.open(n.node)
      this.select(n.id)
    })
  }

  private nodeAtPoint(px: number, py: number): SimNode | null {
    if (!this.sim || this.simNodes.length === 0) return null
    const { x, y, k } = this.t
    const gx = (px - x) / k
    const gy = (py - y) / k
    const n: SimNode | undefined = this.sim.find(gx, gy, 20 / k)
    if (!n) return null
    return Math.hypot(n.x - gx, n.y - gy) <= n.r + 4 / k ? n : null
  }

  private open(node: GNode) {
    this.afterNavigateClick()
    navigate(hrefOf(node))
  }

  private setHover(id: string | null) {
    if (this.hoverId === id) return
    this.hoverId = id
    this.updateHighlight()
  }

  private select(id: string | null) {
    this.selectedId = id
    const bar = this.q(".graph-selection")
    const sn = id ? this.simNodes.find((s) => s.id === id) : null
    if (bar) {
      bar.hidden = !sn
      if (sn) {
        const text = this.q(".graph-selection-text")
        const links = sn.node.kind === "tag" ? sn.node.uses : sn.deg
        if (text)
          text.textContent = `${sn.node.title} · ${sectionLabel(sn.node.section)} · ${plural(links, "link", "links")}`
        const a = this.q<HTMLAnchorElement>(".graph-selection-open")
        if (a) a.href = hrefOf(sn.node)
      }
    }
    this.updateHighlight()
  }

  private focusNode(id: string) {
    const sn = this.simNodes.find((s) => s.id === id)
    if (!sn) return
    const k = Math.max(this.t.k, 1)
    this.userMoved = true
    select(this.canvas).call(
      this.zoomBehavior.transform,
      zoomIdentity.translate(this.w / 2 - sn.x * k, this.h / 2 - sn.y * k).scale(k),
    )
    this.select(id)
  }

  private updateHighlight() {
    const id = this.hoverId ?? this.selectedId
    if (!id || !this.nbr.has(id)) this.hl = null
    else this.hl = new Set([id, ...(this.nbr.get(id) ?? [])])
    this.requestDraw()
  }

  // -- Sizing ---------------------------------------------------------------------------------
  private measure(): boolean {
    const w = this.wrap.clientWidth
    const h = this.wrap.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (w === this.w && h === this.h && dpr === this.dpr) return false
    this.w = w
    this.h = h
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
    return true
  }

  private onResize() {
    if (!this.active) return
    const first = this.w === 0 || this.h === 0
    if (!this.measure() || this.w === 0 || this.h === 0) return
    if ((first || !this.fitted) && this.simNodes.length) {
      this.userMoved = false
      this.fit()
    } else this.requestDraw()
  }

  // -- Data to simulation ---------------------------------------------------------------------
  activate() {
    this.active = true
    this.syncControls()
    this.measure()
    this.refresh(false)
  }

  deactivate() {
    this.active = false
    this.stopSim()
    this.snapshotPositions()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private stopSim() {
    this.sim?.stop()
  }

  private snapshotPositions() {
    for (const s of this.simNodes) this.positions.set(s.id, { x: s.x, y: s.y })
  }

  refresh(reheat: boolean) {
    if (!this.active) return
    this.model = modelFor(this.data, settings.tags)
    const centre = currentId()
    const depth = settings[this.depthKey]
    this.base = neighbourhood(this.model, centre, depth)
    const filters =
      this.mode === "dialog"
        ? { orphans: settings.orphans, hiddenSections: settings.hidden, query: this.query }
        : { orphans: true, hiddenSections: [] as string[], query: "" }
    this.view = applyFilters(this.base, this.model, filters)
    const hint = this.q(".graph-hint")
    if (hint) {
      hint.hidden = !this.base.fellBack
      hint.textContent = this.base.fellBack
        ? "This page is not in the graph; showing all notes"
        : ""
    }
    if (this.selectedId && !this.view.nodes.some((n) => n.id === this.selectedId)) {
      this.selectedId = null
      const bar = this.q(".graph-selection")
      if (bar) bar.hidden = true
    }
    this.rebuildSim(reheat)
    this.renderTexts()
  }

  private seed(node: GNode, placed: Map<string, SimNode>, neighbours: string[]): [number, number] {
    const near = neighbours.map((id) => placed.get(id)).filter((p): p is SimNode => !!p)
    const jx = (hash01(node.id, 1) - 0.5) * 30
    const jy = (hash01(node.id, 2) - 0.5) * 30
    if (near.length) {
      const cx = near.reduce((s, p) => s + p.x, 0) / near.length
      const cy = near.reduce((s, p) => s + p.y, 0) / near.length
      return [cx + jx, cy + jy]
    }
    const angle = hash01(node.id, 3) * Math.PI * 2
    const dist = 40 + hash01(node.id, 4) * (this.mode === "dialog" ? 220 : 90)
    return [Math.cos(angle) * dist, Math.sin(angle) * dist]
  }

  private rebuildSim(reheat: boolean) {
    this.stopSim()
    this.snapshotPositions()
    const { view, model } = this
    const hadPositions = view.nodes.some((n) => this.positions.has(n.id))
    const adjacency = new Map<string, string[]>()
    for (const l of view.links) {
      if (!adjacency.has(l.source)) adjacency.set(l.source, [])
      if (!adjacency.has(l.target)) adjacency.set(l.target, [])
      adjacency.get(l.source)!.push(l.target)
      adjacency.get(l.target)!.push(l.source)
    }
    this.nbr = adjacency

    const byId = new Map<string, SimNode>()
    const fresh: GNode[] = []
    const nodes: SimNode[] = []
    for (const n of view.nodes) {
      const deg = model.degree.get(n.id) ?? 0
      const sn: SimNode = {
        id: n.id,
        node: n,
        deg,
        r: radius(n, deg, n.id === view.centre),
        x: 0,
        y: 0,
      }
      const p = this.positions.get(n.id)
      if (p) {
        sn.x = p.x
        sn.y = p.y
        byId.set(n.id, sn)
      } else fresh.push(n)
      nodes.push(sn)
    }
    const all = new Map(nodes.map((s) => [s.id, s]))
    // New nodes start next to a neighbour that already has a place, so a deeper view grows
    // outwards instead of jumping.
    for (let pass = 0; pass < 2; pass++) {
      for (const n of fresh) {
        const sn = all.get(n.id)!
        if (byId.has(n.id)) continue
        const [x, y] = this.seed(n, byId, adjacency.get(n.id) ?? [])
        sn.x = x
        sn.y = y
        if (pass === 1 || (adjacency.get(n.id) ?? []).some((id) => byId.has(id))) byId.set(n.id, sn)
      }
    }
    this.simNodes = nodes
    this.simLinks = view.links
      .filter((l) => all.has(l.source) && all.has(l.target))
      .map((l) => ({ source: all.get(l.source)!, target: all.get(l.target)!, kind: l.kind }))
    this.topLabelled = new Set(
      [...nodes]
        .filter((s) => s.node.kind === "note")
        .sort((a, b) => b.deg - a.deg)
        .slice(0, 12)
        .map((s) => s.id),
    )
    this.updateHighlight()

    const dialog = this.mode === "dialog"
    const sim = forceSimulation(nodes as any)
      .force(
        "link",
        forceLink(this.simLinks as any)
          .id((d: any) => d.id)
          .distance(dialog ? 40 : 50),
      )
      .force(
        "charge",
        forceManyBody()
          .strength(dialog ? -90 : -140)
          .distanceMax(400),
      )
      .force("x", forceX(0).strength(0.06))
      .force("y", forceY(0).strength(0.06))
      .force(
        "collide",
        forceCollide((d: any) => d.r + 2),
      )
      .alphaDecay(0.03)
      .stop()
    this.sim = sim
    sim.on("tick", () => this.requestDraw())
    sim.on("end", () => {
      this.wrap.dataset.state = "settled"
      if (!this.userMoved && this.active) this.fit()
      else this.requestDraw()
    })

    if (nodes.length === 0) {
      this.wrap.dataset.state = "settled"
      this.requestDraw()
      return
    }
    if (reduced) {
      // One synchronous layout, drawn once: no animated settle.
      sim.alpha(1).tick(300)
      this.finishStatic()
      return
    }
    const startFresh = !hadPositions
    sim.alpha(startFresh || !reheat ? 1 : 0.3)
    if (startFresh || (dialog && !reheat)) {
      // The first paint is already close to the final layout.
      sim.tick(80)
    }
    this.wrap.dataset.state = "running"
    if (!this.fitted || !this.userMoved) this.fit()
    sim.restart()
  }

  private finishStatic() {
    this.wrap.dataset.state = "settled"
    if (!this.userMoved) this.fit()
    else this.requestDraw()
  }

  private fit() {
    if (!this.w || !this.h) {
      this.measure()
      if (!this.w || !this.h) return
    }
    this.fitted = true
    if (this.simNodes.length === 0) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const s of this.simNodes) {
      x0 = Math.min(x0, s.x - s.r)
      y0 = Math.min(y0, s.y - s.r)
      x1 = Math.max(x1, s.x + s.r)
      y1 = Math.max(y1, s.y + s.r)
    }
    const f = fitTransform({ x0, y0, x1, y1 }, this.w, this.h, FIT_PAD, 0.2, FIT_MAX_K)
    select(this.canvas).call(
      this.zoomBehavior.transform,
      zoomIdentity.translate(f.x, f.y).scale(f.k),
    )
    this.requestDraw()
  }

  private updateMatches() {
    if (!this.view) return
    const r = applyFilters(this.view, this.model, { query: this.query })
    this.view = { ...this.view, matches: r.matches }
    const status = this.q(".graph-matches")
    if (status) status.textContent = this.query.trim() ? `${this.view.matches.size} matching` : ""
    this.requestDraw()
  }

  // -- Texts: counts, legend, list ---------------------------------------------------------------
  private renderTexts() {
    const { view } = this
    const notes = view.nodes.filter((n) => n.kind === "note").length
    const links = view.links.filter((l) => l.kind === "link").length
    const counts = `${plural(notes, "note", "notes")} · ${plural(links, "link", "links")}`
    const where =
      this.mode === "panel" && view.centre
        ? ` around ${this.model.byId.get(view.centre)?.title ?? view.centre}`
        : ""
    this.canvas.setAttribute(
      "aria-label",
      `Graph of ${plural(notes, "note", "notes")} and ${plural(links, "link", "links")}${where}. A list follows.`,
    )
    if (this.mode === "dialog") {
      const count = this.root.querySelector(".graph-count")
      if (count) count.textContent = counts
    }
    this.updateMatches()
    this.renderLegend()
    this.renderList()
  }

  private legendKeys(): string[] {
    const keys = [...folders(), OTHER_SECTION]
    if (settings.tags) keys.push(TAG_SECTION)
    return keys
  }

  private renderLegend() {
    const legend = this.q(".graph-legend")
    if (!legend) return
    const counts = new Map<string, number>()
    const baseView =
      this.mode === "dialog"
        ? applyFilters(this.base, this.model, { orphans: settings.orphans })
        : this.view
    for (const n of baseView.nodes) counts.set(n.section, (counts.get(n.section) ?? 0) + 1)

    if (this.mode === "panel") {
      legend.replaceChildren(
        ...this.legendKeys()
          .filter((k) => (counts.get(k) ?? 0) > 0)
          .map((k) => {
            const item = document.createElement("span")
            item.className = "graph-legend-item"
            item.append(swatch(k), document.createTextNode(sectionLabel(k)))
            return item
          }),
      )
      return
    }
    const keys = this.legendKeys()
    const sig = keys.join("|")
    if (sig !== this.legendSig) {
      this.legendSig = sig
      legend.replaceChildren(
        ...keys.map((k) => {
          const b = document.createElement("button")
          b.type = "button"
          b.dataset.section = k
          const label = document.createElement("span")
          label.className = "graph-legend-label"
          label.textContent = sectionLabel(k)
          const count = document.createElement("span")
          count.className = "graph-legend-count"
          b.append(swatch(k), label, count)
          b.addEventListener(
            "click",
            () => {
              const i = settings.hidden.indexOf(k)
              if (i === -1) settings.hidden = [...settings.hidden, k]
              else settings.hidden = settings.hidden.filter((h) => h !== k)
              saveSettings()
              this.refresh(true)
            },
            { signal: this.abort.signal },
          )
          return b
        }),
      )
    }
    for (const b of legend.querySelectorAll<HTMLButtonElement>("button")) {
      const k = b.dataset.section!
      b.setAttribute("aria-pressed", String(!settings.hidden.includes(k)))
      b.querySelector(".graph-legend-count")!.textContent = String(counts.get(k) ?? 0)
    }
  }

  private renderList() {
    const body = this.q(".graph-list-body")
    if (!body) return
    const groups: { heading: string; items: GNode[] }[] =
      this.mode === "panel"
        ? (groupByHops(this.view) as { hop: number; items: GNode[] }[]).map((g) => ({
            heading:
              g.hop === 0
                ? this.view.centre
                  ? "This note"
                  : "All notes"
                : g.hop === -1
                  ? "Not connected to this note"
                  : `${g.hop} ${g.hop === 1 ? "link" : "links"} away`,
            items: g.items,
          }))
        : (
            groupBySection(this.view, [...folders(), OTHER_SECTION]) as {
              section: string
              items: GNode[]
            }[]
          ).map((g) => ({ heading: sectionLabel(g.section), items: g.items }))
    const frag = document.createDocumentFragment()
    for (const g of groups) {
      const h = document.createElement("h3")
      h.textContent = g.heading
      const ul = document.createElement("ul")
      for (const n of g.items) {
        const li = document.createElement("li")
        const a = document.createElement("a")
        a.className = "internal"
        a.href = hrefOf(n)
        a.dataset.id = n.id
        a.textContent = n.title
        li.append(a)
        if (this.mode === "panel") {
          const s = document.createElement("span")
          s.className = "graph-list-section"
          s.textContent = sectionLabel(n.section)
          li.append(" ", s)
        }
        ul.append(li)
      }
      frag.append(h, ul)
    }
    body.replaceChildren(frag)
  }

  // -- Drawing --------------------------------------------------------------------------------
  recolour() {
    this.pal = readPalette(this.mode)
    this.requestDraw()
  }

  private requestDraw() {
    if (this.raf || !this.active) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.draw()
    })
  }

  private textWidth(font: string, text: string): number {
    const key = `${font}|${text}`
    let w = this.measureCache.get(key)
    if (w === undefined) {
      this.ctx.font = font
      w = this.ctx.measureText(text).width
      this.measureCache.set(key, w)
    }
    return w
  }

  private draw() {
    const { ctx, t, pal, w, h, dpr } = this
    if (!w || !h || !this.view) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const hl = this.hl
    const matches = this.view.matches.size > 0 ? this.view.matches : null
    const active = this.hoverId ?? this.selectedId

    ctx.save()
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)

    // Links, batched by look: solid and dashed (tag), each normal, dimmed or hot.
    type Bucket = { path: Path2D; alpha: number; colour: string; dash: boolean }
    const buckets = new Map<string, Bucket>()
    const bucket = (dash: boolean, alpha: number, colour: string) => {
      const key = `${dash}|${alpha}|${colour}`
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { path: new Path2D(), alpha, colour, dash }))
      return b
    }
    for (const l of this.simLinks) {
      const a = l.source
      const b = l.target
      let alpha = 0.6
      let colour = pal.link
      if (hl) {
        if (a.id === active || b.id === active) {
          alpha = 1
          colour = pal.secondary
        } else if (!(hl.has(a.id) && hl.has(b.id))) alpha = 0.12
      } else if (matches && !matches.has(a.id) && !matches.has(b.id)) alpha = 0.09
      const bk = bucket(l.kind === "tag", alpha, colour)
      bk.path.moveTo(a.x, a.y)
      bk.path.lineTo(b.x, b.y)
    }
    ctx.lineWidth = 1 / t.k
    for (const bk of buckets.values()) {
      ctx.globalAlpha = bk.alpha
      ctx.strokeStyle = bk.colour
      ctx.setLineDash(bk.dash ? [2 / t.k, 3 / t.k] : [])
      ctx.stroke(bk.path)
    }
    ctx.setLineDash([])

    // Nodes.
    const alphaOf = (id: string) =>
      hl && !hl.has(id) ? 0.2 : matches && !matches.has(id) ? 0.15 : 1
    for (const s of this.simNodes) {
      ctx.globalAlpha = alphaOf(s.id)
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      const colour = pal.colours.get(s.node.section) ?? pal.colours.get(OTHER_SECTION)!
      if (s.node.kind === "tag") {
        ctx.lineWidth = 1.5 / t.k
        ctx.strokeStyle = colour
        ctx.stroke()
      } else {
        ctx.fillStyle = colour
        ctx.fill()
      }
      const ring = s.id === this.view.centre ? 2 : s.id === active ? 1.5 : 0
      if (ring) {
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r + 1.5 / t.k, 0, Math.PI * 2)
        ctx.lineWidth = ring / t.k
        ctx.strokeStyle = pal.dark
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.globalAlpha = 1
    this.drawLabels(hl, matches, active)
  }

  private drawLabels(hl: Set<string> | null, matches: Set<string> | null, active: string | null) {
    const { ctx, t, pal, w, h } = this
    const fs = window.innerWidth >= 800 ? 11 : 12
    const font = `500 ${fs}px ${pal.font}`
    const all = this.simNodes.length <= 30
    const zoomed = t.k >= 1.6
    const dialog = this.mode === "dialog"
    type Cand = {
      s: SimNode
      prio: number
      x: number
      y: number
      w: number
      h: number
      text: string
    }
    const cands: Cand[] = []
    for (const s of this.simNodes) {
      const sx = s.x * t.k + t.x
      const sy = s.y * t.k + t.y
      if (sx < -60 || sx > w + 60 || sy < -20 || sy > h + 20) continue
      let prio = -1
      if (s.id === this.view.centre) prio = 0
      else if (s.id === active) prio = 1
      else if (hl?.has(s.id)) prio = 2
      else if (matches?.has(s.id)) prio = 3
      else if (all || zoomed || (dialog && this.topLabelled.has(s.id))) prio = 4
      if (prio < 0) continue
      const text = truncateLabel(s.node.title)
      const tw = this.textWidth(font, text) + 4
      cands.push({
        s,
        prio,
        x: sx - tw / 2,
        y: sy + s.r * t.k + 2,
        w: tw,
        h: fs + 4,
        text,
      })
    }
    cands.sort((a, b) => a.prio - b.prio || b.s.deg - a.s.deg)
    const kept = placeLabels(cands)
    ctx.font = font
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    ctx.lineJoin = "round"
    ctx.lineWidth = 3
    ctx.strokeStyle = pal.bg
    ctx.fillStyle = pal.dark
    for (const c of kept) {
      ctx.globalAlpha = hl && !hl.has(c.s.id) ? 0.2 : matches && !matches.has(c.s.id) ? 0.15 : 1
      ctx.strokeText(c.text, c.x + c.w / 2, c.y + 2)
      ctx.fillText(c.text, c.x + c.w / 2, c.y + 2)
    }
    ctx.globalAlpha = 1
  }

  destroy() {
    this.active = false
    this.abort.abort()
    this.ro?.disconnect()
    this.stopSim()
    this.snapshotPositions()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    liveViews.delete(this)
    this.wrap.replaceChildren()
  }
}

function swatch(key: string): HTMLElement {
  const s = document.createElement("span")
  s.className = "graph-swatch"
  s.dataset.section = key
  s.setAttribute("aria-hidden", "true")
  return s
}

// One setting changed in one view: bring the other views in step.
function broadcast() {
  for (const v of liveViews) {
    v.syncControls()
    v.refresh(true)
  }
}

// --- The dialog ---------------------------------------------------------------------------------
const dialogPositions = new Map<string, { x: number; y: number }>()

function setupDialog(): () => void {
  const dialog = document.getElementById("graph-dialog") as HTMLDialogElement | null
  const launcher = document.querySelector<HTMLButtonElement>(".graph-launcher")
  if (!dialog) return () => {}
  try {
    sections = JSON.parse(dialog.dataset.sections ?? "[]")
  } catch {
    sections = []
  }
  const abort = new AbortController()
  const on = (el: any, type: string, fn: (e: any) => void) =>
    el?.addEventListener(type, fn, { signal: abort.signal })
  const desktop = window.matchMedia("(min-width: 900px)")
  const filters = dialog.querySelector<HTMLDetailsElement>(".graph-filters")
  const syncFilters = () => {
    if (filters && desktop.matches) filters.open = true
  }
  let view: GraphView | null = null
  let opener: HTMLElement | null = null
  let token = 0

  async function show() {
    if (dialog!.open) return
    const active = document.activeElement as HTMLElement | null
    opener = active && active !== document.body ? active : launcher
    dialog!.showModal()
    launcher?.setAttribute("aria-expanded", "true")
    syncFilters()
    const search = dialog!.querySelector<HTMLInputElement>(".graph-search input")
    const target =
      search && search.getClientRects().length
        ? search
        : dialog!.querySelector<HTMLElement>(".graph-close")
    target?.focus()
    const mine = ++token
    const wrap = dialog!.querySelector<HTMLElement>(".graph-canvas-wrap")
    try {
      const data = await loadData()
      if (mine !== token || !dialog!.open) return
      view ??= new GraphView({ mode: "dialog", root: dialog!, data, positions: dialogPositions })
      view.activate()
    } catch (err) {
      console.error("graph: could not load the data", err)
      if (wrap) {
        wrap.dataset.state = "error"
        wrap.textContent = "The graph could not be loaded."
      }
    }
  }
  function hide() {
    if (dialog!.open) dialog!.close()
  }
  openDialog = show

  on(launcher, "click", () => void show())
  on(dialog.querySelector(".graph-close"), "click", hide)
  on(dialog, "click", (e: MouseEvent) => {
    if (e.target !== dialog) return
    // A click on the backdrop reaches the dialog itself, from outside its box.
    const r = dialog.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      hide()
  })
  on(dialog, "close", () => {
    token++
    view?.deactivate()
    launcher?.setAttribute("aria-expanded", "false")
    const back =
      opener && opener.isConnected ? opener : document.querySelector<HTMLElement>(".graph-launcher")
    back?.focus({ preventScroll: true })
  })
  on(document, "prenav", hide)
  const onDesktop = () => syncFilters()
  if (desktop.addEventListener)
    desktop.addEventListener("change", onDesktop, { signal: abort.signal })
  else desktop.addListener?.(onDesktop)

  return () => {
    abort.abort()
    token++
    if (dialog.open) dialog.close()
    view?.destroy()
    view = null
    if (openDialog === show) openDialog = null
  }
}

// --- The note panel -------------------------------------------------------------------------------
let panelGen = 0

function setupPanel(): () => void {
  const root = document.querySelector<HTMLElement>(".note-graph")
  if (!root) return () => {}
  const gen = ++panelGen
  let view: GraphView | null = null
  const abort = new AbortController()
  root
    .querySelector(".graph-open")
    ?.addEventListener("click", () => openDialog?.(), { signal: abort.signal })
  const wrap = root.querySelector<HTMLElement>(".graph-canvas-wrap")
  loadData().then(
    (data) => {
      if (gen !== panelGen || !root.isConnected) return
      view = new GraphView({ mode: "panel", root, data, positions: new Map() })
      view.activate()
    },
    (err) => {
      if (gen !== panelGen) return
      console.error("graph: could not load the data", err)
      if (wrap) {
        wrap.dataset.state = "error"
        wrap.textContent = "The graph could not be loaded."
      }
    },
  )
  return () => {
    panelGen++
    abort.abort()
    view?.destroy()
    view = null
  }
}

// --- Wiring -----------------------------------------------------------------------------------------
document.addEventListener("nav", () => {
  const teardowns = [setupDialog(), setupPanel()]
  window.addCleanup(() => teardowns.forEach((fn) => fn()))
})

document.addEventListener("themechange", () => {
  for (const v of liveViews) v.recolour()
})

// Ctrl/Cmd+G opens the graph from any page and closes it again; not over the search overlay.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "g") return
  if (document.querySelector(".search-container.active")) return
  const dialog = document.getElementById("graph-dialog") as HTMLDialogElement | null
  if (!dialog) return
  e.preventDefault()
  if (dialog.open) dialog.close()
  else openDialog?.()
})
