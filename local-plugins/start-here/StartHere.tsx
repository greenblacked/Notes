import { classNames } from "../../quartz/util/lang"
import { resolveRelative, type FullSlug } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { isoDay } from "../note-meta/format"
import { folderOf, isNote, sectionOrder } from "../note-index/notes"
import goals from "./goals.json"

type Goal = {
  id: string
  title: string
  blurb: string
  browse: { slug: string; label: string }[]
  featured: string[]
  more: string[]
}

/**
 * Home page body (condition `home`), after the intro: "Start here" with a few reader goals (each
 * with a link to its section and a handful of notes that declare an evidence level), a card per
 * section (title, description, note count, last update), and a link to the All notes page, which
 * holds the full catalogue (local-plugins/note-index). The goals are listed in goals.json; a slug
 * that has no page (a draft, say) is skipped.
 */
export default (() => {
  const StartHere: QuartzComponent = ({
    allFiles,
    fileData,
    displayClass,
  }: QuartzComponentProps) => {
    const from = fileData.slug!
    const bySlug = new Map<string, (typeof allFiles)[number]>(
      allFiles.filter((f) => f.slug).map((f) => [f.slug as string, f]),
    )
    const pages = allFiles.filter((f) => f.slug && isNote(f.slug))
    const href = (slug: string) => resolveRelative(from, slug as FullSlug)
    const titleOf = (slug: string) => {
      const fm = (bySlug.get(slug)?.frontmatter ?? {}) as Record<string, unknown>
      return String(fm.title ?? slug.split("/").pop())
    }

    const cards = sectionOrder(allFiles, pages)
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
        <section class={classNames(displayClass, "start-here")} aria-labelledby="start-here-title">
          <h2 id="start-here-title" class="start-here-title">
            Start here
          </h2>
          <p class="start-here-lookup">
            Looking for something specific? Open{" "}
            <a href={href("all-notes")} class="internal">
              All notes
            </a>{" "}
            ({pages.length} notes) or search with Ctrl+K.
          </p>
          <ul class="start-here-goals">
            {(goals as Goal[]).map((goal) => {
              const featured = goal.featured.filter((slug) => bySlug.has(slug))
              const more = goal.more.filter((slug) => bySlug.has(slug))
              const browse = goal.browse.filter((b) => bySlug.has(b.slug))
              return (
                <li class="start-here-goal" id={`start-here-${goal.id}`}>
                  <h3>{goal.title}</h3>
                  <p class="start-here-blurb">{goal.blurb}</p>
                  {browse.length > 0 && (
                    <p class="start-here-browse">
                      Browse:{" "}
                      {browse.map((b, i) => (
                        <>
                          {i > 0 && ", "}
                          <a href={href(b.slug)} class="internal">
                            {b.label}
                          </a>
                        </>
                      ))}
                    </p>
                  )}
                  {featured.length > 0 && (
                    <ol class="start-here-featured">
                      {featured.map((slug) => {
                        const fm = (bySlug.get(slug)?.frontmatter ?? {}) as Record<string, unknown>
                        const reviewed = isoDay(fm.reviewed)
                        return (
                          <li>
                            <a href={href(slug)} class="internal">
                              {titleOf(slug)}
                            </a>
                            {reviewed && (
                              <span class="start-here-reviewed">
                                Reviewed <time datetime={reviewed}>{reviewed}</time>
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  )}
                  {more.length > 0 && (
                    <ul class="start-here-more">
                      {more.map((slug) => (
                        <li>
                          <a href={href(slug)} class="internal">
                            {titleOf(slug)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
        <section class={classNames(displayClass, "section-cards")} aria-label="Browse by section">
          <ul>
            {cards.map((card) => (
              <li class="section-card" id={`note-index-${card.folder}`}>
                <h2>
                  <a href={href(`${card.folder}/index`)}>{card.title}</a>
                </h2>
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
        <section
          class={classNames(displayClass, "all-notes-link")}
          aria-labelledby="note-index-title"
        >
          <h2 id="note-index-title" class="all-notes-title">
            All notes
          </h2>
          <p>
            Every one of the {pages.length} notes, grouped by section, with its type and date.{" "}
            <a href={href("all-notes")} class="internal">
              Open the full catalogue
            </a>
          </p>
        </section>
      </>
    )
  }
  return StartHere
}) satisfies () => QuartzComponent
