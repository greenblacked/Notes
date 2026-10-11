import assert from "node:assert/strict"
import { test } from "node:test"
import { toHtml } from "hast-util-to-html"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import Sidenotes from "../local-plugins/sidenotes/index.js"

async function render(markdown) {
  const [rehypeSidenotes] = Sidenotes().htmlPlugins()
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeSidenotes)
  const tree = await processor.run(processor.parse(markdown))
  return toHtml(tree)
}

test("sidenotes: a plain footnote becomes a sidenote next to its reference", async () => {
  const html = await render("Text.[^a] More text.\n\n[^a]: The note, with `code`.\n")
  assert.match(html, /<\/sup><span class="sidenote" role="note">/)
  assert.match(
    html,
    /<span class="sidenote-num" aria-hidden="true">1<\/span>The note, with <code>code<\/code>\.<\/span>/,
  )
  // The footnotes section stays in the page (shown below the desktop breakpoint) and is marked.
  assert.match(html, /<section data-footnotes class="footnotes" data-sidenotes(?:="")?>/)
})

test("sidenotes: the copy has no back-reference link and no duplicate ids", async () => {
  const html = await render("Text.[^a]\n\n[^a]: Note.\n")
  const sidenote = html.slice(
    html.indexOf('<span class="sidenote"'),
    html.indexOf("</span></span>") + 14,
  )
  assert.ok(!sidenote.includes("data-footnote-backref"))
  assert.ok(!/\sid=/.test(sidenote))
})

test("sidenotes: several paragraphs are joined", async () => {
  const html = await render("Text.[^a]\n\n[^a]: First.\n\n    Second.\n")
  assert.match(html, /First\. Second\.<\/span>/)
})

test("sidenotes: a footnote with a list stays a normal footnote", async () => {
  const html = await render("Text.[^a]\n\n[^a]: Intro.\n\n    - one\n    - two\n")
  assert.ok(!html.includes('class="sidenote"'))
  assert.ok(!html.includes("data-sidenotes"))
})

test("sidenotes: a page without footnotes is left alone", async () => {
  const html = await render("Just text.\n")
  assert.equal(html, "<p>Just text.</p>")
})
