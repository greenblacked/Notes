import readingTime from "reading-time"
import type { ComponentChildren } from "preact"
import { classNames } from "../../quartz/util/lang"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { asLowerString, isoDay, statusTone, typeLabel } from "./format"

/**
 * Spec sheet under the title, driven by the frontmatter fields `type`, `status`, `verified` and
 * `decided` (see content/standards/writing-notes.md), plus the modified date and the reading
 * time. Renders nothing when none of the four fields is set, so the home page, section indexes
 * and the tags page stay clean (the content-meta plugin shows their date instead; the styles hide
 * its date where this sheet already has one). The sheet is a definition list: a term and a value
 * per item, so a screen reader hears "Verified, 2026-10-11".
 */
export default (() => {
  const NoteMeta: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    const fm = (fileData.frontmatter ?? {}) as Record<string, unknown>
    const type = asLowerString(fm.type)
    const status = asLowerString(fm.status)
    const verified = isoDay(fm.verified)
    const decided = isoDay(fm.decided)

    if (!type && !status && !verified && !decided) return null

    const modified = isoDay(fileData.dates?.modified)
    const text = typeof fileData.text === "string" ? fileData.text : ""
    const minutes = text ? Math.max(1, Math.ceil(readingTime(text).minutes)) : undefined

    const item = (term: string, value: ComponentChildren) => (
      <div class="note-meta-item">
        <dt>{term}</dt>
        <dd>{value}</dd>
      </div>
    )
    const day = (iso: string) => <time datetime={iso}>{iso}</time>

    return (
      <dl class={classNames(displayClass, "note-meta")}>
        {type &&
          item(
            "Type",
            <span class="chip chip-type" data-type={type}>
              {typeLabel(type)}
            </span>,
          )}
        {status &&
          item(
            "Status",
            <span class="chip chip-status" data-tone={statusTone(status)}>
              {status}
            </span>,
          )}
        {decided && item("Decided", day(decided))}
        {verified && item("Verified", day(verified))}
        {modified && item("Modified", day(modified))}
        {minutes !== undefined && item("Reading time", `${minutes} min`)}
      </dl>
    )
  }
  return NoteMeta
}) satisfies () => QuartzComponent
