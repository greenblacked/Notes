// Local change to the vendored entry point (see QUARTZ_VERSION): baseUrl is taken from the
// NOTES_BASE_URL environment variable so the same source builds prod and dev.
// scripts/update-quartz.sh deliberately does not overwrite this file.
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { componentRegistry } from "./quartz/components/registry"
import { registerCondition } from "./quartz/plugins/loader/conditions"
import NoteMeta from "./local-plugins/note-meta/NoteMeta"
import NoteIndex from "./local-plugins/note-index/NoteIndex"
import TopBar from "./local-plugins/top-bar/TopBar"
import SectionRow from "./local-plugins/section-row/SectionRow"
import LinkedFrom from "./local-plugins/linked-from/LinkedFrom"
import ContentStart from "./local-plugins/content-start/ContentStart"
import GraphLauncher from "./local-plugins/graph/GraphLauncher"
import NoteGraph from "./local-plugins/note-graph/NoteGraph"
import type { QuartzComponentConstructor } from "./quartz/components/types"

// Host only: no protocol, no trailing slash (what Quartz expects for baseUrl).
const baseUrl = (process.env.NOTES_BASE_URL || "notes.szolotov.com")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "")

// The `home` condition limits a component to the home page (note-index uses it).
registerCondition("home", (props) => props.fileData.slug === "index")

// Spec sheet, note index, top bar, section row, skip-link target, "Linked from", graph launcher and note graph (local-plugins/, laid out in
// quartz.config.yaml). Registered here because the plugin loader only registers components that a
// plugin's manifest declares, and these have none. The sidenotes transformer in
// local-plugins/sidenotes needs no registration.
componentRegistry.register("note-meta", NoteMeta as QuartzComponentConstructor<any>, "note-meta")
componentRegistry.register("note-index", NoteIndex as QuartzComponentConstructor<any>, "note-index")
componentRegistry.register("top-bar", TopBar as QuartzComponentConstructor<any>, "top-bar")
componentRegistry.register(
  "section-row",
  SectionRow as QuartzComponentConstructor<any>,
  "section-row",
)
componentRegistry.register(
  "linked-from",
  LinkedFrom as QuartzComponentConstructor<any>,
  "linked-from",
)
componentRegistry.register(
  "content-start",
  ContentStart as QuartzComponentConstructor<any>,
  "content-start",
)

// Registered under the directory name ("graph"): the layout resolver looks components up by it.
componentRegistry.register("graph", GraphLauncher as QuartzComponentConstructor<any>, "graph")
componentRegistry.register("note-graph", NoteGraph as QuartzComponentConstructor<any>, "note-graph")

const config = await loadQuartzConfig({ baseUrl })
export default config
export const layout = await loadQuartzLayout()
