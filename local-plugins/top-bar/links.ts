import { pathToRoot, resolveRelative, type FullSlug } from "../../quartz/util/path"

/**
 * Links from a page to the site root and to other pages. The 404 page is served at whatever URL
 * was missing (/missing/deep), so relative links would resolve against that path. It links from
 * the site root instead, as Quartz's own 404 body does.
 */
export function siteLinks(slug: FullSlug, baseUrl?: string) {
  const root = slug === "404" ? new URL(`https://${baseUrl ?? "example.com"}`).pathname : null
  return {
    home: root ?? pathToRoot(slug),
    to: (target: FullSlug) =>
      root === null
        ? resolveRelative(slug, target)
        : `${root.replace(/\/?$/, "/")}${target.replace(/index$/, "")}`,
  }
}
