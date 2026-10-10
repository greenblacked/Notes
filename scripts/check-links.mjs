#!/usr/bin/env node
// Checks internal links and asset references in the built site (public/**/*.html).
// Run after `npm run build`. Exits 1 if any internal href/src cannot be resolved.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = resolve(process.env.PUBLIC_DIR || join(root, "public"))

if (!existsSync(publicDir)) {
  console.error(`check-links: ${publicDir} does not exist. Run \`npm run build\` first.`)
  process.exit(2)
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

const files = [...walk(publicDir)]
const htmlFiles = files.filter((f) => f.endsWith(".html"))
const known = new Set(files.map((f) => relative(publicDir, f).split(sep).join("/")))

const attrRe = /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i // any scheme (https:, mailto:, data:, ...) or protocol-relative

function pagePath(file) {
  return "/" + relative(publicDir, file).split(sep).join("/")
}

/** Does a site path (no leading slash, no query/hash) map to an emitted file? */
function exists(sitePath) {
  const p = decodeURIComponent(sitePath).replace(/\/+$/, "")
  if (p === "") return known.has("index.html")
  return known.has(p) || known.has(`${p}.html`) || known.has(`${p}/index.html`)
}

function resolveHref(fromFile, ref) {
  const clean = ref.split("#")[0].split("?")[0]
  if (clean === "") return null // "#anchor" or "?query" only
  const base = new URL(pagePath(fromFile), "http://site.invalid")
  const url = new URL(clean, base)
  return url.pathname.replace(/^\//, "")
}

const broken = []
let checked = 0
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8")
  for (const m of html.matchAll(attrRe)) {
    const ref = (m[2] ?? m[3] ?? "").trim()
    if (ref === "" || ref.startsWith("#") || SKIP.test(ref)) continue
    let target
    try {
      target = resolveHref(file, ref)
    } catch {
      broken.push({ file, ref, why: "unparseable" })
      continue
    }
    if (target === null) continue
    checked++
    let ok = false
    try {
      ok = exists(target)
    } catch {
      ok = false
    }
    if (!ok) broken.push({ file, ref, why: "not found" })
  }
}

if (broken.length > 0) {
  console.error(`check-links: ${broken.length} broken internal link(s):`)
  for (const b of broken) {
    console.error(`  ${relative(root, b.file)}: ${b.ref} (${b.why})`)
  }
  process.exit(1)
}
console.log(`check-links: ${checked} internal references in ${htmlFiles.length} pages OK`)
