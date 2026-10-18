// Behaviour of the top bar that CSS cannot do: the section row keeps the current section in view
// (the inline script of the row does it before the first paint; this does it again after a page
// change and once the fonts have loaded), the Browse drawer (Quartz's Explorer, shown at
// every width) gets a name, focus management and Escape, the table of contents marks the heading
// being read, the centre column gets its landmark and the skip link its focus. Runs once per page
// load; the parts that touch the page re-run on every SPA navigation ("nav") and clean up after
// themselves. It also drives the motion that CSS cannot start by itself: the fade-in of the new page
// after a navigation and the cross-fade of the theme (see "Motion" below). No inline script is
// involved: this file is bundled into postscript.js.

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

// The centre column is the page's main landmark, and "Skip to content" lands on the title: the
// target (#content) is rendered by the content-start component; the 404 page has none, so its
// article stands in. Following the link also moves the keyboard (the SPA router only scrolls to an
// in-page anchor).
function setupLandmarks() {
  const center = document.querySelector<HTMLElement>(".center")
  center?.setAttribute("role", "main")
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
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Transitions are enabled once the page has painted: nothing fades on the first paint, in
// particular not the colours when a saved dark theme is applied while the page loads.
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("motion-ready")))

// A theme change (the toggle, or the OS) cross-fades: .theme-fade makes every colour transition on
// one curve and duration, and goes again once the fade is over.
let themeTimer = 0
document.addEventListener("themechange", () => {
  if (reducedMotion()) return
  root.classList.add("theme-fade")
  window.clearTimeout(themeTimer)
  themeTimer = window.setTimeout(() => root.classList.remove("theme-fade"), 450)
})

// The page change. The router fetches the next page, fires "prenav", morphs it into the document
// (the .center element survives) and scrolls, then fires "nav". While that runs the root has
// data-navigating, so the router's scroll to the top is instant and not a smooth scroll across the
// new page; at "nav" the sheet gets data-enter, which the CSS turns into a fade and a small rise
// (opacity and transform only, no layout shift). The initial page load, which also fires "nav",
// does not animate. A link to a #heading fades without the rise, so the scroll target stays exact.
// (The View Transitions API is not used: the router swaps the DOM inside its own async function,
// so there is no callback to hand to startViewTransition without patching Quartz's router.)
let navigating = false
let enterTimer = 0
document.addEventListener("prenav", () => {
  navigating = true
  root.dataset.navigating = ""
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
