import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const scss = fs.readFileSync("quartz/styles/custom.scss", "utf8")
const start = scss.indexOf("// Callouts\n")
const end = scss.indexOf("// ====", scss.indexOf("// ====", start) + 10)
const section = scss.slice(start, end)

// Same slicing as scripts/check-contrast.mjs: the text of one selector's block in custom.scss.
function block(selector) {
  const i = scss.indexOf(`${selector} {`)
  assert.ok(i >= 0, `${selector} block not found`)
  return scss.slice(i, scss.indexOf("\n}", i))
}

test("the section is found", () => {
  assert.ok(section.length > 500)
  assert.ok(section.includes(".callout[data-callout]"))
})

test("no box, no capitals, no interface-type recipe", () => {
  assert.doesNotMatch(section, /@extend\s+%label/)
  assert.doesNotMatch(section, /text-transform:\s*uppercase/)
  assert.doesNotMatch(section, /letter-spacing:\s*0\.\d/)
  assert.match(section, /border-radius:\s*0;/)
  assert.doesNotMatch(section, /background(?:-color)?:\s*var\(--surface\)/)
  assert.match(section, /\.callout-icon\s*\{\s*display:\s*none/)
})

test("the callout contains its float and does not clip the focus ring", () => {
  assert.match(section, /display:\s*flow-root/)
  assert.match(section, /overflow:\s*visible/)
  assert.match(section, /@supports not \(display: flow-root\)/)
})

test("the run-in label applies only to callouts that do not fold", () => {
  assert.match(
    section,
    /\.callout\[data-callout\]:not\(\.is-collapsible\)\s*\{[\s\S]*?float:\s*left/,
  )
})

test("folded content is hidden from assistive technology and the first child is realigned", () => {
  assert.match(section, /\.is-collapsed > \.callout-content\s*\{\s*visibility:\s*hidden/)
  assert.match(section, /\.is-collapsed > \.callout-content > :first-child\s*\{\s*margin-top:\s*0/)
  assert.match(
    section,
    /\.is-collapsed > \.callout-title ~ :not\(\.callout-content\)\s*\{\s*display:\s*none/,
  )
})

test("the folding title is a 44px target and the hover rule needs a hover device", () => {
  assert.match(section, /\.is-collapsible > \.callout-title\s*\{[^}]*min-height:\s*2\.75rem/)
  assert.match(section, /@media \(hover: hover\)\s*\{[\s\S]*?:hover/)
})

test("the dead caution selector is gone", () => {
  assert.ok(!section.includes('[data-callout="caution"]'))
})

test("--danger is defined in the light, dark and print token blocks", () => {
  assert.match(block(":root"), /--danger:\s*#[0-9a-f]{6};/i)
  assert.match(block(':root[saved-theme="dark"]'), /--danger:\s*#[0-9a-f]{6};/i)
  const print = scss.slice(scss.indexOf("@media print"))
  assert.match(print, /--danger:\s*#[0-9a-f]{6};/i)
})

test("the contrast check covers the severe label", () => {
  assert.ok(
    fs
      .readFileSync("scripts/check-contrast.mjs", "utf8")
      .includes("Callout label, severe (danger)"),
  )
})

test("the global reduced-motion block still removes transitions", () => {
  assert.match(
    scss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none !important/,
  )
})
