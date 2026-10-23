// Behaviour of the top bar that CSS cannot do: the section row keeps the current section in view
// (the inline script of the row does it before the first paint; this does it again after a page
// change and once the fonts have loaded), the Browse drawer (Quartz's Explorer, shown at
// every width) gets a name, focus management and Escape, the table of contents marks the heading
// being read, the centre column gets its landmark and the skip link its focus. Runs once per page
// load; the parts that touch the page re-run on every SPA navigation ("nav") and clean up after
// themselves. It also drives the motion that CSS cannot start by itself: the fade-in of the new page
// after a navigation and the cross-fade of the theme (see "Motion" below). No inline script is
// involved: this file is bundled into postscript.js. Reading down a page the section row tucks
// away under the first row, and scrolling up brings it back (scroll-tuck.mjs decides, the CSS moves it).

import { initialTuck, nextTuck } from "./scroll-tuck.mjs"

const drawerParts = () => {
  const explorer = document.querySelector<HTMLElement>(".explorer")
  const toggle = explorer?.querySelector<HTMLButtonElement>(".mobile-explorer")
  const drawer = explorer?.querySelector<HTMLElement>(".explorer-content")
  return explorer && toggle && drawer ? { explorer, toggle, drawer } : null
}

// Quartz's script adds "collapsed" to the explorer once it has loaded and removes the button's
// "hide-until-loaded" class; until then the drawer is closed.
const isOpen = (parts: NonNullable<ReturnType<typeof drawerParts>>) =>
  !parts.explorer.classList.contains("collapsed") &&
  !parts.toggle.classList.contains("hide-until-loaded")

const focusable = (drawer: HTMLElement) =>
  [...drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter(
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible",
  )

const searchActive = () => !!document.querySelector(".search-container.active")

function setupDrawer() {
  const parts = drawerParts()
  if (!parts) return
  const { explorer, toggle, drawer } = parts

  toggle.setAttribute("aria-label", "Browse notes")
  toggle.setAttribute("aria-haspopup", "dialog")
  drawer.setAttribute("role", "dialog")
  drawer.setAttribute("aria-label", "Browse notes")
  drawer.removeAttribute("aria-expanded")

  // The CSS draws the drawer open only with data-open. It is set here, from a MutationObserver, so
  // it sees each change of Quartz's script complete: after a navigation that script removes
  // hide-until-loaded, reads the layout and then adds .collapsed, and the explorer looks open for
  // that instant (styled from the classes, the drawer slid in and out on every link).
  let wasOpen = false
  const sync = () => {
    const open = isOpen(parts)
    explorer.toggleAttribute("data-open", open)
    toggle.setAttribute("aria-expanded", String(open))
    drawer.setAttribute("aria-modal", String(open))
    // Closed, the drawer is out of the tab order and the accessibility tree (the explorer's own
    // CSS can make its open folders visible again, which `visibility: hidden` alone does not stop).
    if (open) drawer.inert = false
    if (open && !wasOpen) {
      const first = drawer.querySelector<HTMLElement>("a.active") ?? focusable(drawer)[0]
      first?.focus({ preventScroll: true })
    } else if (!open && wasOpen) {
      // Closed by Escape, the backdrop or a link: focus goes back to the button that opened it.
      const active = document.activeElement
      if (!active || active === document.body || drawer.contains(active)) {
        toggle.focus({ preventScroll: true })
      }
    }
    if (!open) drawer.inert = true
    wasOpen = open
  }
  const observer = new MutationObserver(sync)
  observer.observe(explorer, { attributes: true, attributeFilter: ["class"] })
  observer.observe(toggle, { attributes: true, attributeFilter: ["class"] })
  sync()

  // A click on the dimmed page (the explorer's own backdrop) closes the drawer.
  const onBackdrop = (e: MouseEvent) => {
    if (e.target === explorer && isOpen(parts)) toggle.click()
  }
  explorer.addEventListener("click", onBackdrop)

  // Opening the search closes the drawer first, so that focus stays in the search.
  const searchContainer = document.querySelector<HTMLElement>(".search-container")
  const searchObserver = new MutationObserver(() => {
    if (searchActive() && isOpen(parts)) toggle.click()
  })
  if (searchContainer) {
    searchObserver.observe(searchContainer, { attributes: true, attributeFilter: ["class"] })
  }

  window.addCleanup(() => {
    observer.disconnect()
    searchObserver.disconnect()
    explorer.removeEventListener("click", onBackdrop)
  })
}

// When the search closes (Escape, a click on the dimmed page), the keyboard goes back to the button
// that opened it; the search plugin leaves it on the page body.
function setupSearchFocus() {
  const container = document.querySelector<HTMLElement>(".search-container")
  const button = document.querySelector<HTMLElement>(".search-button")
  if (!container || !button) return
  let was = container.classList.contains("active")
  const observer = new MutationObserver(() => {
    const now = container.classList.contains("active")
    if (was && !now) {
      const active = document.activeElement
      if (!active || active === document.body || container.contains(active)) {
        button.focus({ preventScroll: true })
      }
    }
    was = now
  })
  observer.observe(container, { attributes: true, attributeFilter: ["class"] })
  window.addCleanup(() => observer.disconnect())
}

// Escape closes the drawer; Tab stays inside it while it is open. The search has the keyboard
// while it is open, and Ctrl/Cmd+K closes the drawer before the search opens.
document.addEventListener("keydown", (e) => {
  const parts = drawerParts()
  if (!parts || !isOpen(parts)) return
  // Autofill and some tools dispatch a keydown without a key.
  if (typeof e.key !== "string") return
  if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
    parts.toggle.click()
    return
  }
  if (e.defaultPrevented || searchActive()) return
  if (e.key === "Escape") {
    e.preventDefault()
    parts.toggle.click()
    parts.toggle.focus({ preventScroll: true })
  } else if (e.key === "Tab") {
    const items = focusable(parts.drawer)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const inside = parts.drawer.contains(document.activeElement)
    if (e.shiftKey && (!inside || document.activeElement === first)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
      e.preventDefault()
      first.focus()
    }
  }
})

// The table of contents entry of the heading being read: the last heading above a line a little
// below the top bar, or the last entry once the page is scrolled to the end. Nothing is marked
// before the first heading.
function setupTocSpy() {
  const entries = [...document.querySelectorAll<HTMLAnchorElement>(".toc a[data-for]")]
    .map((link) => ({ link, heading: document.getElementById(link.dataset.for ?? "") }))
    .filter((entry): entry is { link: HTMLAnchorElement; heading: HTMLElement } => !!entry.heading)
  if (entries.length === 0) return
  const list = entries[0].link.closest<HTMLElement>("ul")

  let frame = 0
  const update = () => {
    frame = 0
    // Where the bar ends on screen (0 when it has scrolled away, on short landscape screens).
    const bar = Math.max(
      0,
      document.querySelector(".left.sidebar")?.getBoundingClientRect().bottom ?? 0,
    )
    const line = bar + 40
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    let current = atEnd ? entries[entries.length - 1] : undefined
    if (!atEnd) {
      for (const entry of entries) {
        if (entry.heading.getBoundingClientRect().top > line) break
        current = entry
      }
    }
    for (const entry of entries) {
      const on = entry === current
      entry.link.classList.toggle("current", on)
      if (on) entry.link.setAttribute("aria-current", "location")
      else entry.link.removeAttribute("aria-current")
    }
    // The indicator bar of the list slides to the current entry (the CSS transitions its transform).
    if (list) {
      list.style.setProperty("--toc-y", `${current ? current.link.offsetTop : 0}px`)
      list.style.setProperty("--toc-h", String(current ? current.link.offsetHeight : 0))
      list.style.setProperty("--toc-on", current ? "1" : "0")
    }
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", schedule, { passive: true })
  // The first placement is not animated: the bar starts where the reader is.
  if (list) list.dataset.still = ""
  update()
  if (list) {
    requestAnimationFrame(() => requestAnimationFrame(() => delete list.dataset.still))
  }
  window.addCleanup(() => {
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", schedule)
    if (frame) cancelAnimationFrame(frame)
  })
}

// Reading down the page the section row tucks away; scrolling up, or being near the top, brings it
// back (the CSS slides it, scroll-tuck.mjs decides). The state is an attribute of the root, which
// the page morph leaves alone. The row stays while it has keyboard focus, while the drawer or the
// search is open, during a navigation and on short windows, where the bar is not sticky.
function setupHideOnScroll() {
  root.removeAttribute(TUCKED)
  const bar = document.querySelector<HTMLElement>(".page > #quartz-body > .sidebar.left")
  const row = bar?.querySelector<HTMLElement>(".section-row")
  if (!bar || !row) return

  let sticky = true
  const measure = () => {
    const position = getComputedStyle(bar).position
    sticky = position === "sticky" || position === "-webkit-sticky"
  }
  // Only keyboard focus holds the row: a tapped or clicked link is focused too, and would keep it.
  // Where :focus-visible is unsupported, the last input device decides instead.
  let pointerLast = false
  const onPointer = () => {
    pointerLast = true
  }
  const onKey = () => {
    pointerLast = false
  }
  const keyboardIn = () => {
    const active = document.activeElement
    if (!active || !row.contains(active)) return false
    try {
      return active.matches(":focus-visible")
    } catch {
      return !pointerLast
    }
  }
  const hold = () => {
    const parts = drawerParts()
    return (
      !sticky ||
      root.hasAttribute("data-navigating") ||
      root.classList.contains("mobile-no-scroll") ||
      (!!parts && isOpen(parts)) ||
      searchActive() ||
      keyboardIn()
    )
  }

  let state = initialTuck(window.scrollY)
  const apply = () => {
    if (root.hasAttribute(TUCKED) !== state.tucked) root.toggleAttribute(TUCKED, state.tucked)
    // Focus must not have scrolled the clipped row up or down.
    if (!state.tucked && row.scrollTop !== 0) row.scrollTop = 0
  }
  let frame = 0
  const update = () => {
    frame = 0
    const y = window.scrollY
    if (takeLayoutShift(y - state.lastY)) {
      // The diagrams came back at another height as their lock let go, and the browser kept the
      // reading position: the page moved, not the reader. Keep the row as it is.
      state = { ...state, lastY: Math.max(0, y) }
      return
    }
    state = nextTuck(state, {
      y,
      maxY: root.scrollHeight - window.innerHeight,
      topZone: bar.offsetHeight,
      hold: hold(),
    })
    apply()
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const onResize = () => {
    measure()
    schedule()
  }
  const onFocus = (e: FocusEvent) => {
    if (!(e.target instanceof Node) || !row.contains(e.target) || !keyboardIn()) return
    state = initialTuck(window.scrollY)
    apply()
  }

  const observer = new MutationObserver(schedule)
  for (const selector of [".explorer", ".mobile-explorer", ".search-container"]) {
    const el = document.querySelector(selector)
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["class"] })
  }
  measure()
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", onResize, { passive: true })
  document.addEventListener("focus", onFocus, true)
  document.addEventListener("pointerdown", onPointer, { passive: true, capture: true })
  document.addEventListener("keydown", onKey, true)
  window.addCleanup(() => {
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", onResize)
    document.removeEventListener("focus", onFocus, true)
    document.removeEventListener("pointerdown", onPointer, true)
    document.removeEventListener("keydown", onKey, true)
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
    root.removeAttribute(TUCKED)
  })
}

// The centre column is the page's main landmark, the top bar its banner, and "Skip to content" lands on the title: the
// target (#content) is rendered by the content-start component; the 404 page has none, so its
// article stands in. Following the link also moves the keyboard (the SPA router only scrolls to an
// in-page anchor).
function setupLandmarks() {
  const center = document.querySelector<HTMLElement>(".center")
  center?.setAttribute("role", "main")
  // The top bar (brand, Browse, search, theme) is the page's banner, so row 1 sits in a landmark.
  document.querySelector<HTMLElement>(".sidebar.left")?.setAttribute("role", "banner")
  const link = document.querySelector<HTMLAnchorElement>(".skip-link")
  let target = document.getElementById("content")
  if (!target) {
    target = document.querySelector<HTMLElement>(".center article")
    if (target) target.id = "content"
  }
  if (!link || !target) return
  const skipTo = target
  skipTo.tabIndex = -1
  const onClick = () => requestAnimationFrame(() => skipTo.focus({ preventScroll: true }))
  link.addEventListener("click", onClick)
  window.addCleanup(() => link.removeEventListener("click", onClick))
}

// The router scrolls to a #hash before code and diagram blocks have their final height, which
// leaves the heading under the bar or off screen; scroll again once layout has settled.
let hashScroll = 0
async function settleHash() {
  const id = ++hashScroll
  const { hash } = location
  if (!hash) return
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await document.fonts?.ready
  if (id !== hashScroll || location.hash !== hash) return
  let name = hash.slice(1)
  try {
    name = decodeURIComponent(name)
  } catch {
    // Not valid percent-encoding: use it as written.
  }
  document.getElementById(name)?.scrollIntoView({ behavior: "instant", block: "start" })
}

// ---- Motion ------------------------------------------------------------------------------
// Reduced motion: the CSS switches every animation and transition off; nothing here starts one.
const root = document.documentElement
const TUCKED = "data-bar-tucked"
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Transitions are enabled once the page has painted: nothing fades on the first paint, in
// particular not the colours when a saved dark theme is applied while the page loads.
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("motion-ready")))

// A theme change. .theme-switching turns every transition off for the one recalc that flips the
// colours, so the flip does not start a transition on every element; it goes again once the new
// theme has painted. A click on the toggle is caught first (capture phase, before Quartz's own
// listener on the button), so the class is on before the flip. Where the View Transitions API
// exists, motion is allowed and the device has a mouse or trackpad (a fine pointer), the
// click is replayed inside startViewTransition: the whole page then cross-fades as one snapshot
// (--dur-theme). Otherwise the colours flip in one frame: capturing the old snapshot costs
// 100-200ms of main-thread time on a slow phone, which is slower than the flip itself. Inside the
// cross-fade the fade itself swaps the theme icons, so the icon's own turn is off there (a turn
// under the fade would show twice and outlast it).
const SWITCHING = "theme-switching"
const SNAPSHOT = "data-theme-snapshot" // set while the switch runs inside a View Transition
type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void> }
type StartViewTransition = (update: () => void) => ViewTransitionLike
let switchId = 0
let replaying = false

function beginSwitch(snapshot = false) {
  root.classList.add(SWITCHING)
  root.toggleAttribute(SNAPSHOT, snapshot)
  return ++switchId
}
// Taking the class off restyles the whole tree once (no visible change, but it costs about as
// much as the flip itself on a big page); do it when the page is idle, never in the flip's frame.
function endSwitch(id: number) {
  const done = () => {
    if (id === switchId) {
      root.classList.remove(SWITCHING)
      root.removeAttribute(SNAPSHOT)
    }
  }
  const idle = (
    window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  ).requestIdleCallback // missing on Safari
  if (typeof idle === "function") idle.call(window, done, { timeout: 500 })
  else window.setTimeout(done, 60)
}
// The cross-fade only where it does not delay the flip: a mouse or trackpad (not a phone or
// tablet). Measured on desktop Chromium, the snapshot settles in 67-139ms even on the largest page.
const canFade = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn))

document.addEventListener(
  "click",
  (e) => {
    if (replaying) return
    const target = e.target
    const btn = target instanceof Element ? target.closest<HTMLElement>(".darkmode") : null
    if (!btn) return
    const start = (document as Document & { startViewTransition?: StartViewTransition })
      .startViewTransition
    if (reducedMotion() || typeof start !== "function" || !canFade()) {
      const id = beginSwitch() // Quartz's listener on the button flips the theme right after this
      afterPaint(() => endSwitch(id))
      return
    }
    e.stopImmediatePropagation()
    let id = 0
    const vt = start.call(document, () => {
      id = beginSwitch(true)
      replaying = true
      try {
        btn.click()
      } finally {
        replaying = false
      }
    })
    vt.ready.catch(() => {}) // skipped (hidden tab, a second click): the update still ran
    vt.finished.finally(() => endSwitch(id))
  },
  true,
)

// Any other source of "themechange": switch transitions off from here on.
document.addEventListener("themechange", () => {
  lockMermaidHeights()
  if (root.classList.contains(SWITCHING)) return
  const id = beginSwitch()
  afterPaint(() => endSwitch(id))
})

// Mermaid redraws every diagram on a theme change: it puts the source text back (a different
// height), draws the new SVG in a temporary wrapper inside the block and then puts the finished SVG
// in place of the wrapper. Above the reading position that would move the page, either by scroll
// anchoring or as a jump of the content, and a tuck that reads the move as a scroll slides the
// section row in and out. So the diagrams keep their height until every finished SVG is in (this
// listener is registered at load, before Mermaid's own, so it runs first). The page cannot move by
// itself meanwhile, so every scroll in that time is the reader's and the tuck follows it as usual.
// A switch while a redraw still runs keeps the lock (and the heights of the drawn diagrams) until
// the latest redraw is in. Without MutationObserver or a measurable block it does nothing.
type Pinned = {
  pre: HTMLElement
  code: HTMLElement
  height: number
  drawn: Element | null // the finished SVG when the latest switch began; the redraw replaces it
  min: string
  max: string
  overflow: string
  sizing: string
}
// The lock gives up after this long without a change in the blocks (Mermaid failed or never ran),
// and at the latest this long after the switch, so a redraw that keeps changing cannot hold it.
const MERMAID_IDLE_MS = 3000
const MERMAID_CEILING_MS = 10_000
let mermaidLock: { rearm: () => void; release: (immediate?: boolean) => void } | null = null

// A finished diagram: its SVG is a direct child of the block (while Mermaid draws, the block holds
// the source text or the temporary wrapper with the SVG under construction).
const drawnSvg = (code: Element) => code.querySelector(":scope > svg")

// The scroll moves that letting the lock go may cause (see release), so that the tuck takes the
// matching move as the page's and not the reader's. Cleared once one is taken, or a few frames on.
let layoutShifts: number[] = []
const takeLayoutShift = (dy: number) => {
  if (!layoutShifts.some((s) => Math.abs(dy - s) <= 1)) return false
  layoutShifts = []
  return true
}

function lockMermaidHeights() {
  if (mermaidLock) {
    mermaidLock.rearm()
    return
  }
  if (typeof MutationObserver !== "function") return
  const saved: Pinned[] = []
  let timer = 0
  let ceiling = 0
  let quiet = 0
  // Done when every pinned block holds a finished SVG as its only child, drawn since the latest
  // switch began.
  const redrawn = () =>
    saved.every(({ code, drawn }) => {
      const svg = drawnSvg(code)
      return !!svg && svg !== drawn && code.children.length === 1
    })
  // A finished SVG is not yet the end: after a second switch the first run's SVG can still land
  // while the latest redraw has only begun. So the lock lets go once the blocks have held still for
  // a short spell, and any later change restarts that wait.
  const QUIET_MS = 150
  const observer = new MutationObserver(() => {
    // Progress: a slow device or a complex diagram is still drawing, so the idle wait starts over
    // (the ceiling does not).
    window.clearTimeout(timer)
    timer = window.setTimeout(() => release(), MERMAID_IDLE_MS)
    window.clearTimeout(quiet)
    if (!redrawn()) return
    quiet = window.setTimeout(() => {
      if (redrawn()) release()
    }, QUIET_MS)
  })
  // Only the diagrams Mermaid redraws: those in .center that hold a finished SVG. A hidden link
  // preview (.popover) keeps a block that is never rendered, and waiting for it would hold the
  // lock to its timeout.
  const pin = () => {
    for (const code of document.querySelectorAll<HTMLElement>(".center code.mermaid")) {
      if (saved.some((p) => p.code === code)) continue
      const svg = drawnSvg(code)
      if (!svg) continue
      const pre = code.parentElement
      const h = pre?.getBoundingClientRect().height ?? 0
      if (!pre || !(h > 0)) continue
      saved.push({
        pre,
        code,
        height: h,
        drawn: svg,
        min: pre.style.minHeight,
        max: pre.style.maxHeight,
        overflow: pre.style.overflow,
        sizing: pre.style.boxSizing,
      })
      pre.style.boxSizing = "border-box"
      pre.style.minHeight = pre.style.maxHeight = `${h}px`
      pre.style.overflow = "hidden"
      observer.observe(code, { childList: true, subtree: true })
    }
  }
  const release = (immediate = false) => {
    if (mermaidLock !== lock) return
    mermaidLock = null
    observer.disconnect()
    window.clearTimeout(timer)
    window.clearTimeout(ceiling)
    window.clearTimeout(quiet)
    // The blocks that start above the reading position, measured while still pinned: if one comes
    // back at another height, the browser keeps the reading position by scrolling (scroll
    // anchoring, which not every browser has), by the change of the blocks wholly above it, or of all of them
    // when its anchor lies below the block across the top edge.
    const above = immediate
      ? []
      : saved.flatMap((p) => {
          const r = p.pre.getBoundingClientRect()
          return r.top < 0 ? [{ p, whole: r.bottom <= 0 }] : []
        })
    for (const { pre, min, max, overflow, sizing } of saved) {
      pre.style.minHeight = min
      pre.style.maxHeight = max
      pre.style.overflow = overflow
      pre.style.boxSizing = sizing
    }
    let whole = 0
    let all = 0
    for (const { p, whole: isWhole } of above) {
      const d = p.pre.getBoundingClientRect().height - p.height
      all += d
      if (isWhole) whole += d
    }
    const shifts = [whole, all].filter((s) => Math.abs(s) >= 0.5)
    if (shifts.length === 0) return
    layoutShifts = shifts
    afterPaint(() =>
      afterPaint(() => {
        if (layoutShifts === shifts) layoutShifts = []
      }),
    )
  }
  const rearm = () => {
    for (const p of saved) p.drawn = drawnSvg(p.code)
    pin()
    window.clearTimeout(quiet)
    window.clearTimeout(timer)
    window.clearTimeout(ceiling)
    timer = window.setTimeout(() => release(), MERMAID_IDLE_MS)
    ceiling = window.setTimeout(() => release(), MERMAID_CEILING_MS)
  }
  const lock = { rearm, release }
  pin()
  if (saved.length === 0) {
    observer.disconnect()
    return
  }
  mermaidLock = lock
  timer = window.setTimeout(() => release(), MERMAID_IDLE_MS) // Mermaid failed or never ran
  ceiling = window.setTimeout(() => release(), MERMAID_CEILING_MS)
}

// The page change. The router fetches the next page, fires "prenav", morphs it into the document
// (the .center element survives) and scrolls, then fires "nav". While that runs the root has
// data-navigating, so the router's scroll to the top is instant and not a smooth scroll across the
// new page; at "nav" the sheet gets data-enter, which the CSS turns into a fade and a small rise
// (opacity and transform only, no layout shift). The initial page load, which also fires "nav",
// does not animate. A link to a #heading fades without the rise, so the scroll target stays exact.
// (The View Transitions API is used only for the theme cross-fade; page changes do not use it:
// the router swaps the DOM inside its own async function, so there is no callback to hand to
// startViewTransition without patching Quartz's router.)
let navigating = false
let enterTimer = 0
document.addEventListener("prenav", () => {
  mermaidLock?.release(true) // the lock must not survive the page change
  navigating = true
  root.dataset.navigating = ""
  root.removeAttribute(TUCKED)
})

function playEnter() {
  const center = document.querySelector<HTMLElement>(".center")
  if (!center || reducedMotion()) return
  center.removeAttribute("data-enter")
  void center.offsetWidth // restart the animation if one is still running
  center.dataset.enter = location.hash ? "fade" : "rise"
  window.clearTimeout(enterTimer)
  enterTimer = window.setTimeout(() => center.removeAttribute("data-enter"), 800)
}

// The section row scrolls sideways when the links do not fit; keep the current section's link in
// view, centred, after a page change and when the fonts have changed the widths. Nothing happens
// when the row does not overflow or the link is already fully visible.
function revealCurrentSection(smooth: boolean) {
  const row = document.querySelector<HTMLElement>(".section-row")
  const link = row?.querySelector<HTMLElement>("a[aria-current]")
  if (!row || !link || row.scrollWidth <= row.clientWidth) return
  const r = row.getBoundingClientRect()
  const l = link.getBoundingClientRect()
  if (l.left >= r.left + 4 && l.right <= r.right - 4) return
  row.scrollTo({
    left: link.offsetLeft + link.offsetWidth / 2 - row.clientWidth / 2,
    behavior: smooth && !reducedMotion() ? "smooth" : "instant",
  })
}
void document.fonts?.ready.then(() => revealCurrentSection(false))

const onNav = () => {
  setupDrawer()
  setupSearchFocus()
  setupTocSpy()
  setupHideOnScroll()
  setupLandmarks()
  void settleHash()
  revealCurrentSection(navigating)
  if (navigating) {
    navigating = false
    playEnter()
    requestAnimationFrame(() => delete root.dataset.navigating)
  }
}
document.addEventListener("nav", onNav)
