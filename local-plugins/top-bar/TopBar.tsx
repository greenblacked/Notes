import { classNames } from "../../quartz/util/lang"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { siteLinks } from "./links"
// @ts-expect-error - inline script, loaded as text by the build (see quartz/cli/handlers.js)
import script from "./scripts/top-bar.inline.ts"
// @ts-expect-error - inline script, loaded as text by the build (see quartz/cli/handlers.js)
import earlyScript from "./scripts/top-bar.early.inline.ts"

/**
 * The wordmark of the sticky top bar, with the skip link. The bar itself is the left sidebar of
 * the page frame: this component sits in it next to Quartz's search, dark-mode toggle and Explorer
 * (whose "Browse" button opens the drawer), and quartz/styles/custom.scss lays them out as the
 * first row. The section links are the second row, in local-plugins/section-row.
 *
 * The script (scripts/top-bar.inline.ts) manages the focus of the Browse drawer, marks the
 * current heading in the table of contents, marks the centre column as the main landmark and moves
 * the keyboard to the skip link's target (#content, rendered by local-plugins/content-start). A
 * second, tiny script (scripts/top-bar.early.inline.ts) runs in the head, before the page is
 * painted: it makes the search button and the focus of the section links work at once.
 */
export default (() => {
  const TopBar: QuartzComponent = ({ fileData, cfg, displayClass }: QuartzComponentProps) => {
    const links = siteLinks(fileData.slug!, cfg.baseUrl)
    return (
      <div class={classNames(displayClass, "top-bar")}>
        <a class="skip-link" href="#content">
          Skip to content
        </a>
        <a class="top-bar-brand" href={links.home}>
          {cfg.pageTitle}
        </a>
      </div>
    )
  }

  TopBar.beforeDOMLoaded = earlyScript
  TopBar.afterDOMLoaded = script
  return TopBar
}) satisfies () => QuartzComponent
