// Turns Markdown footnotes into sidenotes. Every footnote reference gets a sibling
// `<span class="sidenote">` with a copy of the footnote text, and the footnotes section is marked
// with `data-sidenotes`. Nothing is hidden here: quartz/styles/custom.scss shows the sidenotes
// and hides the footnotes section from 1200px up, and does the opposite below that, so the page
// needs no script.
//
// A footnote is only converted when its body is plain paragraphs. Anything else (lists, code
// blocks, tables) stays a normal footnote and keeps the section visible at every width.
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

    const converted = new Set()
    let failed = false
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "sup" || !parent || index === undefined) return
      const ref = node.children.find((c) => isElement(c, "a") && hasDataProp(c, "dataFootnoteRef"))
      const href = ref?.properties?.href
      if (typeof href !== "string" || !href.startsWith("#")) return
      const id = decodeURIComponent(href.slice(1))
      const li = items.get(id)
      if (!li || converted.has(id)) return

      const content = inlineContent(li)
      if (!content) {
        failed = true
        return
      }
      converted.add(id)
      const label = node.children
        .flatMap((c) => (isElement(c, "a") ? c.children : [c]))
        .filter((c) => c.type === "text")
        .map((c) => c.value)
        .join("")
      const sidenote = {
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
          ...content,
        ],
      }
      parent.children.splice(index + 1, 0, sidenote)
      return index + 2
    })

    if (converted.size > 0 && !failed) section.properties.dataSidenotes = ""
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
