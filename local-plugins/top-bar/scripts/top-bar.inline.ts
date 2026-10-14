// Behaviour of the top bar that CSS cannot do: the Browse drawer (Quartz's Explorer, shown at
// every width) gets a name, focus management and Escape, the table of contents marks the heading
// being read, and the skip link gets its target. Runs once per page load; the parts that touch the page re-run on every
// SPA navigation ("nav") and clean up after themselves.

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

function setupDrawer() {
  const parts = drawerParts()
  if (!parts) return
  const { explorer, toggle, drawer } = parts

  toggle.setAttribute("aria-label", "Browse notes")
  toggle.setAttribute("aria-haspopup", "dialog")
  drawer.setAttribute("role", "dialog")
  drawer.setAttribute("aria-label", "Browse notes")
  drawer.removeAttribute("aria-expanded")

  let wasOpen = false
  const sync = () => {
    const open = isOpen(parts)
    toggle.setAttribute("aria-expanded", String(open))
    drawer.setAttribute("aria-modal", String(open))
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

  window.addCleanup(() => {
    observer.disconnect()
    explorer.removeEventListener("click", onBackdrop)
  })
}

// Escape closes the drawer; Tab stays inside it while it is open.
document.addEventListener("keydown", (e) => {
  const parts = drawerParts()
  if (!parts || !isOpen(parts)) return
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

  let frame = 0
  const update = () => {
    frame = 0
    const bar = document.querySelector<HTMLElement>(".left.sidebar")?.offsetHeight ?? 0
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
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", schedule, { passive: true })
  update()
  window.addCleanup(() => {
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", schedule)
    if (frame) cancelAnimationFrame(frame)
  })
}

// "Skip to content": the article gets an id and can take focus, so that following the link moves
// the keyboard (the SPA router only scrolls to an in-page anchor).
function setupSkipLink() {
  const link = document.querySelector<HTMLAnchorElement>(".skip-link")
  const target = document.querySelector<HTMLElement>(".center article")
  if (!link || !target) return
  target.id = "article"
  target.tabIndex = -1
  const onClick = () => requestAnimationFrame(() => target.focus({ preventScroll: true }))
  link.addEventListener("click", onClick)
  window.addCleanup(() => link.removeEventListener("click", onClick))
}

const onNav = () => {
  setupDrawer()
  setupTocSpy()
  setupSkipLink()
}
document.addEventListener("nav", onNav)
document.addEventListener("render", onNav)
