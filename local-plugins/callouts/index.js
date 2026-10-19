// Callouts: a kind label and keyboard folding.
//
// The markup comes from the Obsidian-flavoured Markdown plugin. This transformer runs after it
// and adds, for a callout with a custom title, a `<span class="callout-kind">` holding the kind
// word ("Warning", "Tip") in front of the title, so the type is also read out and styled by
// quartz/styles/custom.scss. A callout that keeps its default title gets `callout-title-default`
// instead, because the title already is the kind word. A folding callout gets the button role,
// a tab stop and `aria-expanded`; fold.js handles Enter and Space and keeps the state current.
// The `callout`, `callout-content` and `data-callout` hooks are left alone.
import { visit } from "unist-util-visit"
import { FOLD_SCRIPT } from "./fold.js"

export const KIND_LABELS = {
  note: "Note",
  abstract: "Summary",
  info: "Info",
  todo: "To do",
  tip: "Tip",
  success: "Done",
  question: "Question",
  warning: "Warning",
  failure: "Failed",
  danger: "Danger",
  bug: "Bug",
  example: "Example",
  quote: "Quote",
}

export const ALIASES = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  attention: "warning",
  caution: "warning",
  missing: "failure",
  fail: "failure",
  error: "danger",
  cite: "quote",
}

const classes = (node) => {
  const value = node.properties?.className
  if (Array.isArray(value)) return value.map(String)
  return typeof value === "string" ? value.split(/\s+/) : []
}

const hasClass = (node, name) => node?.type === "element" && classes(node).includes(name)

const textOf = (node) =>
  node.type === "text"
    ? node.value
    : Array.isArray(node.children)
      ? node.children.map(textOf).join("")
      : ""

const hasKind = (node) =>
  hasClass(node, "callout-kind") || (node.children ?? []).some((child) => hasKind(child))

const withClass = (node, name) => {
  node.properties = node.properties ?? {}
  node.properties.className = [...classes(node), name]
}

export function rehypeCallouts() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "blockquote" || !hasClass(node, "callout")) return

      const type = String(node.properties?.dataCallout ?? "")
      const canonical = ALIASES[type] ?? type
      const title = (node.children ?? []).find((child) => hasClass(child, "callout-title"))
      if (!title) return

      const inner = (title.children ?? []).find((child) => hasClass(child, "callout-title-inner"))
      if (inner && !hasKind(inner)) {
        const written = textOf(inner).trim().toLowerCase().replace(/-/g, " ")
        const isDefault =
          written === type || written === canonical || ALIASES[written] === canonical
        const label = KIND_LABELS[canonical]
        if (isDefault) {
          withClass(title, "callout-title-default")
        } else if (label) {
          const host =
            inner.children.find((child) => child.type === "element" && child.tagName === "p") ??
            inner
          host.children = [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["callout-kind"] },
              children: [{ type: "text", value: label }],
            },
            { type: "text", value: " " },
            ...(host.children ?? []),
          ]
        }
      }

      visit(title, "element", (el) => {
        if (hasClass(el, "callout-icon") || hasClass(el, "fold-callout-icon")) {
          el.properties = { ...el.properties, ariaHidden: "true" }
        }
      })

      const own = classes(node)
      if (own.includes("is-collapsible")) {
        title.properties = {
          ...title.properties,
          role: "button",
          tabIndex: 0,
          ariaExpanded: own.includes("is-collapsed") ? "false" : "true",
        }
      }
    })
  }
}

export default function Callouts() {
  return {
    name: "Callouts",
    htmlPlugins() {
      return [rehypeCallouts]
    },
    externalResources() {
      return {
        js: [{ loadTime: "afterDOMReady", contentType: "inline", script: FOLD_SCRIPT }],
      }
    },
  }
}
