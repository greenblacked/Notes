#!/usr/bin/env node
// Post-build step that makes the Quartz output satisfy a strict Content-Security-Policy:
// removes every runtime dependency on third-party origins and every `eval` use.
//
// Quartz v5 community plugins load a few libraries from public CDNs at runtime:
//   graph plugin     d3@7 and pixi.js@8 from cdn.jsdelivr.net (unpinned major versions)
//   obsidian-flavored-markdown plugin  mermaid 11.4.0 from cdnjs.cloudflare.com
// and the page head contains a preconnect hint to cdnjs.cloudflare.com.
//
// The explorer plugin also serialises its sort/filter/map functions into a data-data-fns attribute
// and rebuilds them in the browser with `new Function`, which needs script-src 'unsafe-eval'. The
// serialised functions are identical to the defaults hard-coded in the explorer script, so the
// attribute is dropped and the script falls back to those defaults.
//
// Two more adjustments for the site's own design:
//   fonts      Source Serif 4 and IBM Plex Mono are self-hosted. quartz/styles/custom.scss declares
//              the @font-face rules for /static/fonts/*.woff2; the files come from the @fontsource
//              devDependencies and are copied to public/static/fonts/ here.
//   light mode the site is light (paper) on the first visit. The darkmode plugin picks the
//              first-visit theme from prefers-color-scheme and re-applies the system theme
//              whenever it changes; both are rewritten so that light is the default and only a
//              saved toggle choice (localStorage "theme") changes it.
//
// This script copies exact, npm-pinned builds of those libraries (see package.json devDependencies)
// to public/static/vendor/ and rewrites the URLs in the built output, so the site only talks to its
// own origin and the CSP can be 'self'-only. It fails loudly if an expected URL is not found, so a
// Quartz or plugin upgrade that changes the loading code cannot silently reintroduce a CDN.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pub = join(root, "public")
const vendor = join(pub, "static", "vendor")
const fonts = join(pub, "static", "fonts")
const nm = (...p) => join(root, "node_modules", ...p)

function fail(msg) {
  console.error(`postprocess-build: ${msg}`)
  process.exit(1)
}
if (!existsSync(pub)) fail("public/ does not exist; run `quartz build` first")

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

// 1. Copy the pinned libraries.
mkdirSync(vendor, { recursive: true })
for (const src of [nm("d3", "dist", "d3.min.js"), nm("pixi.js", "dist", "pixi.min.js")]) {
  if (!existsSync(src)) fail(`missing ${relative(root, src)}; run npm ci`)
}
cpSync(nm("d3", "dist", "d3.min.js"), join(vendor, "d3.min.js"))
// pixi.js v8 compiles shaders with `new Function`, which a CSP without 'unsafe-eval' forbids. PixiJS
// ships an eval-free replacement as a UMD add-on; appended to the same file it patches the global
// PIXI before the graph plugin uses it.
const pixi = readFileSync(nm("pixi.js", "dist", "pixi.min.js"), "utf8")
const pixiNoEval = readFileSync(nm("pixi.js", "dist", "packages", "unsafe-eval.min.js"), "utf8")
writeFileSync(join(vendor, "pixi.min.js"), `${pixi}\n;${pixiNoEval}\n`)
const mermaidDir = join(vendor, "mermaid")
mkdirSync(mermaidDir, { recursive: true })
cpSync(nm("mermaid", "dist", "mermaid.esm.min.mjs"), join(mermaidDir, "mermaid.esm.min.mjs"))
cpSync(
  nm("mermaid", "dist", "chunks", "mermaid.esm.min"),
  join(mermaidDir, "chunks", "mermaid.esm.min"),
  {
    recursive: true,
  },
)

// 2. Rewrite CDN URLs in the built output.
const rewrites = [
  {
    re: /https:\/\/cdn\.jsdelivr\.net\/npm\/d3@[0-9.]+\/dist\/d3\.min\.js/g,
    to: "/static/vendor/d3.min.js",
  },
  {
    re: /https:\/\/cdn\.jsdelivr\.net\/npm\/pixi\.js@[0-9.]+\/dist\/pixi\.js/g,
    to: "/static/vendor/pixi.min.js",
  },
  {
    re: /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mermaid\/[0-9.]+\/mermaid\.esm\.min\.mjs/g,
    to: "/static/vendor/mermaid/mermaid.esm.min.mjs",
  },
]
const counts = rewrites.map(() => 0)
const preconnect = /<link rel="preconnect" href="https:\/\/cdnjs\.cloudflare\.com"[^>]*>/g
let preconnects = 0
const dataFns = /\sdata-data-fns="[^"]*"/g
let dataFnsRemoved = 0

for (const file of walk(pub)) {
  if (file.startsWith(vendor)) continue
  if (!/\.(js|mjs|html|css)$/.test(file)) continue
  let text = readFileSync(file, "utf8")
  const before = text
  rewrites.forEach((r, i) => {
    text = text.replace(r.re, () => {
      counts[i]++
      return r.to
    })
  })
  if (file.endsWith(".html")) {
    text = text.replace(preconnect, () => {
      preconnects++
      return ""
    })
    text = text.replace(dataFns, () => {
      dataFnsRemoved++
      return ""
    })
  }
  if (text !== before) writeFileSync(file, text)
}
if (dataFnsRemoved === 0) fail("no data-data-fns attributes found; explorer markup changed")
rewrites.forEach((r, i) => {
  if (counts[i] === 0) fail(`expected CDN URL not found in build output: ${r.re}`)
})

// 3. Self-hosted fonts: copy every woff2 file that index.css refers to.
const fontPackages = ["source-serif-4", "ibm-plex-mono"].map((name) =>
  nm("@fontsource", name, "files"),
)
const indexCss = readFileSync(join(pub, "index.css"), "utf8")
const fontFiles = [
  ...new Set([...indexCss.matchAll(/\/static\/fonts\/([a-z0-9-]+\.woff2)/g)].map((m) => m[1])),
]
if (fontFiles.length === 0) fail("index.css declares no /static/fonts/*.woff2 files")
mkdirSync(fonts, { recursive: true })
let fontBytes = 0
for (const name of fontFiles) {
  const dir = fontPackages.find((d) => existsSync(join(d, name)))
  if (!dir) fail(`font file ${name} not found in the @fontsource packages; run npm ci`)
  cpSync(join(dir, name), join(fonts, name))
  fontBytes += statSync(join(dir, name)).size
}

// 4. Light by default (see the header comment).
const prescriptPath = join(pub, "prescript.js")
let prescript = readFileSync(prescriptPath, "utf8")
const firstVisit =
  /window\.matchMedia\("\(prefers-color-scheme: light\)"\)\.matches\?"light":"dark"/
const systemChange =
  /let (\w+)=window\.matchMedia\("\(prefers-color-scheme: dark\)"\);\1\.addEventListener\("change",(\w+)\),window\.addCleanup\(\(\)=>\1\.removeEventListener\("change",\2\)\)/
const count = (re) => (prescript.match(new RegExp(re.source, "g")) ?? []).length
if (count(firstVisit) !== 1 || count(systemChange) !== 1) {
  fail(
    "darkmode script not recognised in prescript.js; update the rewrite in postprocess-build.mjs",
  )
}
prescript = prescript.replace(firstVisit, '"light"').replace(systemChange, "")
writeFileSync(prescriptPath, prescript)

// 5. Guard: no remaining references to known third-party CDNs / font hosts.
const forbidden =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh|googleapis\.com|gstatic\.com|googletagmanager\.com|plausible\.io)/i
const leftovers = []
for (const file of walk(pub)) {
  if (file.startsWith(vendor)) continue
  if (!/\.(js|mjs|html|css|json|xml)$/.test(file)) continue
  const m = readFileSync(file, "utf8").match(forbidden)
  if (m) leftovers.push(`${relative(root, file)}: ${m[0]}`)
}
if (leftovers.length > 0) fail(`third-party origins remain:\n  ${leftovers.join("\n  ")}`)

console.log(
  `postprocess-build: rewrote d3=${counts[0]} pixi=${counts[1]} mermaid=${counts[2]} urls, removed ${preconnects} preconnect hint(s) and ${dataFnsRemoved} data-data-fns attribute(s), copied ${fontFiles.length} font files (${fontBytes} bytes), light theme by default`,
)
