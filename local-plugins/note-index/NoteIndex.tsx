import { classNames } from "../../quartz/util/lang"
import { resolveRelative, type FullSlug } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { asLowerString, isoDay, statusTone, typeLabel } from "../note-meta/format"
import { SECTIONS } from "../top-bar/sections"

/** Templates are copied, not read, so they stay out of the index. */
const isNote = (slug: string) =>
  slug !== "index" &&
  slug !== "404" &&
  slug !== "tags" &&
  !slug.startsWith("tags/") &&
  !slug.endsWith("/index") &&
  !slug.endsWith("/template")

/** First folder of a slug; "" for a note at the top level of content/. */
const folderOf = (slug: string) => (slug.includes("/") ? slug.split("/")[0] : "")

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * Home page body (condition `home`): a card per section (title, description, note count, last
 * update), then the index of every note, grouped by section. Each row has the
 * note's number and file name, its title, type and status chips and its verified date (or the
 * modified date for notes that are not verified). It replaces a "recently updated" list: the
 * dates are in the index. Sections come from the first folder of the slug, in the order of
 * SECTIONS; a folder not listed there follows, titled after its index page.
 */
export default (() => {
  const NoteIndex: QuartzComponent = ({
    allFiles,
    fileData,
    displayClass,
  }: QuartzComponentProps) => {
    const from = fileData.slug!
    const pages = allFiles.filter((f) => f.slug && isNote(f.slug))

    const folders = [...new Set(pages.map((f) => folderOf(f.slug!)))]
    const known = SECTIONS.map((s) => s.folder)
    const order = [
      ...SECTIONS.filter((s) => folders.includes(s.folder)),
      ...folders
        .filter((f) => f !== "" && !known.includes(f))
        .sort()
        .map((folder) => {
          const index = allFiles.find((f) => f.slug === `${folder}/index`)
          return {
            folder,
            title: index?.frontmatter?.title ?? folder,
            description: (index?.frontmatter?.description as string | undefined) ?? "",
          }
        }),
      // Notes at the top level of content/, if any, come last.
      ...(folders.includes("")
        ? [{ folder: "", title: "Other notes", description: "Notes outside the sections." }]
        : []),
    ]

    const cards = order
      .filter((section) => section.folder !== "")
      .map((section) => {
        const notes = pages.filter((f) => folderOf(f.slug!) === section.folder)
        const updated = notes
          .map((f) => isoDay(f.dates?.modified))
          .filter((d): d is string => !!d)
          .sort()
          .pop()
        return { ...section, count: notes.length, updated }
      })

    return (
      <>
        <section class={classNames(displayClass, "section-cards")} aria-label="Sections">
          <ul>
            {cards.map((card) => (
              <li class="section-card">
                <h3>
                  <a href={resolveRelative(from, `${card.folder}/index` as FullSlug)}>
                    {card.title}
                  </a>
                </h3>
                {card.description && <p class="section-card-desc">{card.description}</p>}
                <p class="section-card-meta">
                  <span>
                    {card.count} {card.count === 1 ? "note" : "notes"}
                  </span>
                  {card.updated && (
                    <span>
                      Updated <time datetime={card.updated}>{card.updated}</time>
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
        <section class={classNames(displayClass, "note-index")} aria-labelledby="note-index-title">
          <h2 id="note-index-title" class="note-index-title">
            All notes
          </h2>
          <div class="note-index-head" aria-hidden="true">
            <span>No.</span>
            <span>Title</span>
            <span>Type</span>
            <span>Status</span>
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
                    const status = asLowerString(fm.status)
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
                        <span class="note-index-status">
                          {status && (
                            <span class="chip chip-status" data-tone={statusTone(status)}>
                              {status}
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
      </>
    )
  }
  return NoteIndex
}) satisfies () => QuartzComponent
