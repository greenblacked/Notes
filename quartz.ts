// Local change to the vendored entry point (see QUARTZ_VERSION): baseUrl is taken from the
// NOTES_BASE_URL environment variable so the same source builds prod and stage.
// scripts/update-quartz.sh deliberately does not overwrite this file.
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { componentRegistry } from "./quartz/components/registry"
import { registerCondition } from "./quartz/plugins/loader/conditions"
import { RecentNotes } from "./.quartz/plugins/recent-notes"
import NoteMeta from "./local-plugins/note-meta/NoteMeta"
import SectionTabs from "./local-plugins/section-tabs/SectionTabs"
import type { QuartzComponentConstructor } from "./quartz/components/types"

// Host only: no protocol, no trailing slash (what Quartz expects for baseUrl).
const baseUrl = (process.env.NOTES_BASE_URL || "notes.szolotov.com")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "")

// "Recently updated" list (recent-notes plugin, enabled and laid out in quartz.config.yaml).
// The pinned plugin does not declare its component in its package.json manifest, so the plugin
// loader never registers it and a `layout:` entry alone would be skipped silently. It is
// registered here instead, which also lets us pass the plugin's `filter` option (a function,
// which YAML cannot express): section index pages, the tags page and 404 stay out of the list.
// Title, limit and the rest still come from the YAML options. The `home` condition limits the
// list to the home page.
registerCondition("home", (props) => props.fileData.slug === "index")

const isNote = (page: { slug?: string }) => {
  const slug = page.slug ?? ""
  return (
    slug !== "index" &&
    slug !== "404" &&
    slug !== "tags" &&
    !slug.startsWith("tags/") &&
    !slug.endsWith("/index")
  )
}
componentRegistry.register(
  "recent-notes",
  ((opts) => RecentNotes({ filter: isNote, ...opts })) as QuartzComponentConstructor<any>,
  "recent-notes",
)

// Metadata strip and section tabs (local-plugins/, laid out in quartz.config.yaml). Registered here
// for the same reason: the plugin loader only registers components a plugin's manifest declares,
// and these have none. The sidenotes transformer in local-plugins/sidenotes needs no registration.
componentRegistry.register("note-meta", NoteMeta as QuartzComponentConstructor<any>, "note-meta")
componentRegistry.register(
  "section-tabs",
  SectionTabs as QuartzComponentConstructor<any>,
  "section-tabs",
)

const config = await loadQuartzConfig({ baseUrl })
export default config
export const layout = await loadQuartzLayout()
