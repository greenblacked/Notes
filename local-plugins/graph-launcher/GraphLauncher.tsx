import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
import { SECTIONS } from "../top-bar/sections"
// @ts-expect-error - inline script, loaded as text by the build (see quartz/cli/handlers.js)
import script from "./scripts/graph.inline.ts"

/**
 * The full graph of every note: a toolbar button (also Ctrl/Cmd+G on any page) and the modal
 * <dialog> it opens. The dialog is plain markup; scripts/graph.inline.ts fills it (the legend,
 * the counts, the canvas and the list) when it opens. The same script also draws the local graph
 * at the end of a note (local-plugins/note-graph, which has no script of its own).
 *
 * Behaviour, sizes and colours are specified in scripts/graph-model.mjs (the pure part, unit
 * tested) and graph.inline.ts (the drawing). Styles are in quartz/styles/custom.scss.
 */
export default (() => {
  const GraphLauncher: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    const sections = JSON.stringify(SECTIONS.map((s) => ({ folder: s.folder, label: s.label })))
    return (
      <>
        <button
          type="button"
          class={`${displayClass ?? ""} graph-launcher`.trim()}
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-keyshortcuts="Control+G Meta+G"
          aria-label="Open graph of all notes"
          title="Graph of all notes (Ctrl+G)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M7 17 12 7m0 0 5 10M7 17h10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
            <circle cx="12" cy="6.5" r="3" />
            <circle cx="6.5" cy="17.5" r="3" />
            <circle cx="17.5" cy="17.5" r="3" />
          </svg>
        </button>
        <dialog
          class="graph-dialog"
          id="graph-dialog"
          aria-labelledby="graph-dialog-title"
          data-sections={sections}
        >
          <header class="graph-dialog-header">
            <h2 id="graph-dialog-title">Graph</h2>
            <p class="graph-count"></p>
            <button type="button" class="graph-close" aria-label="Close graph">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path
                  d="m6 6 12 12M18 6 6 18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>
          <div class="graph-dialog-body">
            <details class="graph-filters">
              <summary>Filters</summary>
              <div class="graph-controls">
                <div class="graph-search">
                  <label for="graph-search-input">Filter notes</label>
                  <input
                    id="graph-search-input"
                    type="search"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder="Title or path"
                  />
                  <p class="graph-matches" role="status" aria-live="polite"></p>
                </div>
                <div class="graph-depth">
                  <label for="graph-depth-input">Depth</label>
                  <output for="graph-depth-input"></output>
                  <input id="graph-depth-input" type="range" min="1" max="6" step="1" value="6" />
                </div>
                <label class="graph-toggle">
                  <input type="checkbox" class="graph-tags-toggle" /> Tags
                </label>
                <label class="graph-toggle">
                  <input type="checkbox" class="graph-orphans-toggle" checked /> Orphans
                </label>
                <div class="graph-legend" role="group" aria-label="Sections"></div>
              </div>
            </details>
            <div class="graph-stage">
              <p class="graph-hint" hidden></p>
              <div class="graph-canvas-wrap" data-state="loading"></div>
              <div class="graph-selection" hidden>
                <span class="graph-selection-text"></span>
                <a class="graph-selection-open internal" href="#">
                  Open
                </a>
              </div>
              <details class="graph-list">
                <summary>List of notes in this graph</summary>
                <div class="graph-list-body"></div>
              </details>
            </div>
          </div>
        </dialog>
      </>
    )
  }

  GraphLauncher.afterDOMLoaded = script
  return GraphLauncher
}) satisfies () => QuartzComponent
