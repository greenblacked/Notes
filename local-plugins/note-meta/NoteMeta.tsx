import readingTime from "reading-time"
import type { ComponentChildren } from "preact"
import { classNames } from "../../quartz/util/lang"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { asLowerString, evidenceLabel, isoDay, typeLabel } from "./format"
import { learnNav, learnNavCss } from "./LearnNav"

/**
 * Spec sheet under the title, driven by the frontmatter fields `type`, `evidence`, `decided`,
 * `verified` and `reviewed` (see content/standards/writing-notes.md), plus the modified date and
 * the reading time. The evidence level is plain text and `review-due` is not shown. Renders
 * nothing when none of the five fields is set, so the home page, section indexes
 * and the tags page stay clean (the content-meta plugin shows their date instead; the styles hide
 * its date where this sheet already has one). The sheet is a definition list: a term and a value
 * per item, so a screen reader hears "Verified, 2026-10-11".
 *
 * Under the sheet, a lesson in learn/ also gets its stage and place in the path with links to the
 * previous and next lesson (LearnNav.tsx; the order is in learn-path.json). Its styles ship as the
 * component's own CSS.
 */
export default (() => {
  const NoteMeta: QuartzComponent = ({
    fileData,
    allFiles,
    displayClass,
  }: QuartzComponentProps) => {
    const fm = (fileData.frontmatter ?? {}) as Record<string, unknown>
    const type = asLowerString(fm.type)
    const verified = isoDay(fm.verified)
    const decided = isoDay(fm.decided)
    const evidence = evidenceLabel(fm.evidence)
    const reviewed = isoDay(fm.reviewed)

    if (!type && !verified && !decided && !evidence && !reviewed) return null

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

    const sheet = (
      <dl class={classNames(displayClass, "note-meta")}>
        {type &&
          item(
            "Type",
            <span class="chip chip-type" data-type={type}>
              {typeLabel(type)}
            </span>,
          )}
        {evidence && item("Evidence", evidence)}
        {decided && item("Decided", day(decided))}
        {verified && item("Verified", day(verified))}
        {reviewed && item("Reviewed", day(reviewed))}
        {modified && item("Modified", day(modified))}
        {minutes !== undefined && item("Reading time", `${minutes} min`)}
      </dl>
    )
    const lessons = learnNav(fileData.slug ?? "", allFiles)
    return lessons ? (
      <>
        {sheet}
        {lessons}
      </>
    ) : (
      sheet
    )
  }
  NoteMeta.css = learnNavCss
  return NoteMeta
}) satisfies () => QuartzComponent
