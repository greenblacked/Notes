import { classNames } from "../../quartz/util/lang"
import type { FullSlug } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { SECTIONS } from "../top-bar/sections"
import { siteLinks } from "../top-bar/links"

// Scrolls the row so that the current section is in the middle, when the row overflows. It is an
// inline script placed right after the row, so it runs before the first paint: the row never
// shows the wrong part and then jumps. scripts/build-csp.mjs hashes every inline script of the
// built pages, so the text must stay constant: no interpolation, no `</script`. Pages the router
// inserts later do not run it; the "nav" handler in the top-bar script covers those.
const CENTRE_CURRENT =
  '(()=>{const r=document.currentScript.parentElement,a=r.querySelector("a[aria-current]");if(a&&r.scrollWidth>r.clientWidth)r.scrollLeft=a.offsetLeft+a.offsetWidth/2-r.clientWidth/2})()'

/**
 * The second row of the top bar: a link to every section that has an index page, the one the page
 * belongs to marked with aria-current (the styles highlight it). When the links do not fit the
 * row scrolls sideways. quartz/styles/custom.scss places the row under the main bar.
 */
export default (() => {
  const SectionRow: QuartzComponent = ({
    fileData,
    allFiles,
    cfg,
    displayClass,
  }: QuartzComponentProps) => {
    const slug = fileData.slug!
    const { to } = siteLinks(slug, cfg.baseUrl)
    const links = SECTIONS.filter((s) => allFiles.some((f) => f.slug === `${s.folder}/index`)).map(
      (s) => ({
        ...s,
        href: to(`${s.folder}/index` as FullSlug),
        current:
          slug === `${s.folder}/index`
            ? ("page" as const)
            : slug.startsWith(`${s.folder}/`)
              ? ("true" as const)
              : undefined,
      }),
    )

    return (
      <nav class={classNames(displayClass, "section-row")} aria-label="Sections">
        <ul class="section-row-links">
          {links.map((link) => (
            <li>
              <a href={link.href} aria-current={link.current}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <script dangerouslySetInnerHTML={{ __html: CENTRE_CURRENT }} />
      </nav>
    )
  }

  return SectionRow
}) satisfies () => QuartzComponent
