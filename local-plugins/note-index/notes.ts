import type { QuartzPluginData } from "../../quartz/plugins/vfile"
import { SECTIONS } from "../top-bar/sections"

/** Templates are copied, not read, so they stay out of the index. The All notes page lists notes; it is not one. */
export const isNote = (slug: string) =>
  slug !== "index" &&
  slug !== "404" &&
  slug !== "tags" &&
  slug !== "all-notes" &&
  !slug.startsWith("tags/") &&
  !slug.endsWith("/index") &&
  !slug.endsWith("/template")

/** First folder of a slug; "" for a note at the top level of content/. */
export const folderOf = (slug: string) => (slug.includes("/") ? slug.split("/")[0] : "")

export type Section = { folder: string; title: string; description: string }

/**
 * The sections that hold at least one of `pages`, in the order of SECTIONS; a folder not listed
 * there follows, titled after its index page, and notes at the top level of content/ come last.
 */
export function sectionOrder(allFiles: QuartzPluginData[], pages: QuartzPluginData[]): Section[] {
  const folders = [...new Set(pages.map((f) => folderOf(f.slug!)))]
  const known = SECTIONS.map((s) => s.folder)
  return [
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
    ...(folders.includes("")
      ? [{ folder: "", title: "Other notes", description: "Notes outside the sections." }]
      : []),
  ]
}
