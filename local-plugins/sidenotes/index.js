// Turns Markdown footnotes into sidenotes. Every footnote reference gets a sibling
// `<span class="sidenote">` with a copy of the footnote text, and the footnotes section is marked
// with `data-sidenotes`. Nothing is hidden here: quartz/styles/custom.scss shows the sidenotes
// and hides the footnotes section from 1200px up, and does the opposite below that, so the page
// needs no script.
//
// A page is converted only as a whole: every footnote must be plain paragraphs (no lists, code
// blocks, tables or nested footnote references) and every reference must sit in running text
// (not in a callout, table, heading or link). Otherwise the page keeps normal footnotes at every
// width. Each reference, including a repeated one, gets its own copy of the note.
import { visit } from "unist-util-visit"

const BLOCKS_THAT_STAY_FOOTNOTES = new Set([
  "ul",
  "ol",
  "pre",
  "table",
  "blockquote",
  "div",
  "section",
])

const isElement = (node, tagName) => node?.type === "element" && node.tagName === tagName
const hasDataProp = (node, name) =>
  node.properties?.[name] !== undefined && node.properties[name] !== false

/** Copy of a node without ids, so the page never gets duplicate ids. */
function cloneWithoutIds(node) {
  const copy = structuredClone(node)
  visit(copy, "element", (el) => {
    if (el.properties) delete el.properties.id
  })
  return copy
}

/**
 * Inline content of a footnote `<li>`: its paragraphs joined by spaces, without the back-reference
 * link. Returns undefined when the footnote holds anything other than paragraphs.
 */
function inlineContent(li) {
  const out = []
  for (const child of li.children) {
    if (child.type === "text") {
      if (child.value.trim() !== "") return undefined
      continue
    }
    if (!isElement(child, "p")) return undefined
    if (out.length > 0) out.push({ type: "text", value: " " })
    for (const node of child.children) {
      if (isElement(node, "a") && hasDataProp(node, "dataFootnoteBackref")) continue
      if (node.type === "element" && BLOCKS_THAT_STAY_FOOTNOTES.has(node.tagName)) return undefined
      out.push(cloneWithoutIds(node))
    }
  }
  // Drop the whitespace that sat in front of the back-reference link.
  while (out.length > 0) {
    const last = out[out.length - 1]
    if (last.type !== "text") break
    last.value = last.value.trimEnd()
    if (last.value !== "") break
    out.pop()
  }
  return out.length > 0 ? out : undefined
}

// Places where a margin note cannot sit: it would be clipped (callouts and tables hide their
// overflow), nested inside a link, or sit in a heading that is also copied into the ToC.
const NO_SIDENOTE_INSIDE = new Set(["a", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"])
const isCallout = (node) =>
  node.type === "element" &&
  []
    .concat(node.properties?.className ?? [])
    .some((c) => c === "callout" || c === "callout-content")

/** Footnote references outside the footnotes section, each with its parent and index. */
function collectRefs(tree, section) {
  const refs = []
  const walk = (node, ancestors) => {
    if (node === section || !node.children) return
    node.children.forEach((child, index) => {
      if (child.type !== "element") return
      if (child.tagName === "sup") {
        const a = child.children.find((c) => isElement(c, "a") && hasDataProp(c, "dataFootnoteRef"))
        if (a) {
          const blocked = ancestors.some((n) => NO_SIDENOTE_INSIDE.has(n.tagName) || isCallout(n))
          refs.push({ sup: child, a, parent: node, index, blocked })
          return
        }
      }
      walk(child, [...ancestors, child])
    })
  }
  walk(tree, [])
  return refs
}

function rehypeSidenotes() {
  return (tree) => {
    let section
    const items = new Map()
    visit(tree, "element", (node) => {
      if (node.tagName === "section" && hasDataProp(node, "dataFootnotes")) section = node
      if (node.tagName === "li" && typeof node.properties?.id === "string") {
        items.set(node.properties.id, node)
      }
    })
    if (!section) return

    // All or nothing: the footnotes section is hidden on wide screens only when every reference
    // gets its own sidenote. One footnote that cannot be shown in the margin (a list or code in
    // it, a footnote that cites another, a reference inside a callout, table, heading or link)
    // keeps the whole page on normal footnotes, so no note is ever shown twice or lost.
    const refs = collectRefs(tree, section)
    if (refs.length === 0 || refs.some((r) => r.blocked)) return
    const contents = new Map()
    for (const { a } of refs) {
      const href = a.properties?.href
      if (typeof href !== "string" || !href.startsWith("#")) return
      const id = decodeURIComponent(href.slice(1))
      if (contents.has(id)) continue
      const li = items.get(id)
      const content = li && inlineContent(li)
      if (!content) return
      let nested = false
      visit({ type: "root", children: content }, "element", (n) => {
        if (hasDataProp(n, "dataFootnoteRef")) nested = true
      })
      if (nested) return
      contents.set(id, content)
    }

    // Insert from the last reference backwards, so earlier indexes stay valid.
    for (const { a, parent, index } of refs.reverse()) {
      const id = decodeURIComponent(a.properties.href.slice(1))
      const label = a.children
        .filter((c) => c.type === "text")
        .map((c) => c.value)
        .join("")
      // The reference points at the hidden footnotes section on wide screens; keep it out of the
      // tab order there. Screen readers still reach it, and the sidenote next to it is a note.
      a.properties.tabIndex = -1
      parent.children.splice(index + 1, 0, {
        type: "element",
        tagName: "span",
        properties: { className: ["sidenote"], role: "note" },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["sidenote-num"], ariaHidden: "true" },
            children: [{ type: "text", value: label }],
          },
          ...structuredClone(contents.get(id)),
        ],
      })
    }
    section.properties.dataSidenotes = ""
  }
}

export default function Sidenotes() {
  return {
    name: "Sidenotes",
    htmlPlugins() {
      return [rehypeSidenotes]
    },
  }
}
