import type { Page } from "@playwright/test"

// Marker for the in-page detail lines below; they are console.debug messages, never errors.
export const DETAIL_PREFIX = "[page-error-detail] "

// Runs in every document before its own scripts. For an uncaught throw or unhandled rejection
// whose value is not an Error, it logs the value's shape: Playwright only sees its string, which
// for a plain object is "[object Object]". It never calls preventDefault, so the browser still
// reports the error and the fixture still fails the test.
function installDetailReporter(prefix: string) {
  let hidden = false
  addEventListener("pagehide", () => (hidden = true))
  const target = (t: unknown) => {
    if (!(t instanceof Element)) return String(t)
    const el = t as Element & { src?: string; href?: string }
    return `${el.tagName.toLowerCase()}${el.src ? ` src=${el.src}` : ""}${el.href ? ` href=${el.href}` : ""}`
  }
  const describe = (value: unknown) => {
    if (value === null || typeof value !== "object") return `${typeof value} ${String(value)}`
    let json: string
    try {
      json = (JSON.stringify(value) ?? "").slice(0, 500)
    } catch {
      json = "(not serialisable)"
    }
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? "(none)"
    const keys = Object.getOwnPropertyNames(value).slice(0, 20).join(",")
    const ev = value instanceof Event ? ` type=${value.type} target=${target(value.target)}` : ""
    return `${Object.prototype.toString.call(value)} constructor=${ctor} keys=[${keys}] json=${json}${ev}`
  }
  const report = (kind: string, value: unknown) => {
    try {
      if (value instanceof Error) return
      console.debug(
        `${prefix}${kind}: ${describe(value)} (document ${location.href}, ${document.readyState}${hidden ? ", after pagehide" : ""})`,
      )
    } catch {
      // never let the reporter itself throw
    }
  }
  addEventListener("unhandledrejection", (e) => report("unhandledrejection", e.reason))
  addEventListener("error", (e) => report("error", e.error))
}

// Records every problem the fixture fails a test on: uncaught page errors, console errors and
// failed (status >= 400) responses from the site's own origin. details holds the shape lines above.
export async function recordProblems(page: Page, baseURL: string | undefined) {
  const problems: string[] = []
  const details: string[] = []
  const locations = new WeakMap<Error, { url: string; line: number; column: number }>()
  page.context().on("weberror", (w) => {
    if (w.page() === page) locations.set(w.error(), w.location())
  })
  await page.addInitScript(installDetailReporter, DETAIL_PREFIX)
  page.on("pageerror", (error) => {
    const loc = locations.get(error)
    // WebError.location() is zero-based; show line and column one-based like stack traces do.
    const where = loc?.url ? `${loc.url}:${loc.line + 1}:${loc.column + 1}` : "unknown"
    const frames = (error.stack ?? "")
      .split("\n")
      .filter((l) => l.startsWith("    at "))
      .slice(0, 10)
    // page.url() is the page open now; for an error from a page being left it is the next one.
    // The detail line's "document ... after pagehide" names the real source (non-Error values only).
    const head = `page error: ${error.name ? `${error.name}: ` : ""}${error.message} (script ${where}; page ${page.url()})`
    problems.push([head, ...frames].join("\n"))
  })
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`)
    else if (message.type() === "debug" && message.text().startsWith(DETAIL_PREFIX))
      details.push(message.text().slice(DETAIL_PREFIX.length))
  })
  page.on("response", (response) => {
    if (baseURL && response.url().startsWith(baseURL) && response.status() >= 400) {
      problems.push(`HTTP ${response.status()}: ${response.url()}`)
    }
  })
  return { problems, details }
}
