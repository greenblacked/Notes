import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import {
  MIN_REVEAL,
  REVEAL_STEP,
  initialReveal,
  nextReveal,
  revealFrom,
} from "../local-plugins/to-top/scripts/to-top.mjs"

const read = (f) => fs.readFileSync(f, "utf8")
const px = (v) => (v.endsWith("rem") ? parseFloat(v) * 16 : parseFloat(v))
const view = { maxY: 5000, limit: 400, hold: false, focused: false }
const at = (state, y, extra = {}) => nextReveal(state, { ...view, y, ...extra })
const from = (y) => initialReveal(y)

test("to-top: the first appearance is half a screen down, never less than MIN_REVEAL", () => {
  assert.equal(MIN_REVEAL, 320)
  assert.equal(revealFrom(0), 320)
  assert.equal(revealFrom(500), 320)
  assert.equal(revealFrom(844), 422)
  assert.equal(revealFrom(900), 450)
})

test("to-top: hidden at or below the limit, even when scrolling up", () => {
  let s = at(from(900), 800)
  assert.equal(s.shown, true)
  s = at(s, 400)
  assert.equal(s.shown, false)
  assert.equal(at(from(300), 100).shown, false)
})

test("to-top: 11px up does not show, 12px does", () => {
  assert.equal(REVEAL_STEP, 12)
  assert.equal(at(from(900), 889).shown, false)
  assert.equal(at(from(900), 888).shown, true)
})

test("to-top: small steps up add up", () => {
  let s = from(900)
  for (const y of [897, 894, 891]) s = at(s, y)
  assert.equal(s.shown, false)
  s = at(s, 888)
  assert.equal(s.shown, true)
})

test("to-top: a change of direction restarts the travel", () => {
  let s = at(from(900), 880)
  assert.equal(s.shown, true)
  s = at(s, 885)
  assert.equal(s.shown, true)
  s = at(s, 891)
  assert.equal(s.shown, true)
  s = at(s, 892)
  assert.equal(s.shown, false)
})

test("to-top: jitter never shows it", () => {
  let s = from(900)
  for (const y of [905, 900, 906, 901, 907, 902]) s = at(s, y)
  assert.equal(s.shown, false)
})

test("to-top: shown at the end of the page even after a downward move", () => {
  let s = at(from(4900), 4950)
  assert.equal(s.shown, false)
  s = at(s, 5000)
  assert.equal(s.shown, true)
})

test("to-top: focus keeps it shown while scrolling down", () => {
  let s = at(from(900), 880)
  assert.equal(s.shown, true)
  s = at(s, 1000, { focused: true })
  assert.equal(s.shown, true)
  s = at(s, 1100)
  assert.equal(s.shown, false)
})

test("to-top: hold hides it and resets", () => {
  let s = at(from(900), 880)
  s = at(s, 860, { hold: true })
  assert.deepEqual(s, { shown: false, lastY: 860, travel: 0 })
})

test("to-top: rubber-band overscroll returns the state unchanged", () => {
  const s = at(from(900), 880)
  assert.equal(at(s, -30), s)
  assert.equal(at(s, 5100), s)
})

test("to-top: it is a registered component in the bar, painted under the drawer and the search", () => {
  assert.match(read("quartz.ts"), /componentRegistry\.register\(\s*"to-top"/)
  const yaml = read("quartz.config.yaml")
  const entry = yaml.match(
    /source: \.\/local-plugins\/to-top\n\s+enabled: true\n\s+layout:\n\s+position: left\n\s+priority: (\d+)/,
  )
  assert.ok(entry, "to-top entry not found in quartz.config.yaml")
  const bar = yaml.match(
    /source: \.\/local-plugins\/top-bar\n\s+enabled: true\n\s+layout:\n\s+position: left\n\s+priority: (\d+)/,
  )
  const search = yaml.match(/source: github:quartz-community\/search\n[\s\S]*?priority: (\d+)/)
  const toolbar = yaml.match(/priority: (\d+)\n\s+group: toolbar/)
  assert.ok(bar && search && toolbar, "top-bar, search or toolbar entry not found")
  const p = Number(entry[1])
  const reason =
    "the drawer and the search overlay must come after the button in the bar so they paint over it"
  assert.ok(p > Number(bar[1]), reason)
  assert.ok(p < Number(search[1]), reason)
  assert.ok(p < Number(toolbar[1]), reason)
})

test("to-top: the markup is a real button with a label and no inline handler", () => {
  const tsx = read("local-plugins/to-top/ToTop.tsx")
  assert.match(tsx, /type="button"/)
  assert.match(tsx, /id="to-top"/)
  assert.match(tsx, /aria-label="To top"/)
  assert.match(tsx, /<span>To top<\/span>/)
  assert.ok(!/\son[a-z]+=/.test(tsx), "no inline handler (the CSP forbids it)")
  assert.ok(!tsx.includes("dangerouslySetInnerHTML"))
})

test("to-top: the script binds one nav listener, cleans up and logs nothing", () => {
  const ts = read("local-plugins/to-top/scripts/to-top.inline.ts")
  assert.ok(!ts.includes("console."), "the browser tests fail on console output")
  assert.equal(ts.split('document.addEventListener("nav"').length - 1, 1)
  assert.ok(ts.includes("window.addCleanup"))
})

test("to-top: styles", () => {
  const scss = read("quartz/styles/custom.scss")
  const block = scss.match(/\n\.to-top \{([\s\S]*?)\n\}\n/)
  assert.ok(block, ".to-top block not found in custom.scss")
  const body = block[1]
  assert.match(body, /position:\s*fixed/)
  assert.match(body, /visibility:\s*hidden/)
  assert.ok(
    !/z-index\s*:/.test(body),
    "no z-index: tree order in the bar keeps the drawer and the search above the button",
  )
  assert.ok(px(body.match(/\n\s{2}width:\s*([\d.]+rem)/)[1]) >= 44)
  assert.ok(px(body.match(/\n\s{2}height:\s*([\d.]+rem)/)[1]) >= 44)
  for (const side of ["right", "bottom"]) {
    const plain = body.indexOf(`${side}: 1rem;`)
    const env = body.indexOf(`${side}: max(1rem, env(safe-area-inset-${side}));`)
    assert.ok(plain >= 0 && env > plain, `${side}: plain fallback before the env() line`)
  }
  assert.match(body, /&\.on\s*\{[^}]*visibility:\s*visible/)
  assert.match(
    scss,
    /@media all and \(min-width: 90rem\)\s*\{[^@]*\.to-top span\s*\{\s*display:\s*inline/,
  )
  const print = scss.slice(scss.lastIndexOf("@media print"))
  assert.match(print, /\.to-top,/)
  const footer = scss.match(/& footer \{[^}]*?margin-bottom:\s*([\d.]+rem)/)
  assert.ok(footer && px(footer[1]) >= 80, "the footer clears the button at the end of the page")
})

test("to-top: the browser spec uses the module's constants", () => {
  const spec = read("tests/browser/to-top.spec.ts")
  assert.match(spec, new RegExp(`const MIN_REVEAL = ${MIN_REVEAL}\\b`))
  assert.match(spec, new RegExp(`const STEP = ${REVEAL_STEP}\\b`))
})
