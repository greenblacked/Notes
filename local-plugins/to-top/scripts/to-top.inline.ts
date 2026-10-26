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
  // The page's own scroll moves (top-bar announces them with "notes:layoutshift": a Mermaid
  // redraw after a theme switch lets its height lock go and the page shifts up) are not the reader
  // scrolling up. A matching move re-bases the state and does not reveal the button.
  let shifts: number[] = []
  const update = () => {
    frame = 0
    const y = window.scrollY
    const held = hold()
    if (!held && shifts.some((s) => Math.abs(y - state.lastY - s) <= 1)) {
      shifts = []
      state = { ...state, lastY: y, travel: 0 }
    } else {
      state = nextReveal(state, {
        y,
        maxY: root.scrollHeight - window.innerHeight,
        limit,
        hold: held,
        focused: document.activeElement === button,
      })
    }
    if (button.classList.contains("on") !== state.shown) button.classList.toggle("on", state.shown)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const onResize = () => {
    limit = revealFrom(window.innerHeight)
    schedule()
  }
  const onShift = (e: Event) => {
    const detail = (e as CustomEvent<number[]>).detail
    const mine = Array.isArray(detail) ? detail.filter((s) => Number.isFinite(s)) : []
    if (mine.length === 0) return
    shifts = mine
    // Forgotten a few frames on if no scroll matched it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (shifts === mine) shifts = []
      }),
    )
  }
  // The button stays shown on the way up (the smooth scroll runs upwards) and goes away by itself
  // once the page is back above the reveal line.
  const onClick = () => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" })
    // The bar is where the reader lands.
    document.querySelector<HTMLElement>(".top-bar-brand")?.focus({ preventScroll: true })
  }
  // The drawer and the search change classes, not the scroll position.
  const observer = new MutationObserver(schedule)
  for (const selector of [".explorer", ".search-container"]) {
    const el = document.querySelector(selector)
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["class", "data-open"] })
  }
  window.addEventListener("scroll", schedule, { passive: true })
  window.addEventListener("resize", onResize, { passive: true })
  window.addEventListener("notes:layoutshift", onShift)
  button.addEventListener("click", onClick)
  document.addEventListener("focus", schedule, true)
  document.addEventListener("blur", schedule, true)
  update()
  window.addCleanup(() => {
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", onResize)
    window.removeEventListener("notes:layoutshift", onShift)
    button.removeEventListener("click", onClick)
    document.removeEventListener("focus", schedule, true)
    document.removeEventListener("blur", schedule, true)
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
    button.classList.remove("on")
  })
}

document.addEventListener("nav", setup)
