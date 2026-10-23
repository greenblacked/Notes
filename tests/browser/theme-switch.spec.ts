import type { Page, TestInfo } from "@playwright/test"
import { expect, test } from "./fixtures"

const longPage = "/learn/gke-for-beginners"

type Sample = {
  t: number
  bar: number[]
  row: number[]
  y: number
  tucked: boolean
  iconScale: number
  iconTurning: number
  vt: boolean
}

type Sampled = { samples: Sample[]; clicked: boolean; fadePath: boolean; motion: boolean }

// Clicks the theme toggle like a user (mouse on desktop, a tap on phones) and samples the top bar,
// its section row, the scroll position and the theme icon on every animation frame and
// every 16ms timer tick until 900ms after the click event.
async function switchAndSample(page: Page, isMobile: boolean): Promise<Sampled> {
  const btn = page.locator(".darkmode").first()
  const box = await btn.boundingBox() // does not scroll, unlike locator.click()
  expect(box).not.toBeNull()
  await page.evaluate(() => {
    const w = window as unknown as {
      __s: Sample[]
      __tc: number
      __t0: number
      __done: Promise<void>
    }
    const bar = document.querySelector(".page > #quartz-body > .sidebar.left")!
    const row = bar.querySelector(".section-row")!
    const icons = [...document.querySelectorAll<SVGElement>(".darkmode > svg")]
    const r = (el: Element) => {
      const b = el.getBoundingClientRect()
      return [b.top, b.left, b.width, b.height]
    }
    w.__s = []
    w.__tc = NaN
    w.__t0 = performance.now()
    // The switch starts on the click event (top-bar's capture listener on document), so take the
    // click time in the capture phase on window, which runs first. "once" skips the click that
    // top-bar replays inside startViewTransition.
    window.addEventListener("click", () => (w.__tc = performance.now()), {
      capture: true,
      once: true,
    })
    w.__done = new Promise<void>((res) => {
      let finished = false
      let last = -1
      const started = w.__t0
      const tick = () => {
        if (finished) return
        const t = performance.now() // absolute for now; made relative to the click on return
        if (t === last) return // a frame and a timer can fire at the same instant
        last = t
        w.__s.push({
          t,
          bar: r(bar),
          row: r(row),
          y: window.scrollY,
          tucked: document.documentElement.hasAttribute("data-bar-tucked"),
          iconScale: Math.max(
            ...icons.map((i) => {
              const m = new DOMMatrixReadOnly(getComputedStyle(i).transform)
              return Math.hypot(m.a, m.b)
            }),
          ),
          iconTurning: icons
            .flatMap((i) => i.getAnimations())
            .filter(
              (a) =>
                a instanceof CSSTransition &&
                a.transitionProperty === "transform" &&
                a.playState === "running",
            ).length,
          vt: document
            .getAnimations()
            .some((a) =>
              String((a.effect as KeyframeEffect | null)?.pseudoElement ?? "").startsWith(
                "::view-transition",
              ),
            ),
        })
        // Without a click event after 3s, stop anyway so the coverage check fails with its
        // timestamps instead of the test hanging to the timeout.
        if (t - w.__tc >= 900 || t - started >= 3000) {
          finished = true
          res()
        }
      }
      // Headless WebKit hands out very few animation frames, so sample on a timer as well.
      const loop = () => {
        tick()
        if (!finished) {
          requestAnimationFrame(loop)
        }
      }
      const timer = () => {
        tick()
        if (!finished) setTimeout(timer, 16)
      }
      requestAnimationFrame(loop)
      setTimeout(timer, 0)
    })
  })
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  if (isMobile) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
  await page.evaluate(() => (window as unknown as { __done: Promise<void> }).__done)
  return page.evaluate(() => {
    const w = window as unknown as { __s: Sample[]; __tc: number; __t0: number }
    // t in ms from the click (negative before it). If the guard ended the sampling without a click
    // event, __tc is NaN, so count from the start of sampling instead to keep the times readable.
    const clicked = !Number.isNaN(w.__tc)
    const origin = clicked ? w.__tc : w.__t0
    return {
      samples: w.__s.map((s) => ({ ...s, t: s.t - origin })),
      clicked,
      fadePath:
        typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition ===
          "function" &&
        matchMedia("(hover: hover) and (pointer: fine)").matches &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches,
      motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    }
  })
}

// The switch itself lasts under 400ms (cross-fade 180ms after a 70-200ms snapshot, icon turn
// 380ms). How many samples land in it depends on the engine, since WebKit's main thread is busy
// during the switch, so assert that the samples cover the switch instead of counting them.
// Sample times count from the click event.
function expectStillGeometry(samples: Sample[], clicked: boolean, testInfo: TestInfo) {
  const first = samples[0]
  const times = samples.map((s) => Math.round(s.t))
  testInfo.annotations.push({
    type: "sample times (ms)",
    description: `${samples.length} samples, timed from ${clicked ? "the click" : "the start of sampling (no click event seen)"}: ${times.join(" ")}`,
  })
  const inWindow = samples.filter((s) => s.t >= 30 && s.t <= 400).length
  const after = samples.filter((s) => s.t >= 600).length
  const covered =
    clicked && samples.at(-1)!.t >= 900 && samples.length >= 5 && inWindow >= 1 && after >= 1
  expect(
    covered,
    `${clicked ? "" : "no click event was seen; "}samples, timed from ${clicked ? "the click" : "the start of sampling"}, must span 900ms with at least one in 30-400ms and one from 600ms on (got ${samples.length} samples, ${inWindow} in the window, ${after} after it): ${times.join(" ")}`,
  ).toBe(true)
  for (const s of samples) {
    s.bar.forEach((v, i) => expect(Math.abs(v - first.bar[i])).toBeLessThanOrEqual(0.5))
    s.row.forEach((v, i) => expect(Math.abs(v - first.row[i])).toBeLessThanOrEqual(0.5))
    expect(s.y).toBe(first.y)
    expect(s.tucked).toBe(first.tucked)
  }
}

for (const motion of [true, false]) {
  test.describe(motion ? "theme switch with motion" : "theme switch with reduced motion", () => {
    test.use({ reducedMotion: motion ? "no-preference" : "reduce" })

    for (const tucked of [false, true]) {
      test(`header holds still, ${tucked ? "tucked" : "at the top"}`, async ({
        page,
        isMobile,
        browserName,
      }, testInfo) => {
        test.slow(browserName === "webkit" && isMobile, "headless WebKit at 3x paints slowly")
        await page.goto(longPage)
        // Setup, not the behaviour under test: the first paint can take seconds on headless WebKit.
        await expect(page.locator("html")).toHaveClass(/motion-ready/, { timeout: 15_000 })
        if (tucked) {
          test.skip(
            (page.viewportSize()?.height ?? 0) < 30 * 16,
            "the bar is not sticky in a window under 30rem tall",
          )
          await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }))
          await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
        }
        const before = await page.locator("html").getAttribute("saved-theme")
        const { samples, clicked, fadePath } = await switchAndSample(page, isMobile)
        // Geometry first: when no click event arrives the theme never changes, and the
        // theme assertion below would then hide the readable "no click event" message.
        expectStillGeometry(samples, clicked, testInfo)
        await expect(page.locator("html")).not.toHaveAttribute("saved-theme", before ?? "")
        if (!motion) {
          expect(samples.every((s) => s.iconTurning === 0)).toBe(true)
          return
        }
        testInfo.annotations.push({
          type: "view-transition animations seen",
          description: String(samples.some((s) => s.vt)),
        })
        if (fadePath) {
          // Inside the cross-fade the fade swaps the icons: no turn of its own.
          expect(samples.every((s) => s.iconTurning === 0)).toBe(true)
        } else {
          // One-frame flip: the icon turns, but never past its full size.
          expect(Math.max(...samples.map((s) => s.iconScale))).toBeLessThanOrEqual(1.001)
        }
      })
    }
  })
}

// ---- The tuck motion across a theme switch --------------------------------------------------
// .theme-switching turns transitions off from the tap until the switch has painted (about 0.6s
// with requestIdleCallback). The section row must still slide in that window: on a scroll right
// after the tap, and when the tap lands while it is still sliding. The boxes measured above never
// move by design (only the links and the band's edge do), so these tests read the tuck's own
// transitions: the links' transform and the bottom of the bar's ::before (band) and ::after (line).
const BAR = ".page > #quartz-body > .sidebar.left"
const SLIDE = ["bottom::after", "bottom::before", "transform"]
type Untuck = { switching: boolean; running: string[] }
type TuckWindow = Window & { __tuck: () => string[]; __untuck: Promise<Untuck> }
type SlideWindow = TuckWindow & {
  __ended: string[]
  __cancelled: string[]
  __untuckAt: number // performance.now() when the row came back
  __frames: number[] // ms after __untuckAt of each animation frame since, for the failure message
}

function installTuckProbe() {
  ;(window as unknown as TuckWindow).__tuck = () => {
    const bar = document.querySelector(".page > #quartz-body > .sidebar.left")!
    const links = bar.querySelector(".section-row-links")!
    return document
      .getAnimations()
      .filter((a): a is CSSTransition => a instanceof CSSTransition && a.playState === "running")
      .filter((a) => {
        const e = a.effect as KeyframeEffect | null
        if (e?.target === links) return a.transitionProperty === "transform"
        return (
          e?.target === bar &&
          (e.pseudoElement === "::before" || e.pseudoElement === "::after") &&
          a.transitionProperty === "bottom"
        )
      })
      .map((a) => `${a.transitionProperty}${(a.effect as KeyframeEffect).pseudoElement ?? ""}`)
      .sort()
  }
}
const tuckRunning = (page: Page) => page.evaluate(() => (window as unknown as TuckWindow).__tuck())

async function tapToggle(page: Page, isMobile: boolean) {
  const box = await page.locator(".darkmode").first().boundingBox() // does not scroll
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  if (isMobile) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

// The site's toggle has two states; with nothing saved it starts light whatever the OS prefers.
const starts = [
  { name: "light", saved: "light", scheme: "light", theme: "light" },
  { name: "dark", saved: "dark", scheme: "light", theme: "dark" },
  { name: "nothing saved, OS dark", saved: null, scheme: "dark", theme: "light" },
] as const
// A tablet: on the phone projects a touch tablet (one-frame flip), on the desktop projects a
// narrow window with a trackpad (the cross-fade path, as on an iPad with a trackpad).
const sizes = [null, { width: 820, height: 1180 }] as const

for (const motion of [true, false]) {
  for (const start of starts) {
    for (const size of sizes) {
      if (!motion && (start.name !== "light" || size)) continue // one reduced-motion guard
      test.describe(`tuck across a theme switch from ${start.name}${size ? ", tablet size" : ""}${motion ? "" : ", reduced motion"}`, () => {
        test.use({
          reducedMotion: motion ? "no-preference" : "reduce",
          colorScheme: start.scheme,
          ...(size ? { viewport: size } : {}),
        })
        test.beforeEach(async ({ page, browserName, isMobile }) => {
          // The tablet variants take about 20s of the 30s limit on the headless WebKit phone.
          test.slow(browserName === "webkit" && isMobile, "headless WebKit at 3x paints slowly")
          test.skip(
            (page.viewportSize()?.height ?? 0) < 30 * 16,
            "the bar is not sticky under 30rem",
          )
          if (start.saved)
            await page.addInitScript((t) => localStorage.setItem("theme", t), start.saved)
          await page.goto(longPage)
          await page.evaluate(installTuckProbe)
          await expect(page.locator("html")).toHaveClass(/motion-ready/, { timeout: 15_000 })
          await expect(page.locator("html")).toHaveAttribute("saved-theme", start.theme)
          await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }))
          await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
          await expect.poll(() => tuckRunning(page), { timeout: 15_000 }).toEqual([]) // the tuck slide has finished
        })

        test("the row slides back on a scroll right after the switch", async ({
          page,
          isMobile,
        }) => {
          await page.evaluate(() => {
            const w = window as unknown as SlideWindow & { requestIdleCallback: () => number }
            // Keep .theme-switching on for the whole test, whatever the frame timing: the class
            // is taken off when the page is idle, which never comes here (Safari has no idle
            // callback and falls back to a timer, so this also hides that timer).
            w.requestIdleCallback = () => 0
            w.__ended = []
            w.__cancelled = []
            w.__untuck = new Promise<Untuck>((resolve) => {
              // Bubble phase on window: after the toggle's own listeners (on the cross-fade path,
              // the click replayed inside the view transition), so .theme-switching is on.
              window.addEventListener(
                "click",
                () => {
                  const root = document.documentElement
                  const on = root.classList.contains("theme-switching")
                  new MutationObserver((_, observer) => {
                    if (root.hasAttribute("data-bar-tucked")) return
                    observer.disconnect()
                    // The slide's own events from here on: each part must run to its end and
                    // none be cancelled. Unlike a look one frame later, they do not depend on
                    // how many frames the engine paints during the switch (headless WebKit
                    // paints few, and a 260ms slide can be over before the next one).
                    const bar = document.querySelector<HTMLElement>(
                      ".page > #quartz-body > .sidebar.left",
                    )!
                    const links = bar.querySelector(".section-row-links")!
                    const name = (e: TransitionEvent) =>
                      (e.target === links && e.propertyName === "transform") ||
                      (e.target === bar &&
                        (e.pseudoElement === "::before" || e.pseudoElement === "::after") &&
                        e.propertyName === "bottom")
                        ? `${e.propertyName}${e.pseudoElement}`
                        : null
                    bar.addEventListener("transitionend", (e) => {
                      const n = name(e)
                      if (n) w.__ended.push(n)
                    })
                    bar.addEventListener("transitioncancel", (e) => {
                      const n = name(e)
                      if (n) w.__cancelled.push(n)
                    })
                    // For the failure message only: the frames the engine paints from here on.
                    w.__untuckAt = performance.now()
                    w.__frames = []
                    const frame = () => {
                      w.__frames.push(Math.round(performance.now() - w.__untuckAt))
                      if (w.__frames.length < 100) requestAnimationFrame(frame)
                    }
                    requestAnimationFrame(frame)
                    // Read in the same task as the untuck: getAnimations() applies the pending
                    // style change first, so the slide is there now, whatever the frame timing.
                    resolve({
                      switching: on && root.classList.contains("theme-switching"),
                      running: w.__tuck(),
                    })
                  }).observe(root, { attributes: true, attributeFilter: ["data-bar-tucked"] })
                  window.scrollBy({ top: -40, behavior: "instant" })
                },
                { once: true },
              )
            })
          })
          await tapToggle(page, isMobile)
          const r = await page.evaluate(() => (window as unknown as SlideWindow).__untuck)
          expect(r.switching, "the row must come back while the switch is still on").toBe(true)
          expect(r.running).toEqual(motion ? SLIDE : [])
          await expect(page.locator("html")).not.toHaveAttribute("saved-theme", start.theme)
          // It slid all the way: every part ran to its end, none was cut short. Wait for the
          // slide's own end, not a short deadline on the transform: a transition keeps its start
          // value until the next frame, and headless WebKit at 3x can hold frames back for seconds.
          // While the slide has not ended, the value read says what the page did since the row
          // came back (the frames painted, each part's transition), so a failure tells an engine
          // that paints no frames from a transition that never starts.
          await expect
            .poll(
              () =>
                page.evaluate(
                  (parts) => {
                    const w = window as unknown as SlideWindow
                    if (w.__ended.length >= parts) return "slid"
                    const bar = document.querySelector(".page > #quartz-body > .sidebar.left")!
                    const links = bar.querySelector(".section-row-links")!
                    const transitions = document
                      .getAnimations()
                      .filter((a): a is CSSTransition => a instanceof CSSTransition)
                      .filter((a) => {
                        const e = a.effect as KeyframeEffect | null
                        return (
                          (e?.target === links && a.transitionProperty === "transform") ||
                          (e?.target === bar && a.transitionProperty === "bottom")
                        )
                      })
                      .map(
                        (a) =>
                          `${a.transitionProperty}${(a.effect as KeyframeEffect).pseudoElement ?? ""} ${a.playState}${a.pending ? " (pending)" : ""} start=${a.startTime} now=${a.currentTime}`,
                      )
                    const since = Math.round(performance.now() - w.__untuckAt)
                    return `ended ${JSON.stringify(w.__ended)} ${since}ms after the row came back; ${w.__frames.length} frames since, at ${w.__frames.join(" ")}ms; transitions: ${transitions.join(", ") || "none"}`
                  },
                  (motion ? SLIDE : []).length,
                ),
              { timeout: 15_000 },
            )
            .toBe("slid")
          expect(
            await page.evaluate(() => [...(window as unknown as SlideWindow).__ended].sort()),
          ).toEqual(motion ? SLIDE : [])
          expect(await page.evaluate(() => (window as unknown as SlideWindow).__cancelled)).toEqual(
            [],
          )
          await expect(page.locator(`${BAR} .section-row-links`)).toHaveCSS("transform", "none")
        })

        test("a slide under way runs on through the switch", async ({ page, isMobile }) => {
          test.skip(!motion, "no slide with reduced motion")
          // A slow slide (only in this test), so that the tap surely lands while it runs and the
          // slide outlasts the test whatever the frame rate.
          await page.addStyleTag({ content: `${BAR} { --dur: 60s; }` })
          await page.evaluate(() => {
            const w = window as unknown as { __cancelled: string[] }
            w.__cancelled = []
            const bar = document.querySelector<HTMLElement>(".page > #quartz-body > .sidebar.left")!
            bar.addEventListener("transitioncancel", (e) => {
              const links = bar.querySelector(".section-row-links")
              if (
                (e.target === links && e.propertyName === "transform") ||
                (e.target === bar && e.propertyName === "bottom")
              )
                w.__cancelled.push(e.propertyName)
            })
            window.scrollBy({ top: -40, behavior: "instant" })
          })
          await expect(page.locator("html")).not.toHaveAttribute("data-bar-tucked")
          await expect.poll(() => tuckRunning(page)).toEqual(SLIDE)
          await tapToggle(page, isMobile)
          await expect(page.locator("html")).not.toHaveAttribute("saved-theme", start.theme)
          await expect(page.locator("html")).not.toHaveClass(/theme-switching/, {
            timeout: 15_000,
          })
          expect(await tuckRunning(page)).toEqual(SLIDE) // not cancelled by the switch
          expect(await page.evaluate(() => (window as unknown as SlideWindow).__cancelled)).toEqual(
            [],
          )
        })
      })
    }
  }
}

// A page with a Mermaid diagram. Mermaid draws every diagram again on a theme change (the source
// text for a moment, then the new SVG), which changes the page's height above the reading
// position; the browser may move the scroll position to compensate (scroll anchoring). That move
// is not a scroll by the reader, so the section row must stay as it is.
const diagramPage = "/patterns/gke-blue-green-releases"
type DiagramWindow = Window & { __drawn: (Element | null)[]; __log: string[]; __mid: boolean }

// A finished diagram's SVG is a direct child of its block. While Mermaid draws, the block holds the
// source text or a temporary wrapper with the SVG under construction, so `code svg` alone does not
// say that a drawing is done.
async function openDiagramPage(page: Page) {
  await page.goto(diagramPage)
  await page.waitForLoadState("networkidle")
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".center code.mermaid")].every((el) =>
        el.querySelector(":scope > svg"),
      ),
    undefined,
    { timeout: 15_000 },
  )
  await expect(page.locator("html")).toHaveClass(/motion-ready/, { timeout: 15_000 })
}

// Scrolls to 300px past the first diagram, where the row is tucked, and lets the slide end.
async function scrollPastDiagram(page: Page) {
  await page.evaluate(() => {
    const code = document.querySelector(".center code.mermaid")!
    const r = (code.closest("pre") ?? code).getBoundingClientRect()
    window.scrollTo({ top: r.bottom + window.scrollY + 300, behavior: "instant" })
  })
  await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
  await page.waitForTimeout(600)
}

// Notes the finished SVGs now (none in a block that is being drawn); redrawn() then waits until
// every block holds a finished SVG other than the noted one.
const markDrawn = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as DiagramWindow).__drawn = [
      ...document.querySelectorAll(".center code.mermaid"),
    ].map((c) => c.querySelector(":scope > svg"))
  })
const redrawn = (page: Page) =>
  page.waitForFunction(
    () => {
      const before = (window as unknown as DiagramWindow).__drawn
      return [...document.querySelectorAll(".center code.mermaid")].every((c, i) => {
        const svg = c.querySelector(":scope > svg")
        return !!svg && svg !== before[i]
      })
    },
    undefined,
    { timeout: 15_000 },
  )

// Logs every change of the tuck and every scroll position from here on.
const logTuck = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as DiagramWindow
    w.__log = []
    const root = document.documentElement
    new MutationObserver(() =>
      w.__log.push(`tucked=${root.hasAttribute("data-bar-tucked")} y=${Math.round(scrollY)}`),
    ).observe(root, { attributes: true, attributeFilter: ["data-bar-tucked"] })
  })
const tuckLog = (page: Page) => page.evaluate(() => (window as unknown as DiagramWindow).__log)

test("the section row stays put while the diagrams are redrawn for a new theme", async ({
  page,
  isMobile,
}) => {
  test.skip((page.viewportSize()?.height ?? 0) < 30 * 16, "the bar is not sticky under 30rem")
  await openDiagramPage(page)
  await scrollPastDiagram(page)
  const before = await page.evaluate(() => scrollY)
  await logTuck(page)
  await markDrawn(page)
  await tapToggle(page, isMobile)
  await expect(page.locator("html")).not.toHaveAttribute("saved-theme", "light")
  // Until the new SVGs are in (they were removed for a moment), then a while longer.
  await redrawn(page)
  await page.waitForTimeout(1_500)
  expect(await tuckLog(page)).toEqual([])
  await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2)
})

// The heights hold still while Mermaid draws, so a scroll in that time is the reader's: a scroll
// up shows the row at once, not once the new diagrams are in (and stays so after).
test("a scroll up while the diagrams are redrawn brings the row back", async ({
  page,
  isMobile,
}) => {
  test.skip((page.viewportSize()?.height ?? 0) < 30 * 16, "the bar is not sticky under 30rem")
  await openDiagramPage(page)
  await scrollPastDiagram(page)
  await markDrawn(page)
  await page.evaluate(() => {
    const w = window as unknown as DiagramWindow
    w.__mid = false
    const code = document.querySelector(".center code.mermaid")!
    // The first moment the finished SVG is gone: Mermaid has begun to draw the new one.
    new MutationObserver((_, observer) => {
      if (code.querySelector(":scope > svg")) return
      observer.disconnect()
      w.__mid = true
      window.scrollBy({ top: -80, behavior: "instant" })
    }).observe(code, { childList: true, subtree: true })
  })
  await tapToggle(page, isMobile)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as DiagramWindow).__mid))
    .toBe(true)
  await expect(page.locator("html")).not.toHaveAttribute("data-bar-tucked", { timeout: 1_000 })
  await logTuck(page)
  await redrawn(page)
  await page.waitForTimeout(500)
  expect(await tuckLog(page)).toEqual([])
})

// A second switch while the first redraw still runs (its finished SVGs gone): the diagrams keep the
// height they had until the latest redraw is in, so neither the page nor the row moves.
test("a second switch while the diagrams are redrawn keeps the page and the row still", async ({
  page,
  isMobile,
}) => {
  test.skip((page.viewportSize()?.height ?? 0) < 30 * 16, "the bar is not sticky under 30rem")
  await openDiagramPage(page)
  await scrollPastDiagram(page)
  const before = await page.evaluate(() => scrollY)
  await logTuck(page)
  await page.evaluate(() => {
    const w = window as unknown as DiagramWindow & { __ys: number[]; __mermaidErrors: string[] }
    w.__mid = false
    w.__ys = []
    // Mermaid itself may reject when a new theme comes while it still draws (its own error
    // object: str, message, hash). That is Mermaid's, not the top bar's; keep it out of the page
    // error check here, and only here, and only that shape.
    w.__mermaidErrors = []
    window.addEventListener("unhandledrejection", (e) => {
      const r: unknown = e.reason
      if (r && typeof r === "object" && "hash" in r && "str" in r) {
        w.__mermaidErrors.push(String((r as { message?: unknown }).message))
        e.preventDefault()
      }
    })
    window.addEventListener("scroll", () => w.__ys.push(scrollY), { passive: true })
    const code = document.querySelector(".center code.mermaid")!
    const toggle = document.querySelector<HTMLElement>(".darkmode")!
    new MutationObserver((_, observer) => {
      if (code.querySelector(":scope > svg")) return
      observer.disconnect()
      w.__mid = true
      // The noted SVGs: none in this block now, so redrawn() waits for the latest redraw.
      w.__drawn = [...document.querySelectorAll(".center code.mermaid")].map((c) =>
        c.querySelector(":scope > svg"),
      )
      window.setTimeout(() => toggle.click(), 0)
    }).observe(code, { childList: true, subtree: true })
  })
  await tapToggle(page, isMobile)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as DiagramWindow).__mid))
    .toBe(true)
  // Two switches: back to the light theme.
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "light")
  await redrawn(page)
  await page.waitForTimeout(1_500)
  expect(await tuckLog(page)).toEqual([])
  const ys = await page.evaluate(() => (window as unknown as { __ys: number[] }).__ys)
  expect(Math.max(0, ...ys.map((y) => Math.abs(y - before)))).toBeLessThan(2)
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2)
})

// The second switch comes inside the first redraw, in the same task as the mutation that shows the
// temporary wrapper gone (the block holds neither the wrapper nor an SVG). The first run's SVG
// then still lands, and it must not release the lock: the latest redraw is not in yet.
test("a late SVG of the first redraw does not release the lock of the second", async ({
  page,
  isMobile,
}) => {
  test.skip((page.viewportSize()?.height ?? 0) < 30 * 16, "the bar is not sticky under 30rem")
  await openDiagramPage(page)
  await scrollPastDiagram(page)
  const before = await page.evaluate(() => scrollY)
  await logTuck(page)
  await page.evaluate(() => {
    const w = window as unknown as DiagramWindow & {
      __ys: number[]
      __clicked: boolean
      __pinAtSvg: string | null
    }
    w.__mid = false
    w.__clicked = false
    w.__pinAtSvg = null
    w.__ys = []
    // Mermaid's own rejection for a switch during a draw (see the test above): not the top bar's.
    window.addEventListener("unhandledrejection", (e) => {
      const r: unknown = e.reason
      if (r && typeof r === "object" && "hash" in r && "str" in r) e.preventDefault()
    })
    window.addEventListener("scroll", () => w.__ys.push(scrollY), { passive: true })
    const code = document.querySelector<HTMLElement>(".center code.mermaid")!
    const pre = code.parentElement!
    const toggle = document.querySelector<HTMLElement>(".darkmode")!
    let wrapper = false
    new MutationObserver(() => {
      const svg = code.querySelector(":scope > svg")
      if (!w.__clicked) {
        if (code.children.length > 0 && !svg) wrapper = true
        if (!wrapper || code.children.length !== 0) return
        w.__clicked = true
        w.__drawn = [...document.querySelectorAll(".center code.mermaid")].map((c) =>
          c.querySelector(":scope > svg"),
        )
        toggle.click() // synchronously, before the first run's SVG lands
        return
      }
      // The first finished SVG after the second switch: the lock is to hold the height still.
      if (svg && w.__pinAtSvg === null) {
        w.__mid = true
        w.__pinAtSvg = pre.style.maxHeight
        // Let the lock release on this mutation (if it is to) before the page is read.
        queueMicrotask(() => {
          w.__pinAtSvg = pre.style.maxHeight
        })
      }
    }).observe(code, { childList: true, subtree: true })
  })
  await tapToggle(page, isMobile)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as DiagramWindow).__mid))
    .toBe(true)
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "light")
  await redrawn(page)
  await page.waitForTimeout(1_500)
  const w = (await page.evaluate(() => {
    const x = window as unknown as { __clicked: boolean; __pinAtSvg: string | null }
    return { clicked: x.__clicked, pin: x.__pinAtSvg }
  })) as { clicked: boolean; pin: string | null }
  expect(w.clicked, "the second switch came inside the first redraw").toBe(true)
  expect(w.pin, "the pin is still set when the first run's SVG lands").toMatch(/px$/)
  expect(await tuckLog(page)).toEqual([])
  const ys = await page.evaluate(() => (window as unknown as { __ys: number[] }).__ys)
  expect(Math.max(0, ...ys.map((y) => Math.abs(y - before)))).toBeLessThan(2)
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2)
})

// A link preview (popover) of another diagram page keeps an unrendered code.mermaid in the body,
// hidden: Mermaid only draws the ones in .center. The lock on the diagram heights must not wait
// for that block, or it lasts to its timeout and the scrolls in that time are dropped.
test("a link preview with a diagram does not hold the section row after a theme switch", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "link previews need a hover")
  test.skip((page.viewportSize()?.height ?? 0) < 30 * 16, "the bar is not sticky under 30rem")
  await openDiagramPage(page)
  await page.locator('a.internal[data-slug="patterns/spinnaker-canary-analysis"]').first().hover()
  await page.locator(".popover").first().waitFor({ state: "attached", timeout: 10_000 })
  expect(await page.locator(".popover code.mermaid").count()).toBeGreaterThan(0)
  await page.mouse.move(5, 5)
  await scrollPastDiagram(page)
  await markDrawn(page)
  await tapToggle(page, isMobile)
  await expect(page.locator("html")).not.toHaveAttribute("saved-theme", "light")
  await redrawn(page)
  await page.waitForTimeout(400)
  await page.evaluate(() => window.scrollBy({ top: -80, behavior: "instant" }))
  // A scroll up shows the row again at once, not after the lock's 3 s timeout.
  await expect(page.locator("html")).not.toHaveAttribute("data-bar-tucked", { timeout: 1_000 })
})
