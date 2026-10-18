import { classNames } from "../../quartz/util/lang"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"

/**
 * The local graph at the end of a note: the note and the notes within a chosen number of links of
 * it (depth 1 to 5, or all), drawn on a canvas. Only markup lives here; the script is the one of
 * local-plugins/graph (graph-launcher), which finds `.note-graph`, fills it and keeps it in step
 * with the page. Where the layout clears `afterBody` (section, tag and 404 pages) there is no
 * panel; the toolbar button still opens the full graph.
 */
export default (() => {
  const NoteGraph: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
    <section class={classNames(displayClass, "note-graph")} aria-labelledby="note-graph-title">
      <h2 id="note-graph-title">Graph</h2>
      <div class="note-graph-controls">
        <div class="graph-depth">
          <label for="note-graph-depth">Depth</label>
          <output for="note-graph-depth"></output>
          <input id="note-graph-depth" type="range" min="1" max="6" step="1" value="1" />
        </div>
        <label class="graph-toggle">
          <input type="checkbox" class="graph-tags-toggle" /> Tags
        </label>
        <button type="button" class="graph-open">
          Open full graph
        </button>
      </div>
      <p class="graph-hint" hidden></p>
      <div class="graph-canvas-wrap" data-state="loading"></div>
      <div class="graph-legend" role="group" aria-label="Sections"></div>
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
    </section>
  )
  return NoteGraph
}) satisfies () => QuartzComponent
