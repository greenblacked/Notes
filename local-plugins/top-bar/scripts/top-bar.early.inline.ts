// --- Search before its index has loaded -------------------------------------------------------
// Quartz's search binds its listeners only after it has fetched and indexed contentIndex.json, so
// an early click did nothing. Once bound, the plugin's button handler stops the click at the
// button, so a click that reaches document means the plugin has not bound yet. The plugin creates
// .results-container just before it binds, which marks it ready. scripts/top-bar.test.mjs checks
// both hooks. This file is bundled into prescript.js, a blocking script in the head, so the
// listeners exist before the first paint and no click is lost while postscript.js (a deferred
// module) is still loading. It only listens on document, so it needs no markup.

const searchPartsOf = (el: Element) => {
  const search = el.closest(".search")
  const container = search?.querySelector<HTMLElement>(".search-container")
  const bar = search?.querySelector<HTMLInputElement>(".search-bar")
  const layout = search?.querySelector<HTMLElement>(".search-layout")
  const button = search?.querySelector<HTMLElement>(".search-button")
  return container && bar && layout && button ? { container, bar, layout, button } : null
}
type SearchParts = NonNullable<ReturnType<typeof searchPartsOf>>
const searchReady = (p: SearchParts) => !!p.layout.querySelector(":scope > .results-container")

function openEarly(p: SearchParts) {
  p.container.classList.add("active")
  p.bar.focus()
  // When the plugin is ready, search what was typed meanwhile.
  const observer = new MutationObserver(() => {
    if (!searchReady(p)) return
    observer.disconnect()
    if (p.container.classList.contains("active") && p.bar.value !== "")
      p.bar.dispatchEvent(new Event("input", { bubbles: true }))
  })
  observer.observe(p.layout, { childList: true })
}
function closeEarly(p: SearchParts) {
  p.container.classList.remove("active")
  p.bar.value = ""
  p.button.focus({ preventScroll: true })
}

document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return
  const button = e.target.closest(".search-button")
  if (button) {
    const p = searchPartsOf(button)
    if (p && !searchReady(p) && !p.container.classList.contains("active")) openEarly(p)
    return
  }
  if (e.target.matches(".search-container.active")) {
    const p = searchPartsOf(e.target)
    if (p && !searchReady(p)) closeEarly(p)
  }
})
document.addEventListener("keydown", (e) => {
  // Autofill and some tools dispatch a keydown without a key.
  if (typeof e.key !== "string") return
  const p0 = document.querySelector(".search")
  const p = p0 ? searchPartsOf(p0) : null
  if (!p || searchReady(p)) return
  const active = p.container.classList.contains("active")
  if (e.key === "Escape" && active) {
    e.preventDefault()
    closeEarly(p)
  } else if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    // The same toggle as the plugin's: a second Ctrl/Cmd+K closes the search.
    e.preventDefault()
    if (active) closeEarly(p)
    else openEarly(p)
  }
})

// While the search is open early, Tab stays on the field (the plugin's own handling takes over
// once it is ready).
document.addEventListener("keydown", (e) => {
  if (typeof e.key !== "string" || e.key !== "Tab") return
  const p0 = document.querySelector(".search")
  const p = p0 ? searchPartsOf(p0) : null
  if (!p || searchReady(p) || !p.container.classList.contains("active")) return
  e.preventDefault()
  p.bar.focus()
})

// A keyboard user who tabs along the section row: a browser scrolls a link into view only when it
// is not visible at all, so a link that is half hidden at the edge would keep its focus ring
// clipped. Keep a little room on the side the link is cut off.
document.addEventListener("focusin", (e) => {
  if (!(e.target instanceof Element)) return
  const link = e.target.closest(".section-row a")
  const row = link?.closest<HTMLElement>(".section-row")
  if (!link || !row) return
  const l = link.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  const room = 12
  if (l.right > r.right - room) row.scrollLeft += l.right - (r.right - room)
  else if (l.left < r.left + room) row.scrollLeft -= r.left + room - l.left
})
