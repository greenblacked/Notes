import type { QuartzComponent } from "../../quartz/components/types"

/**
 * The target of the skip link: an empty anchor before the breadcrumbs and the title, so that
 * "Skip to content" lands on the title and works without JavaScript. The top-bar script moves the
 * keyboard here when the link is followed.
 */
export default (() => {
  const ContentStart: QuartzComponent = () => <span id="content" class="content-start" />
  return ContentStart
}) satisfies () => QuartzComponent
