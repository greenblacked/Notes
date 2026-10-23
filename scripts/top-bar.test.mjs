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

test("section row tuck: layout-neutral, only a descendant moves", () => {
  const start = scss.indexOf(":root[data-bar-tucked]")
  assert.ok(start > 0, "tuck block missing")
  const end = scss.indexOf("\n}\n", start)
  const block = scss.slice(start, end)
  assert.match(block, /\.section-row-links\s*\{[^}]*translate3d\(0,\s*-100%,\s*0\)/)
  for (const bad of ["height", "--sticky-h", "--header-h", "grid-template", "margin", "padding"]) {
    assert.ok(!block.includes(bad), `tuck block must not touch ${bad}`)
  }
  assert.ok(!/\btop\s*:/.test(block), "tuck block must not move top")
  assert.match(
    block,
    /&::before\s*\{[^}]*pointer-events:\s*auto/,
    "the band must keep catching taps over row 1 while tucked",
  )
  assert.ok(!block.includes(":has("), "no :has() in the tuck block (old Safari)")
  assert.match(scss, /--sticky-h:\s*var\(--header-h\)/)
  assert.match(scss, /height:\s*var\(--header-h\)/)
})

test("section row tuck: shows without JavaScript, state lives on the root only", () => {
  const base = scss.match(/\n\.section-row-links\s*\{([^}]*)\}/)
  assert.ok(base, "base .section-row-links block not found")
  assert.ok(!base[1].includes("transform:"), "the resting links have no transform")
  for (const f of [
    "local-plugins/top-bar/TopBar.tsx",
    "local-plugins/section-row/SectionRow.tsx",
    "local-plugins/top-bar/scripts/top-bar.early.inline.ts",
  ]) {
    assert.ok(!read(f).includes("data-bar-tucked"), `${f} must not set the tuck state`)
  }
})

test("section row tuck: reduced motion switches it off, transitions animate bottom or transform", () => {
  assert.match(
    scss,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition:\s*none !important/,
  )
  const props = [
    ...scss.matchAll(/transition:\s*(bottom|transform) var\(--dur\) var\(--ease-out\);/g),
  ]
  assert.ok(props.length >= 3, "bottom on ::before and ::after, transform on the links")
})

test("section row tuck: the deferred script", () => {
  const main = read("local-plugins/top-bar/scripts/top-bar.inline.ts")
  const start = main.indexOf("function setupHideOnScroll")
  assert.ok(start > 0)
  const fn = main.slice(start, main.indexOf("\nfunction setupLandmarks", start))
  assert.match(fn, /addEventListener\("scroll",\s*schedule,\s*\{\s*passive:\s*true\s*\}\)/)
  assert.ok(fn.includes("requestAnimationFrame"))
  assert.match(fn, /addCleanup\([\s\S]*removeAttribute\(TUCKED\)/)
  assert.match(fn, /try\s*\{[^}]*:focus-visible/)
  // Without :focus-visible a clicked link must not hold the row: the last input device decides.
  assert.match(fn, /catch\s*\{\s*return !pointerLast/)
  assert.match(fn, /addEventListener\("pointerdown",\s*onPointer,\s*\{[^}]*passive:\s*true/)
  assert.match(fn, /addEventListener\("keydown",\s*onKey/)
  assert.match(fn, /removeEventListener\("pointerdown",\s*onPointer/)
  assert.match(fn, /removeEventListener\("keydown",\s*onKey/)
  assert.match(main, /setupTocSpy\(\)\n\s*setupHideOnScroll\(\)/)
  assert.match(main, /"prenav"[\s\S]*?removeAttribute\(TUCKED\)/)
  assert.ok(!main.includes("focusin"), "focusin belongs to the early script")
  // The bundler strips the first "export" of every *.inline.ts, even inside a comment.
  assert.ok(!/export/.test(main), "no 'export' in the inline script")
})

const topBar = read("local-plugins/top-bar/scripts/top-bar.inline.ts")

test("theme switch: no per-element theme fade, transitions off for the flip", () => {
  assert.ok(!scss.includes("theme-fade"), "the per-element .theme-fade is gone")
  assert.ok(!topBar.includes("theme-fade"))
  assert.match(
    scss,
    /:root\.theme-switching \*:not\(\.darkmode > svg\):not\(\.section-row-links\),[\s\S]*?\{\s*transition:\s*none !important;/,
  )
  // The tuck motion (links' slide, the bar's band and line edge) keeps sliding through the flip.
  assert.match(scss, /:root\.theme-switching \*:not\(\.sidebar\.left\)::before,/)
  assert.match(scss, /:root\.theme-switching \*:not\(\.sidebar\.left\)::after,/)
  assert.match(
    scss,
    /:root\.theme-switching\[data-theme-snapshot\] \.darkmode > svg[\s\S]*?\{\s*transition:\s*none !important;/,
  )
  assert.ok(!scss.includes("--ease-spring"), "the theme icon must not overshoot")
  assert.ok(
    !/transition-property:[^;]*\b(opacity|transform|visibility)\b[^;]*!important/.test(scss),
    "no global forced transform/opacity/visibility transition",
  )
})

test("theme switch: one snapshot cross-fade, short, motion-gated, click-through", () => {
  const dur = scss.match(/--dur-theme:\s*(\d+)ms/)
  assert.ok(dur && Number(dur[1]) <= 200, "--dur-theme must be 200ms or less")
  assert.match(
    scss,
    /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*::view-transition-group\(root\),\s*::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{[^}]*animation-duration:\s*var\(--dur-theme\)/,
  )
  assert.match(scss, /::view-transition\s*\{\s*pointer-events:\s*none;/)
})

test("theme switch: script feature-detects the API, respects reduced motion, no fixed timer", () => {
  assert.match(topBar, /typeof start !== "function"/)
  assert.match(topBar, /reducedMotion\(\) \|\| typeof start/)
  assert.match(topBar, /addEventListener\(\s*"click",[\s\S]*?,\s*true,?\s*\)/)
  assert.match(topBar, /vt\.ready\.catch\(/)
  assert.match(topBar, /beginSwitch\(true\)/)
  assert.match(topBar, /removeAttribute\(SNAPSHOT\)/)
  assert.ok(!/setTimeout\([^)]*theme[^)]*,\s*450\)/.test(topBar), "the fixed 450ms timer is gone")
})

test("theme switch: diagrams keep their height while Mermaid redraws them", () => {
  // The lock is taken in a themechange listener registered at load (before Mermaid's own). The
  // page cannot move while it holds, so the tuck follows every scroll; it only takes the move that
  // letting go may cause (scroll anchoring) as the page's.
  assert.match(topBar, /addEventListener\("themechange", \(\) => \{\s*lockMermaidHeights\(\)/)
  assert.match(topBar, /if \(takeLayoutShift\(y - state\.lastY\)\) \{/)
  assert.ok(!topBar.includes("layoutShifting"), "scrolls during the lock are the reader's")
  assert.match(topBar, /querySelector\(":scope > svg"\)/, "a finished drawing only")
  assert.match(
    topBar,
    /querySelectorAll<HTMLElement>\("\.center code\.mermaid"\)/,
    "only the drawn page",
  )
  assert.match(
    topBar,
    /const svg = drawnSvg\(code\)\s*if \(!svg\) continue/,
    "never waits on an unrendered block",
  )
  assert.match(topBar, /"prenav", \(\) => \{\s*mermaidLock\?\.release\(true\)/)
  assert.match(
    topBar,
    /if \(mermaidLock\) \{\s*mermaidLock\.rearm\(\)/,
    "a second switch keeps the lock until the latest redraw",
  )
  assert.match(topBar, /MERMAID_IDLE_MS\)/, "a failed redraw lets go")
  assert.match(topBar, /const MERMAID_IDLE_MS = 3000/)
  assert.match(topBar, /const MERMAID_CEILING_MS = 10_000/, "the lock can never hang")
  assert.match(
    topBar,
    /new MutationObserver\(\(\) => \{\s*(?:\/\/[^\n]*\s*)*window\.clearTimeout\(timer\)\s*timer = window\.setTimeout\(\(\) => release\(\), MERMAID_IDLE_MS\)/,
    "redraw progress restarts the idle wait",
  )
  assert.match(
    topBar,
    /ceiling = window\.setTimeout\(\(\) => release\(\), MERMAID_CEILING_MS\)/,
    "the hard ceiling is armed",
  )
})
