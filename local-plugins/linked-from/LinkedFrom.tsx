import { classNames } from "../../quartz/util/lang"
import { resolveRelative, simplifySlug, type FullSlug } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { SECTIONS } from "../top-bar/sections"
import { NoteCredit, noteCreditCss } from "./NoteCredit"

/**
 * "Linked from": the notes that link to this one, as a short list at the end of the note. It
 * replaces the Backlinks plugin, whose heading ("Backlinks") cannot be reworded without editing
 * the plugin. The list is left out when no other note links here. Each entry names its section.
 * The note credit (author, source and report links) follows it, so it shows on every note.
 */
export default (() => {
  const LinkedFrom: QuartzComponent = ({
    fileData,
    allFiles,
    displayClass,
  }: QuartzComponentProps) => {
    const slug = fileData.slug!
    const simple = simplifySlug(slug as FullSlug)
    const sources = allFiles.filter((f) => f.slug && f.slug !== slug && f.links?.includes(simple))
    return (
      <>
        {sources.length > 0 && (
          <section
            class={classNames(displayClass, "linked-from")}
            aria-labelledby="linked-from-title"
          >
            <h2 id="linked-from-title">Linked from</h2>
            <ul>
              {sources.map((f) => {
                const folder = f.slug!.split("/")[0]
                const section = SECTIONS.find(
                  (s) => s.folder === folder && f.slug !== `${folder}/index`,
                )
                return (
                  <li>
                    <a href={resolveRelative(slug, f.slug!)} class="internal">
                      {String(f.frontmatter?.title ?? f.slug)}
                    </a>
                    {section && <span class="linked-from-section">{section.label}</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        <NoteCredit fileData={fileData} />
      </>
    )
  }
  LinkedFrom.css = noteCreditCss
  return LinkedFrom
}) satisfies () => QuartzComponent
