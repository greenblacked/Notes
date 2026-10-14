#!/usr/bin/env node
// Checks WCAG 2.x contrast for the site's colour palette, in both themes, and exits 1 when a
// pair is below its minimum (4.5:1 for text, 3:1 for the focus ring). Prints a Markdown table.
//
// Colours come from the two places that define them:
//   quartz.config.yaml          the Quartz colour keys (light = the sheet of paper, lightgray,
//                               gray, darkgray, dark, secondary, tertiary, highlight) per theme
//   quartz/styles/custom.scss   the --desk, --surface, --accepted, --warning, --grain-color and
//                               --chip-* tokens, in the `:root` block (light) and the
//                               `:root[saved-theme="dark"]` block (dark)
// Text sits on the sheet (with the paper grain, checked at its maximum strength), on the desk (the
// top bar and the table of contents; the bar is translucent, so it is the desk or the sheet,
// whichever is behind it) and on the surface tint (callouts, code, cards, the drawer's hover
// state). If public/ holds a build, the colours
// of the code syntax tokens found in its HTML are checked against the code surface as well.
//
// Usage: node scripts/check-contrast.mjs [--out <file>]   (also saved to <file> as Markdown)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outIndex = process.argv.indexOf("--out")
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : undefined

const TEXT = 4.5
const UI = 3
// Strongest opacity of the grain (the alpha row of the feColorMatrix in custom.scss).
const GRAIN_MAX = { light: 0.05, dark: 0.03 }

function parseColor(value) {
  const v = value.trim().toLowerCase()
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    }
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v)
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  throw new Error(`cannot parse colour "${value}"`)
}

/** Colour `fg` (maybe translucent) painted over the opaque colour `bg`. */
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
})

const hex = (c) =>
  `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`

function luminance({ r, g, b }) {
  const lin = [r, g, b].map((x) => {
    const s = x / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// --- read the palette ---------------------------------------------------------------------

const config = YAML.parse(readFileSync(join(root, "quartz.config.yaml"), "utf8"))
const quartzColors = {
  light: config.configuration.theme.colors.lightMode,
  dark: config.configuration.theme.colors.darkMode,
}

const scss = readFileSync(join(root, "quartz/styles/custom.scss"), "utf8")
function tokens(selector) {
  const start = scss.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`token block "${selector}" not found in custom.scss`)
  const end = scss.indexOf("\n}", start)
  const out = {}
  for (const m of scss.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    out[m[1]] = m[2]
  }
  return out
}
const customTokens = { light: tokens(":root"), dark: tokens(':root[saved-theme="dark"]') }

// --- syntax token colours from a build ----------------------------------------------------

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}
// custom.scss darkens a syntax colour that is below AA on the surface tint (light theme only).
const syntaxOverrides = new Map(
  [
    ...scss.matchAll(
      /--shiki-light:(#[0-9a-fA-F]{6})" i\]\s*\{\s*--shiki-light:\s*(#[0-9a-fA-F]{6})\s*!important/g,
    ),
  ].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]),
)
const syntax = { light: new Set(), dark: new Set() }
const pub = join(root, "public")
if (existsSync(pub)) {
  for (const file of walk(pub)) {
    if (!file.endsWith(".html")) continue
    const html = readFileSync(file, "utf8")
    for (const m of html.matchAll(/--shiki-(light|dark):\s*(#[0-9a-fA-F]{6})/g)) {
      const color = m[2].toLowerCase()
      syntax[m[1]].add(m[1] === "light" ? (syntaxOverrides.get(color) ?? color) : color)
    }
  }
}

// --- pairs --------------------------------------------------------------------------------

const rows = []
function check(theme, label, fg, bg, min = TEXT) {
  const r = ratio(fg, bg)
  rows.push({ theme, label, fg: hex(fg), bg: hex(bg), ratio: r, min, ok: r >= min })
}

for (const theme of ["light", "dark"]) {
  const q = quartzColors[theme]
  const t = customTokens[theme]
  const c = (name) => parseColor(name in t ? t[name] : q[name])
  const sheet = parseColor(q.light)
  const grainy = over({ ...c("grain-color"), a: GRAIN_MAX[theme] }, sheet)
  const desk = c("desk")
  const surface = c("surface")
  const highlight = parseColor(q.highlight)

  const surfaces = [
    ["sheet", sheet],
    ["sheet with grain", grainy],
    ["desk", desk],
    ["surface tint", surface],
  ]
  const sheetOnly = surfaces.filter(([name]) => name.startsWith("sheet"))

  for (const [name, back] of surfaces) {
    check(theme, `Body text on ${name}`, parseColor(q.darkgray), back)
  }
  for (const [name, back] of surfaces) {
    check(theme, `Headings and ink on ${name}`, parseColor(q.dark), back)
  }
  for (const [name, back] of surfaces) {
    check(theme, `Muted text on ${name}`, parseColor(q.gray), back)
  }
  for (const [name, back] of surfaces) {
    check(theme, `Links and accent on ${name}`, parseColor(q.secondary), back)
  }
  check(
    theme,
    "Link on internal-link highlight (sheet)",
    parseColor(q.secondary),
    over(highlight, sheet),
  )
  for (const [name, back] of [...sheetOnly, ["desk", desk]]) {
    check(theme, `Link hover (tertiary) on ${name}`, parseColor(q.tertiary), back)
  }
  check(theme, "Accepted green as text on surface tint", c("accepted"), surface)
  check(theme, "Warning amber as text on surface tint", c("warning"), surface)

  for (const kind of ["neutral", "accepted", "proposed", "warning"]) {
    check(
      theme,
      `Chip text on chip background (${kind})`,
      c(`chip-${kind}-fg`),
      c(`chip-${kind}-bg`),
    )
  }
  // Tags are neutral chips; their hover state, the accent, and the section a note belongs to in
  // the top bar and in the drawer (accent on the link highlight) sit on tints as well.
  check(
    theme,
    "Tag chip hover (accent) on chip background",
    parseColor(q.secondary),
    c("chip-neutral-bg"),
  )
  check(
    theme,
    "Tag chip hover (tertiary) on chip background",
    parseColor(q.tertiary),
    c("chip-neutral-bg"),
  )
  check(
    theme,
    "Accent on link highlight (desk): current section in the bar",
    parseColor(q.secondary),
    over(highlight, desk),
  )
  check(
    theme,
    "Accent on link highlight (surface tint)",
    parseColor(q.secondary),
    over(highlight, surface),
  )
  check(theme, "Focus ring on chip background", parseColor(q.secondary), c("chip-neutral-bg"), UI)
  check(theme, "Interface text (ink) on desk: top bar links on the band", parseColor(q.dark), desk)

  // The outlined type chip is ink on whatever it sits on.
  check(theme, "Type chip (ink) on sheet with grain", parseColor(q.dark), grainy)
  check(theme, "Type chip (ink) on surface tint (phone cards)", parseColor(q.dark), surface)

  check(theme, "Callout title (ink) on surface tint", parseColor(q.dark), surface)
  check(theme, "Code text on surface tint", parseColor(q.darkgray), surface)
  check(theme, "Inline code (ink) on surface tint", parseColor(q.dark), surface)
  check(theme, "Filename caption (muted) on surface tint", parseColor(q.gray), surface)

  const tokenColors = [...syntax[theme]]
  if (tokenColors.length > 0) {
    const worst = tokenColors
      .map((h) => ({ h, r: ratio(parseColor(h), surface) }))
      .sort((a, b) => a.r - b.r)[0]
    check(
      theme,
      `Code syntax tokens on surface tint (worst of ${tokenColors.length} colours)`,
      parseColor(worst.h),
      surface,
    )
  }

  // Focus ring (non-text, 3:1) against everything it can sit on.
  for (const [name, back] of surfaces) {
    check(theme, `Focus ring on ${name}`, parseColor(q.secondary), back, UI)
  }
}

// --- report -------------------------------------------------------------------------------

const lines = [
  "| Theme | Pair | Foreground | Background | Ratio | Minimum | Result |",
  "| ----- | ---- | ---------- | ---------- | ----: | ------: | ------ |",
  ...rows.map(
    (r) =>
      `| ${r.theme} | ${r.label} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)} | ${r.min} | ${r.ok ? "pass" : "FAIL"} |`,
  ),
]
const failed = rows.filter((r) => !r.ok)
const noBuild =
  syntax.light.size + syntax.dark.size === 0
    ? "\nSyntax token colours were not checked: no build found in public/ (run `npm run build` first).\n"
    : ""
const summary = `\n${rows.length - failed.length} of ${rows.length} pairs meet WCAG AA${failed.length ? `; ${failed.length} FAILED` : ""}.\n${noBuild}`
const report = `${lines.join("\n")}\n${summary}`

console.log(report)
if (outFile) writeFileSync(outFile, report)
process.exit(failed.length > 0 ? 1 : 0)
