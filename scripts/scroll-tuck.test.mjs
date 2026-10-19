import { test } from "node:test"
import assert from "node:assert/strict"
import {
  TUCK_THRESHOLD,
  initialTuck,
  nextTuck,
} from "../local-plugins/top-bar/scripts/scroll-tuck.mjs"

const view = { maxY: 5000, topZone: 100, hold: false }
const at = (state, y, extra = {}) => nextTuck(state, { ...view, y, ...extra })
const from = (y) => initialTuck(y)

test("scroll-tuck: 11px down does not tuck, 12px does", () => {
  assert.equal(TUCK_THRESHOLD, 12)
  assert.equal(at(from(500), 511).tucked, false)
  assert.equal(at(from(500), 512).tucked, true)
})

test("scroll-tuck: small steps add up", () => {
  let s = from(500)
  for (const y of [503, 506, 509]) s = at(s, y)
  assert.equal(s.tucked, false)
  s = at(s, 512)
  assert.equal(s.tucked, true)
})

test("scroll-tuck: a short move up keeps it tucked, 12px up shows it", () => {
  let s = at(from(500), 520)
  assert.equal(s.tucked, true)
  s = at(s, 510)
  assert.equal(s.tucked, true)
  s = at(s, 509)
  assert.equal(s.tucked, true)
  s = at(s, 508)
  assert.equal(s.tucked, false)
})

test("scroll-tuck: jitter never tucks", () => {
  let s = from(500)
  for (const dy of [5, -4, 5, -4, 5, -4, 5]) s = at(s, s.lastY + dy)
  assert.equal(s.tucked, false)
})

test("scroll-tuck: in the top zone the row always shows and travel resets", () => {
  let s = at(from(500), 530)
  assert.equal(s.tucked, true)
  s = at(s, 100)
  assert.deepEqual(s, { tucked: false, lastY: 100, travel: 0 })
  assert.deepEqual(at(from(0), 0), { tucked: false, lastY: 0, travel: 0 })
})

test("scroll-tuck: rubber-band positions keep the same state object", () => {
  const s = at(from(500), 530)
  assert.equal(at(s, -20), s)
  assert.equal(at(s, view.maxY + 40), s)
  assert.equal(at(s, NaN), s)
})

test("scroll-tuck: a bounce past the end and back does not flip the state", () => {
  let s = at(from(4900), 4950)
  assert.equal(s.tucked, true)
  s = at(s, view.maxY + 30)
  s = at(s, view.maxY)
  assert.equal(s.tucked, true)
})

test("scroll-tuck: hold shows the row and re-anchors", () => {
  const s = at(from(500), 530)
  const held = at(s, 700, { hold: true })
  assert.deepEqual(held, { tucked: false, lastY: 700, travel: 0 })
  assert.equal(at(held, 705).tucked, false)
})

test("scroll-tuck: a page that fits the top zone never tucks", () => {
  let s = from(0)
  for (const y of [10, 40, 90, 100]) s = at(s, y, { maxY: 100 })
  assert.equal(s.tucked, false)
})

test("scroll-tuck: initialTuck clamps", () => {
  assert.equal(initialTuck(-50).lastY, 0)
  assert.equal(initialTuck().lastY, 0)
  assert.equal(initialTuck(NaN).lastY, 0)
})
