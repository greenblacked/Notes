import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { unified } from "unified"
import rehypeRaw from "rehype-raw"
import { toHtml } from "hast-util-to-html"
import { rehypeCallouts, KIND_LABELS } from "../local-plugins/callouts/index.js"
import { installCalloutFold, FOLD_SCRIPT } from "../local-plugins/callouts/fold.js"

const callout = ({ type = "warning", classes = "", title = "A title", fold = false } = {}) =>
  `<blockquote class="callout ${type} ${classes}" data-callout="${type}"${fold ? " data-callout-fold" : ""}>` +
  `<div class="callout-title"><div class="callout-icon"></div>` +
  `<div class="callout-title-inner"><p>${title}</p></div>` +
  `${fold ? '<div class="fold-callout-icon"></div>' : ""}</div>` +
  `<div class="callout-content"><p>Body</p></div></blockquote>`

// unified ignores a plugin attached twice, so a second pass runs the transformer on the output tree.
function run(html, passes = 1) {
  const processor = unified().use(rehypeRaw).use(rehypeCallouts)
  const tree = processor.runSync({ type: "root", children: [{ type: "raw", value: html }] })
  for (let i = 1; i < passes; i++) rehypeCallouts()(tree)
  return toHtml(tree)
}

test("a custom title gets the kind word in front", () => {
  const out = run(callout({ title: "Rate limits" }))
  assert.match(out, /<p><span class="callout-kind">Warning<\/span> Rate limits<\/p>/)
})

test("a default title is marked and gets no span", () => {
  for (const [type, title] of [
    ["warning", "Warning"],
    ["warning", "Caution"],
    ["abstract", "Tldr"],
  ]) {
    const out = run(callout({ type, title }))
    assert.match(out, /class="callout-title callout-title-default"/, `${type}/${title}`)
    assert.ok(!out.includes("callout-kind"), `${type}/${title}`)
  }
})

test("a custom type gets no span and does not throw", () => {
  const out = run(callout({ type: "foo", title: "Whatever" }))
  assert.ok(!out.includes("callout-kind"))
  assert.ok(out.includes('data-callout="foo"'))
})

test("running the plugin twice gives exactly one span", () => {
  const out = run(callout({ title: "Rate limits" }), 2)
  assert.equal(out.split("callout-kind").length - 1, 1)
})

test("a folding callout becomes a button with its state; others do not", () => {
  const closed = run(callout({ classes: "is-collapsible is-collapsed", fold: true }))
  assert.match(closed, /<div class="callout-title"[^>]*>/)
  assert.ok(closed.includes('role="button"'))
  assert.ok(closed.includes('tabindex="0"'))
  assert.ok(closed.includes('aria-expanded="false"'))
  const open = run(callout({ classes: "is-collapsible", fold: true }))
  assert.ok(open.includes('aria-expanded="true"'))
  const plain = run(callout())
  for (const attr of ["role=", "tabindex=", "aria-expanded="]) assert.ok(!plain.includes(attr))
})

test("icons are hidden from assistive technology", () => {
  const out = run(callout({ classes: "is-collapsible", fold: true }))
  assert.match(
    out,
    /class="callout-icon"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="callout-icon"/,
  )
  assert.match(
    out,
    /class="fold-callout-icon"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="fold-callout-icon"/,
  )
})

test("the hooks other code relies on survive", () => {
  const out = run(callout({ classes: "is-collapsible", fold: true }))
  assert.ok(out.includes("callout warning is-collapsible"))
  assert.ok(out.includes('class="callout-content"'))
  assert.ok(out.includes('data-callout="warning"'))
})

test("every kind label is a plain word", () => {
  for (const label of Object.values(KIND_LABELS)) assert.match(label, /^[A-Za-z ]+$/)
})

// --- fold.js, against a hand-made document ---------------------------------------------------

function fixture({ collapsed = true } = {}) {
  const listeners = {}
  const doc = {
    addEventListener(type, fn) {
      ;(listeners[type] ??= []).push(fn)
    },
  }
  const classes = new Set(["callout", "is-collapsible", ...(collapsed ? ["is-collapsed"] : [])])
  const title = {
    clicks: 0,
    attrs: {},
    parentElement: { classList: { contains: (c) => classes.has(c) } },
    closest(sel) {
      return sel.includes("callout-title") ? title : null
    },
    click() {
      this.clicks++
    },
    setAttribute(k, v) {
      this.attrs[k] = v
    },
  }
  const inner = { closest: () => null }
  const fire = (type, event) => {
    const e = {
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
      ...event,
    }
    for (const fn of listeners[type] ?? []) fn(e)
    return e
  }
  installCalloutFold(doc)
  return { doc, listeners, title, inner, fire, classes }
}

test("fold: Enter clicks once and prevents default; repeat does not click", () => {
  const f = fixture()
  const e = f.fire("keydown", { key: "Enter", target: f.title })
  assert.equal(f.title.clicks, 1)
  assert.ok(e.prevented)
  f.fire("keydown", { key: "Enter", repeat: true, target: f.title })
  assert.equal(f.title.clicks, 1)
})

test("fold: keyCode-only events (no key) fold with Enter and Space", () => {
  const f = fixture()
  const down = f.fire("keydown", { keyCode: 13, target: f.title })
  assert.ok(down.prevented)
  assert.equal(f.title.clicks, 1)
  f.fire("keydown", { keyCode: 32, target: f.title })
  f.fire("keyup", { keyCode: 32, target: f.title })
  assert.equal(f.title.clicks, 2)
})

test("fold: Space toggles on keyup, not keydown; Spacebar behaves the same", () => {
  for (const key of [" ", "Spacebar"]) {
    const f = fixture()
    const down = f.fire("keydown", { key, target: f.title })
    assert.ok(down.prevented)
    assert.equal(f.title.clicks, 0)
    f.fire("keyup", { key, target: f.title })
    assert.equal(f.title.clicks, 1)
    f.fire("keyup", { key, target: f.title })
    assert.equal(f.title.clicks, 1)
  }
})

test("fold: modified keys and keys inside the content are ignored", () => {
  const f = fixture()
  f.fire("keydown", { key: "Enter", ctrlKey: true, target: f.title })
  f.fire("keydown", { key: "Enter", target: f.inner })
  f.fire("keydown", { key: " ", target: f.inner })
  f.fire("keyup", { key: " ", target: f.inner })
  assert.equal(f.title.clicks, 0)
})

test("fold: a click syncs aria-expanded from the fold state", () => {
  const f = fixture({ collapsed: true })
  f.fire("click", { target: f.title })
  assert.equal(f.title.attrs["aria-expanded"], "false")
  f.classes.delete("is-collapsed")
  f.fire("click", { target: f.title })
  assert.equal(f.title.attrs["aria-expanded"], "true")
})

test("fold: installing twice registers the listeners once", () => {
  const f = fixture()
  installCalloutFold(f.doc)
  for (const type of ["keydown", "keyup", "click"]) assert.equal(f.listeners[type].length, 1)
})

test("fold: the inline script parses and has no event-handler attributes", () => {
  assert.doesNotThrow(() => new Function(FOLD_SCRIPT))
  assert.ok(!/\bon[a-z]+\s*=/.test(FOLD_SCRIPT.replace(/\.on[a-z]+\b/g, "")))
})

test("config: the plugin is enabled and runs after the markdown plugin", () => {
  const yaml = fs.readFileSync("quartz.config.yaml", "utf8")
  const m = yaml.match(/source: \.\/local-plugins\/callouts\n\s+enabled: true\n\s+order: (\d+)/)
  assert.ok(m, "callouts entry not found in quartz.config.yaml")
  assert.ok(Number(m[1]) > 30)
})
