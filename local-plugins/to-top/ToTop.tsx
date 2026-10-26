import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"
// @ts-expect-error - inline script, loaded as text by the build (see quartz/cli/handlers.js)
import script from "./scripts/to-top.inline.ts"

/**
 * "To top": a round button in the bottom-right corner that takes the reader back to the top of
 * the page. It is hidden until the reader is past half a screen and then scrolls up, is at the end
 * of the page, or gives it focus (scripts/to-top.mjs decides, the CSS shows it); without
 * JavaScript it never appears. It is the last component after the page body (the `afterBody`
 * position, in `.page-footer`), so the keyboard reaches it once the page has been read and not
 * before it, and it is outside the `banner`. `position: fixed` is safe there: nothing above it has
 * a transform, filter or containment once the page-enter animation (which uses a transform) has
 * ended, and the button is hidden while the page is entering. Styles are in
 * quartz/styles/custom.scss.
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
