// Whether the section row of the top bar is tucked away, from one scroll position to the next.
// Pure, so node:test can run it (scripts/scroll-tuck.test.mjs); the top-bar script feeds it.
export const TUCK_THRESHOLD = 12

export const initialTuck = (y = 0) => ({ tucked: false, lastY: Math.max(0, y || 0), travel: 0 })

// input: { y, maxY, topZone, hold, threshold? }
//  hold: keep the row shown (keyboard focus in it, drawer or search open, bar not sticky, a navigation)
//  topZone: the bar's height in px; at or above it the row is always shown
export function nextTuck(state, { y, maxY, topZone, hold, threshold = TUCK_THRESHOLD }) {
  if (hold) return { tucked: false, lastY: Math.max(0, y || 0), travel: 0 }
  // Rubber-band overscroll (iOS): negative, or past the end. Keep the state, ignore the bounce.
  if (!(y >= 0) || y > maxY + 1) return state
  if (y <= topZone) return { tucked: false, lastY: y, travel: 0 }
  const dy = y - state.lastY
  if (dy === 0) return state
  // Distance travelled in one direction; a change of direction starts again from this step.
  const travel = Math.sign(dy) === Math.sign(state.travel) ? state.travel + dy : dy
  let tucked = state.tucked
  if (travel >= threshold) tucked = true
  else if (travel <= -threshold) tucked = false
  return { tucked, lastY: y, travel }
}
