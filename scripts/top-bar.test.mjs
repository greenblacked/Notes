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
