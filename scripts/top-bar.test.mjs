import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const scss = fs.readFileSync("quartz/styles/custom.scss", "utf8")
const read = (f) => fs.readFileSync(f, "utf8")
const px = (v) => (v.endsWith("rem") ? parseFloat(v) * 16 : parseFloat(v))

test("second row: the section row is a registered component after the toolbar", () => {
  assert.match(read("quartz.ts"), /componentRegistry\.register\(\s*"section-row"/)
  const yaml = read("quartz.config.yaml")
  const entry = yaml.match(
    /source: \.\/local-plugins\/section-row\n\s+enabled: true\n\s+layout:\n\s+position: left\n\s+priority: (\d+)/,
  )
  assert.ok(entry, "section-row entry not found in quartz.config.yaml")
  const toolbar = yaml.match(/priority: (\d+)\n\s+group: toolbar/)
  assert.ok(toolbar, "toolbar group not found")
  assert.ok(Number(entry[1]) > Number(toolbar[1]), "the section row must come after the toolbar")
  const tsx = read("local-plugins/top-bar/TopBar.tsx")
  assert.ok(!tsx.includes("SECTIONS"), "TopBar must not render the section links")
  assert.ok(!tsx.includes("-links"), "TopBar must not render the section links")
})

test("second row: scrolls sideways inside its own row, no fit threshold", () => {
  assert.match(scss, /\.section-row\s*\{[^}]*overflow-x:\s*auto/)
  assert.match(scss, /\.section-row\s*\{[^}]*scrollbar-width:\s*none/)
  assert.match(scss, /grid-template-rows:\s*var\(--bar-h\)\s+var\(--sec-h\)/)
  assert.ok(!scss.includes("$compact-bar"), "the one-row fit threshold is gone")
  // (Another, unrelated container query exists further down the file.)
  assert.ok(
    !/@container\s+(?:top-bar|section)|container-name:\s*(?:top-bar|section)/.test(scss),
    "container queries caused flashes on font load",
  )
})

test("second row: anchors and the rail use the sticky height of both rows", () => {
  assert.match(scss, /scroll-padding-top:\s*calc\(var\(--sticky-h\)/)
  assert.match(scss, /top:\s*calc\(var\(--sticky-h\)\s*\+\s*1\.25rem\)/)
  assert.ok(!/var\(--bar-h\)\s*\+\s*1\.25rem/.test(scss), "stale one-row offset")
})

test("second row: the row is tall enough for the links and their focus rings", () => {
  const sec = scss.match(/--sec-h:\s*([\d.]+(?:rem|px))/)
  const link = scss.match(
    /\.section-row-links\s*\{[\s\S]*?& a\s*\{[\s\S]*?height:\s*([\d.]+(?:rem|px))/,
  )
  assert.ok(sec && link, "--sec-h or the link height not found")
  assert.ok(px(sec[1]) >= px(link[1]) + 8, "--sec-h must leave 4px above and below the link")
})

test("second row: the centring script is constant text the CSP hash can cover", () => {
  const tsx = read("local-plugins/section-row/SectionRow.tsx")
  const m = tsx.match(/const CENTRE_CURRENT =\s*'([^']*)'/)
  assert.ok(m, "CENTRE_CURRENT not found")
  assert.ok(!m[1].includes("${"), "no interpolation")
  assert.ok(!m[1].includes("</"), "no closing tag")
  assert.ok(m[1].includes("aria-current"))
})

test("search plugin keeps the hooks the top-bar bridge relies on", (t) => {
  const file = ".quartz/plugins/search/src/components/scripts/search.inline.ts"
  if (!fs.existsSync(file)) return t.skip("search plugin not restored")
  const src = fs.readFileSync(file, "utf8")
  assert.match(src, /e\.stopPropagation\(\);\s*showSearch\("basic"\)/)
  assert.match(src, /results\.className = "results-container"/)
  assert.match(src, /class="card-description"/)
})

test("search results clamp the snippet to three lines", () => {
  assert.ok(!scss.includes("p.preview"), "stale p.preview selector")
  assert.match(scss, /p\.card-description\s*\{[^}]*-webkit-line-clamp:\s*3/)
})

test("search click bridge and focus handler run from the head, before postscript.js", () => {
  const tsx = read("local-plugins/top-bar/TopBar.tsx")
  assert.match(tsx, /TopBar\.beforeDOMLoaded = earlyScript/)
  const early = read("local-plugins/top-bar/scripts/top-bar.early.inline.ts")
  const main = read("local-plugins/top-bar/scripts/top-bar.inline.ts")
  assert.ok(early.includes("focusin") && early.includes("openEarly"))
  assert.ok(
    !main.includes("openEarly") && !main.includes("focusin"),
    "must not be in the deferred bundle",
  )
})

test("top bar: focus rings are not clipped, the wordmark has a 44 x 32 hit area", () => {
  assert.ok(!/^\s*overflow-clip-margin\s*:/m.test(scss), "overflow-clip-margin is not in Safari")
  assert.match(scss, /\.top-bar-brand\s*\{[^}]*padding-block:\s*0\.375rem/)
})
