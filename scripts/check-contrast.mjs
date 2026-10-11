#!/usr/bin/env node
// Checks WCAG 2.x contrast for the site's colour palette, in both themes, and exits 1 when a
// pair is below its minimum (4.5:1 for text, 3:1 for the focus ring). Prints a Markdown table.
//
// Colours come from the two places that define them:
//   quartz.config.yaml          the Quartz colour keys (light, lightgray, gray, darkgray, dark,
//                               secondary, tertiary, highlight) per theme
//   quartz/styles/custom.scss   the --surface, --surface-2, --muted, --accent, --accepted,
//                               --warning and --chip-* tokens, in the `:root` block (light) and
//                               the `:root[saved-theme="dark"]` block (dark)
// If public/ holds a build, the colours of the code syntax tokens found in its HTML are checked
// against the code surface as well.
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
const syntax = { light: new Set(), dark: new Set() }
const pub = join(root, "public")
if (existsSync(pub)) {
  for (const file of walk(pub)) {
    if (!file.endsWith(".html")) continue
    const html = readFileSync(file, "utf8")
    for (const m of html.matchAll(/--shiki-(light|dark):\s*(#[0-9a-fA-F]{6})/g)) {
      syntax[m[1]].add(m[2].toLowerCase())
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
  const bg = parseColor(q.light)
  const surface = c("surface")
  const surface2 = c("surface-2")
  const highlight = parseColor(q.highlight)

  const surfaces = [
    ["page background", bg],
    ["surface", surface],
    ["surface-2", surface2],
  ]

  for (const [name, back] of surfaces) {
    check(theme, `Body text on ${name}`, parseColor(q.darkgray), back)
  }
  check(theme, "Headings on page background", parseColor(q.dark), bg)
  check(theme, "Headings on surface", parseColor(q.dark), surface)
  for (const [name, back] of surfaces) {
    check(theme, `Muted text on ${name}`, c("muted"), back)
  }
  check(theme, "Gray (secondary text) on page background", parseColor(q.gray), bg)
  check(theme, "Gray (secondary text) on surface", parseColor(q.gray), surface)
  for (const [name, back] of surfaces) {
    check(theme, `Accent links on ${name}`, c("accent"), back)
  }
  check(
    theme,
    "Accent link on internal-link highlight (surface)",
    c("accent"),
    over(highlight, surface),
  )
  check(
    theme,
    "Accent link on internal-link highlight (page background)",
    c("accent"),
    over(highlight, bg),
  )
  check(theme, "Link hover (tertiary) on surface", parseColor(q.tertiary), surface)
  check(theme, "Accepted green as text on surface", c("accepted"), surface)
  check(theme, "Warning amber as text on surface", c("warning"), surface)

  for (const kind of ["neutral", "accepted", "proposed", "warning"]) {
    check(
      theme,
      `Chip text on chip background (${kind})`,
      c(`chip-${kind}-fg`),
      c(`chip-${kind}-bg`),
    )
  }

  check(theme, "Code text on surface-2", parseColor(q.darkgray), surface2)
  check(theme, "Inline code text (headings colour) on surface-2", parseColor(q.dark), surface2)
  check(theme, "Filename caption (muted) on surface-2", c("muted"), surface2)

  const tokenColors = [...syntax[theme]]
  if (tokenColors.length > 0) {
    const worst = tokenColors
      .map((h) => ({ h, r: ratio(parseColor(h), surface2) }))
      .sort((a, b) => a.r - b.r)[0]
    check(
      theme,
      `Code syntax tokens on surface-2 (worst of ${tokenColors.length} colours)`,
      parseColor(worst.h),
      surface2,
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
