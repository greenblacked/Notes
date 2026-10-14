import { classNames } from "../../quartz/util/lang"
import { pathToRoot, resolveRelative, type FullSlug } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { SECTIONS } from "./sections"
// @ts-expect-error - inline script, loaded as text by the build (see quartz/cli/handlers.js)
import script from "./scripts/top-bar.inline.ts"

/**
 * The wordmark and the section links of the sticky top bar. The bar itself is the left sidebar of
 * the page frame: this component sits in it next to Quartz's search, dark-mode toggle and Explorer
 * (whose "Browse" button opens the drawer), and quartz/styles/custom.scss lays them out as one
 * row. A link is shown for every section that has an index page; the link of the section the page
 * belongs to carries aria-current, which the styles highlight.
 *
 * The script (scripts/top-bar.inline.ts) manages the focus of the Browse drawer, marks the
 * current heading in the table of contents and gives the skip link its target (the article).
 */
export default (() => {
  const TopBar: QuartzComponent = ({
    fileData,
    allFiles,
    cfg,
    displayClass,
  }: QuartzComponentProps) => {
    const slug = fileData.slug!
    // The 404 page is served at whatever URL was missing (/missing/deep), so relative links would
    // resolve against that path. It links from the site root instead, as Quartz's own 404 body does.
    const root = slug === "404" ? new URL(`https://${cfg.baseUrl ?? "example.com"}`).pathname : null
    const href = (target: FullSlug) =>
      root === null
        ? resolveRelative(slug, target)
        : `${root.replace(/\/?$/, "/")}${target.replace(/index$/, "")}`
    const links = SECTIONS.filter((s) => allFiles.some((f) => f.slug === `${s.folder}/index`)).map(
      (s) => ({
        ...s,
        href: href(`${s.folder}/index` as FullSlug),
        current:
          slug === `${s.folder}/index`
            ? ("page" as const)
            : slug.startsWith(`${s.folder}/`)
              ? ("true" as const)
              : undefined,
      }),
    )

    return (
      <nav class={classNames(displayClass, "top-bar")} aria-label="Sections">
        <a class="skip-link" href="#article">
          Skip to content
        </a>
        <a class="top-bar-brand" href={root ?? pathToRoot(slug)}>
          {cfg.pageTitle}
        </a>
        <ul class="top-bar-links">
          {links.map((link) => (
            <li>
              <a href={link.href} aria-current={link.current}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  TopBar.afterDOMLoaded = script
  return TopBar
}) satisfies () => QuartzComponent
