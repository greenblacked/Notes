import { classNames } from "../../quartz/util/lang"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"

/** Fewer top-level sections than this and the tabs are just noise. */
const MIN_SECTIONS = 3

/**
 * Anchor-link tabs for the top-level sections of a note, under the title. Reuses the table of
 * contents that the table-of-contents plugin puts on `fileData.toc`. Entry depths there are
 * relative to the shallowest heading, so depth 0 is the h2 level in notes (the title is the h1).
 */
export default (() => {
  const SectionTabs: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    const toc = fileData.toc
    if (!Array.isArray(toc)) return null
    const sections = toc.filter((entry) => entry.depth === 0)
    if (sections.length < MIN_SECTIONS) return null

    return (
      <nav class={classNames(displayClass, "section-tabs")} aria-label="Sections">
        <ul>
          {sections.map((entry) => (
            <li>
              <a href={`#${entry.slug}`} data-for={entry.slug}>
                {entry.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    )
  }
  return SectionTabs
}) satisfies () => QuartzComponent
