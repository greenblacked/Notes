import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
// @ts-expect-error - inline script, loaded as text by the build (see quartz/cli/handlers.js)
import script from "./scripts/to-top.inline.ts"

/**
 * "To top": a round button in the bottom-right corner that takes the reader back to the top of
 * the page. It is hidden until the reader has scrolled a screen or so and then scrolls up, is at
 * the end of the page, or gives it focus (scripts/to-top.mjs decides, the CSS shows it); without
 * JavaScript it never appears. It is rendered in the bar (the page frame's left sidebar) because
 * `position: fixed` there is safe (the Browse drawer and the search overlay are fixed in the same
 * place) and because the drawer and the overlay come after it in the bar, so they paint over it.
 * Styles are in quartz/styles/custom.scss.
 */
export default (() => {
  const ToTop: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
    <button
      type="button"
      id="to-top"
      class={`${displayClass ?? ""} to-top`.trim()}
      aria-label="To top"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          d="M12 20V5M5.5 11.5 12 5l6.5 6.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>To top</span>
    </button>
  )
  ToTop.afterDOMLoaded = script
  return ToTop
}) satisfies () => QuartzComponent
