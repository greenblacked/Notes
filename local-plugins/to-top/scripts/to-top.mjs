// Whether the To top button is shown, from one scroll position to the next. Pure, so node:test can
// run it (scripts/to-top.test.mjs); to-top.inline.ts feeds it.
// The feel matches the section row's tuck (12px in one direction decides, scroll-tuck.mjs), but the
// state is separate: the button also shows at the end of the page and while it has focus, and it
// stays hidden until the reader is a screen into the page.
export const REVEAL_STEP = 12
export const MIN_REVEAL = 320

// How far down the button may first appear: half a screen, never less than MIN_REVEAL.
export const revealFrom = (viewportH = 0) => Math.max(MIN_REVEAL, Math.round((viewportH || 0) / 2))

export const initialReveal = (y = 0) => ({ shown: false, lastY: Math.max(0, y || 0), travel: 0 })

// input: { y, maxY, limit, hold, focused, step? }
//   hold:    keep it hidden (drawer or search open, a navigation, the page cannot scroll)
//   focused: it has keyboard focus, so it must not go away under the reader's fingers
export function nextReveal(state, { y, maxY, limit, hold, focused, step = REVEAL_STEP }) {
  if (hold) return { shown: false, lastY: Math.max(0, y || 0), travel: 0 }
  // Rubber-band overscroll (iOS): negative, or past the end. Keep the state, ignore the bounce.
  if (!(y >= 0) || y > maxY + 1) return state
  if (y <= limit) return { shown: false, lastY: y, travel: 0 }
  const end = y >= maxY - 2
  const dy = y - state.lastY
  const travel = Math.sign(dy) === Math.sign(state.travel) ? state.travel + dy : dy
  let shown = state.shown
  if (travel <= -step) shown = true
  else if (travel >= step) shown = false
  if (end || focused) shown = true
  return { shown, lastY: y, travel }
}
