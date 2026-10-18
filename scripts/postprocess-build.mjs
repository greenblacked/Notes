#!/usr/bin/env node
// Post-build step that makes the Quartz output satisfy a strict Content-Security-Policy:
// removes every runtime dependency on third-party origins and every `eval` use.
//
// Quartz v5 community plugins load a library from a public CDN at runtime:
//   obsidian-flavored-markdown plugin  mermaid 11.4.0 from cdnjs.cloudflare.com
// and the page head contains a preconnect hint to cdnjs.cloudflare.com.
//
// The explorer plugin also serialises its sort/filter/map functions into a data-data-fns attribute
// and rebuilds them in the browser with `new Function`, which needs script-src 'unsafe-eval'. The
// serialised functions are identical to the defaults hard-coded in the explorer script, so the
// attribute is dropped and the script falls back to those defaults.
//
// The graph (local-plugins/graph, local-plugins/note-graph) is drawn with Canvas 2D and its d3 subset
// is bundled into postscript.js, so it loads nothing from a CDN. Its data is public/static/graph.json,
// a slim index written here from contentIndex.json (see scripts/graph-data.mjs).
//
// Two more adjustments for the site's own design:
//   fonts      Source Serif 4, Inter (the UI) and IBM Plex Mono are self-hosted. quartz/styles/custom.scss
//              declares the @font-face rules for /static/fonts/*.woff2; the files come from the
//              @fontsource and @fontsource-variable devDependencies and are copied to
//              public/static/fonts/ here.
//   light mode the site is light (paper) on the first visit. The darkmode plugin picks the
//              first-visit theme from prefers-color-scheme and re-applies the system theme
//              whenever it changes; both are rewritten so that light is the default and only a
//              saved toggle choice (localStorage "theme") changes it.
//
// This script copies the exact, npm-pinned build of that library (see package.json devDependencies)
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
import { buildGraphData } from "./graph-data.mjs"

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

// 1b. Slim graph index for the graph view.
const contentIndexPath = join(pub, "static", "contentIndex.json")
if (!existsSync(contentIndexPath))
  fail("public/static/contentIndex.json is missing; run `quartz build` first")
const graph = buildGraphData(JSON.parse(readFileSync(contentIndexPath, "utf8")))
if (graph.nodes.length < 100)
  fail(`graph.json would have only ${graph.nodes.length} nodes; expected at least 100`)
writeFileSync(join(pub, "static", "graph.json"), JSON.stringify(graph))

// 2. Rewrite CDN URLs in the built output.
const rewrites = [
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
const fontPackages = [
  nm("@fontsource", "source-serif-4", "files"),
  nm("@fontsource", "ibm-plex-mono", "files"),
  nm("@fontsource-variable", "inter", "files"),
]
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

// 5. Guard: no remaining references to known third-party CDNs / font hosts. In HTML, text inside
// <pre> and <code> is skipped: a note may show such a URL in an example (an OIDC audience, say),
// and text in a code block is never loaded.
const forbidden =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh|googleapis\.com|gstatic\.com|googletagmanager\.com|plausible\.io)/i
const leftovers = []
for (const file of walk(pub)) {
  if (file.startsWith(vendor)) continue
  if (!/\.(js|mjs|html|css|json|xml)$/.test(file)) continue
  let text = readFileSync(file, "utf8")
  if (file.endsWith(".html")) text = text.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, "")
  const m = text.match(forbidden)
  if (m) leftovers.push(`${relative(root, file)}: ${m[0]}`)
}
if (leftovers.length > 0) fail(`third-party origins remain:\n  ${leftovers.join("\n  ")}`)

console.log(
  `postprocess-build: graph.json nodes=${graph.nodes.length} links=${graph.links.length}, rewrote mermaid=${counts[0]} url(s), removed ${preconnects} preconnect hint(s) and ${dataFnsRemoved} data-data-fns attribute(s), copied ${fontFiles.length} font files (${fontBytes} bytes), light theme by default`,
)
