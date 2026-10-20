import { classNames } from "../../quartz/util/lang"
import { resolveRelative, type FullSlug } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { asLowerString, isoDay, typeLabel } from "../note-meta/format"
import { folderOf, isNote, sectionOrder } from "./notes"

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * Body of the All notes page (condition `all-notes`): the index of every note, grouped by
 * section. Each row has the note's number and file name, its title, type chip and its verified
 * date (or the modified date for notes that are not verified). Sections come from the first
 * folder of the slug, in the order of SECTIONS (see notes.ts). The home page links here from
 * local-plugins/start-here, which also holds the section cards.
 */
export default (() => {
  const NoteIndex: QuartzComponent = ({
    allFiles,
    fileData,
    displayClass,
  }: QuartzComponentProps) => {
    const from = fileData.slug!
    const pages = allFiles.filter((f) => f.slug && isNote(f.slug))

    const order = sectionOrder(allFiles, pages)

    return (
      <section class={classNames(displayClass, "note-index")} aria-labelledby="note-index-title">
        <h2 id="note-index-title" class="note-index-title">
          All notes
        </h2>
        <div class="note-index-head" aria-hidden="true">
          <span>No.</span>
          <span>Title</span>
          <span>Type</span>
          <span>Date</span>
        </div>
        {order.map((section, s) => {
          const notes = pages
            .filter((f) => folderOf(f.slug!) === section.folder)
            .sort((a, b) => a.slug!.localeCompare(b.slug!))
          return (
            <section
              class="note-index-section"
              aria-labelledby={`note-index-${section.folder || "other"}`}
            >
              <header>
                <span class="note-index-num" aria-hidden="true">
                  {pad(s + 1)}
                </span>
                <h3 id={`note-index-${section.folder || "other"}`}>
                  {section.folder ? (
                    <a href={resolveRelative(from, `${section.folder}/index` as FullSlug)}>
                      {section.title}
                    </a>
                  ) : (
                    section.title
                  )}
                </h3>
                <p>{section.description}</p>
              </header>
              <ol>
                {notes.map((note, n) => {
                  const fm = (note.frontmatter ?? {}) as Record<string, unknown>
                  const type = asLowerString(fm.type)
                  const verified = isoDay(fm.verified)
                  const modified = isoDay(note.dates?.modified)
                  const date = verified ?? modified
                  const stem = note.slug!.split("/").pop()!
                  return (
                    <li class="note-index-row">
                      <span class="note-index-no">
                        {pad(s + 1)}.{n + 1}
                      </span>
                      <span class="note-index-name">
                        <a href={resolveRelative(from, note.slug!)} class="internal">
                          {String(fm.title ?? stem)}
                        </a>
                        <code class="note-index-slug">{stem}</code>
                      </span>
                      <span class="note-index-type">
                        {type && (
                          <span class="chip chip-type" data-type={type}>
                            {typeLabel(type)}
                          </span>
                        )}
                      </span>
                      <span class="note-index-date">
                        {date && (
                          <>
                            <span class="note-index-date-label">
                              {verified ? "verified" : "modified"}
                            </span>{" "}
                            <time datetime={date}>{date}</time>
                          </>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })}
      </section>
    )
  }
  return NoteIndex
}) satisfies () => QuartzComponent
