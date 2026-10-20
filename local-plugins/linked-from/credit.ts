// URLs for the credit line at the end of a note. Pure functions, no Quartz imports.

export const AUTHOR = "Serhii Zolotov"
// The production host, fixed on purpose: stage builds override the configured base URL, and an
// issue filed from stage must still point at the public page.
export const CANONICAL_HOST = "notes.szolotov.com"
export const REPO_URL = "https://github.com/greenblacked/Notes"
export const CATALOGUE_URL = "https://ai.szolotov.com"

/** The public URL of a page: slug "index" is the root, "x/index" is "x/". */
export function pageUrl(slug: string): string {
  const path = slug === "index" ? "" : slug.endsWith("/index") ? slug.slice(0, -5) : slug
  return `https://${CANONICAL_HOST}/${path}`
}

/** The note's Markdown file on the main branch. relativePath is relative to content/. */
export function sourceUrl(relativePath: string): string {
  const path = relativePath.split("/").map(encodeURIComponent).join("/")
  return `${REPO_URL}/blob/main/content/${path}`
}

/** A prefilled new-issue link. No labels or template: the label may not exist. */
export function reportUrl(slug: string, title: string): string {
  const body = `Page: ${pageUrl(slug)}\n\nWhat is wrong or unclear:\n`
  return `${REPO_URL}/issues/new?title=${encodeURIComponent(`Note: ${title}`)}&body=${encodeURIComponent(body)}`
}
