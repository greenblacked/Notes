// Local change to the vendored entry point (see QUARTZ_VERSION): baseUrl is taken from the
// NOTES_BASE_URL environment variable so the same source builds prod and stage.
// scripts/update-quartz.sh deliberately does not overwrite this file.
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"

// Host only: no protocol, no trailing slash (what Quartz expects for baseUrl).
const baseUrl = (process.env.NOTES_BASE_URL || "notes.szolotov.com")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "")

const config = await loadQuartzConfig({ baseUrl })
export default config
export const layout = await loadQuartzLayout()
