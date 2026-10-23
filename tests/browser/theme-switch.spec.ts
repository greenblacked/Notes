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
      }, testInfo) => {
        await page.goto(longPage)
        await expect(page.locator("html")).toHaveClass(/motion-ready/)
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
        test.beforeEach(async ({ page }) => {
          test.skip(
            (page.viewportSize()?.height ?? 0) < 30 * 16,
            "the bar is not sticky under 30rem",
          )
          if (start.saved)
            await page.addInitScript((t) => localStorage.setItem("theme", t), start.saved)
          await page.goto(longPage)
          await page.evaluate(installTuckProbe)
          await expect(page.locator("html")).toHaveClass(/motion-ready/)
          await expect(page.locator("html")).toHaveAttribute("saved-theme", start.theme)
          await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }))
          await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
          await expect.poll(() => tuckRunning(page)).toEqual([]) // the tuck slide has finished
        })

        test("the row slides back on a scroll right after the switch", async ({
          page,
          isMobile,
        }) => {
          await page.evaluate(() => {
            const w = window as unknown as TuckWindow & { requestIdleCallback: () => number }
            // Keep .theme-switching on for the whole test, whatever the frame timing: the class
            // is taken off when the page is idle, which never comes here (Safari has no idle
            // callback and falls back to a timer, so this also hides that timer).
            w.requestIdleCallback = () => 0
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
                    requestAnimationFrame(() =>
                      resolve({
                        switching: on && root.classList.contains("theme-switching"),
                        running: w.__tuck(),
                      }),
                    )
                  }).observe(root, { attributes: true, attributeFilter: ["data-bar-tucked"] })
                  window.scrollBy({ top: -40, behavior: "instant" })
                },
                { once: true },
              )
            })
          })
          await tapToggle(page, isMobile)
          const r = await page.evaluate(() => (window as unknown as TuckWindow).__untuck)
          expect(r.switching, "the row must come back while the switch is still on").toBe(true)
          expect(r.running).toEqual(motion ? SLIDE : [])
          await expect(page.locator("html")).not.toHaveAttribute("saved-theme", start.theme)
          await expect(page.locator(`${BAR} .section-row-links`)).toHaveCSS("transform", "none", {
            timeout: 2_000,
          })
        })

        test("a slide under way runs on through the switch", async ({ page, isMobile }) => {
          test.skip(!motion, "no slide with reduced motion")
          // A slow slide (only in this test), so that the tap surely lands while it runs.
          await page.addStyleTag({ content: `${BAR} { --dur: 5s; }` })
          await page.evaluate(() => window.scrollBy({ top: -40, behavior: "instant" }))
          await expect(page.locator("html")).not.toHaveAttribute("data-bar-tucked")
          await expect.poll(() => tuckRunning(page)).toEqual(SLIDE)
          await tapToggle(page, isMobile)
          await expect(page.locator("html")).not.toHaveAttribute("saved-theme", start.theme)
          await expect(page.locator("html")).not.toHaveClass(/theme-switching/)
          expect(await tuckRunning(page)).toEqual(SLIDE) // not cancelled by the switch
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

test("the section row stays put while the diagrams are redrawn for a new theme", async ({
  page,
  isMobile,
}) => {
  test.skip((page.viewportSize()?.height ?? 0) < 30 * 16, "the bar is not sticky under 30rem")
  await page.goto(diagramPage)
  await page.waitForLoadState("networkidle")
  await page.waitForFunction(
    () => [...document.querySelectorAll("code.mermaid")].every((el) => el.querySelector("svg")),
    undefined,
    { timeout: 15_000 },
  )
  await expect(page.locator("html")).toHaveClass(/motion-ready/)
  // Scroll to 300px past the first diagram, where the row is tucked.
  await page.evaluate(() => {
    const code = document.querySelector("code.mermaid")!
    const r = (code.closest("pre") ?? code).getBoundingClientRect()
    window.scrollTo({ top: r.bottom + window.scrollY + 300, behavior: "instant" })
  })
  await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
  await page.waitForTimeout(600)
  const before = await page.evaluate(() => scrollY)
  await page.evaluate(() => {
    const w = window as unknown as { __log: string[] }
    w.__log = []
    const root = document.documentElement
    new MutationObserver(() =>
      w.__log.push(`tucked=${root.hasAttribute("data-bar-tucked")} y=${Math.round(scrollY)}`),
    ).observe(root, { attributes: true, attributeFilter: ["data-bar-tucked"] })
  })
  await tapToggle(page, isMobile)
  await expect(page.locator("html")).not.toHaveAttribute("saved-theme", "light")
  // Until the new SVGs are in (they were removed for a moment), then a while longer.
  await page.waitForFunction(
    () => [...document.querySelectorAll("code.mermaid")].every((el) => el.querySelector("svg")),
    undefined,
    { timeout: 15_000 },
  )
  await page.waitForTimeout(1_500)
  expect(await page.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual([])
  await expect(page.locator("html")).toHaveAttribute("data-bar-tucked", /.*/)
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2)
})
