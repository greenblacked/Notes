import { initialReveal, nextReveal, revealFrom } from "./to-top.mjs"

const root = document.documentElement
const searchActive = () => !!document.querySelector(".search-container.active")
const drawerOpen = () => !!document.querySelector(".explorer[data-open]")

function setup() {
  const button = document.getElementById("to-top")
  if (!(button instanceof HTMLButtonElement)) return
  button.classList.remove("on") // the morph may hand back a stale class
  let limit = revealFrom(window.innerHeight)
  let state = initialReveal(window.scrollY)
  const hold = () =>
    root.hasAttribute("data-navigating") ||
    root.classList.contains("mobile-no-scroll") ||
    drawerOpen() ||
    searchActive()
  let frame = 0
  const update = () => {
    frame = 0
    state = nextReveal(state, {
      y: window.scrollY,
      maxY: root.scrollHeight - window.innerHeight,
      limit,
      hold: hold(),
      focused: document.activeElement === button,
    })
    if (button.classList.contains("on") !== state.shown) button.classList.toggle("on", state.shown)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const onResize = () => {
    limit = revealFrom(window.innerHeight)
    schedule()
  }
  // A Mermaid redraw after a theme switch can shift the page and briefly reveal the button; it
  // hides again on the next downward scroll. The top bar's layout-shift bookkeeping is consumed by
  // its own tuck, so it is deliberately not shared here.
  const onClick = () => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" })
    // The bar is where the reader lands.
    document.querySelector<HTMLElement>(".top-bar-brand")?.focus({ preventScroll: true })
    state = initialReveal(0)
    update()
  }
  // The drawer and the search change classes, not the scroll position.
  const observer = new MutationObserver(schedule)
  for (const selector of [".explorer", ".search-container"]) {
    const el = document.querySelector(selector)
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["class", "data-open"] })
  }
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", onResize, { passive: true })
  button.addEventListener("click", onClick)
  document.addEventListener("focus", schedule, true)
  document.addEventListener("blur", schedule, true)
  update()
  window.addCleanup(() => {
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", onResize)
    button.removeEventListener("click", onClick)
    document.removeEventListener("focus", schedule, true)
    document.removeEventListener("blur", schedule, true)
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
    button.classList.remove("on")
  })
}

document.addEventListener("nav", setup)
