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

type Sampled = { samples: Sample[]; fadePath: boolean; motion: boolean }

// Clicks the theme toggle like a user (mouse on desktop, a tap on phones) and samples the top bar,
// its section row, the scroll position and the theme icon on every animation frame and
// every 16ms timer tick for 900ms.
async function switchAndSample(page: Page, isMobile: boolean): Promise<Sampled> {
  const btn = page.locator(".darkmode").first()
  const box = await btn.boundingBox() // does not scroll, unlike locator.click()
  expect(box).not.toBeNull()
  await page.evaluate(() => {
    const w = window as unknown as { __s: Sample[]; __tc: number; __done: Promise<void> }
    const bar = document.querySelector(".page > #quartz-body > .sidebar.left")!
    const row = bar.querySelector(".section-row")!
    const icons = [...document.querySelectorAll<SVGElement>(".darkmode > svg")]
    const r = (el: Element) => {
      const b = el.getBoundingClientRect()
      return [b.top, b.left, b.width, b.height]
    }
    w.__s = []
    w.__tc = NaN
    // The click time, taken in the capture phase on window so it runs before top-bar's own
    // capture listener on document starts the switch.
    window.addEventListener("pointerdown", () => (w.__tc = performance.now()), {
      capture: true,
      once: true,
    })
    w.__done = new Promise<void>((res) => {
      let finished = false
      let last = -1
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
        if (t - w.__tc >= 900) {
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
  return page.evaluate(() => ({
    // t in ms from the click: negative before it.
    samples: (window as unknown as { __s: Sample[]; __tc: number }).__s.map((s) => ({
      ...s,
      t: s.t - (window as unknown as { __tc: number }).__tc,
    })),
    fadePath:
      typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition ===
        "function" &&
      matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches,
    motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  }))
}

// The switch itself lasts under 400ms (cross-fade 180ms after a 70-200ms snapshot, icon turn 380ms). How many samples land
// in it depends on the engine, since WebKit's main thread is busy during the switch, so assert
// that the samples cover the switch instead of counting them. Sample times count from the click.
function expectStillGeometry(samples: Sample[], testInfo: TestInfo) {
  const first = samples[0]
  const times = samples.map((s) => Math.round(s.t))
  testInfo.annotations.push({
    type: "sample times (ms)",
    description: `${samples.length} samples: ${times.join(" ")}`,
  })
  const inWindow = samples.filter((s) => s.t >= 30 && s.t <= 400).length
  const after = samples.filter((s) => s.t >= 600).length
  const covered = samples.at(-1)!.t >= 900 && samples.length >= 5 && inWindow >= 1 && after >= 1
  expect(
    covered,
    `samples, timed from the click, must span 900ms with at least one in 30-400ms and one from 600ms on (got ${samples.length} samples, ${inWindow} in the window, ${after} after it): ${times.join(" ")}`,
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
        const { samples, fadePath } = await switchAndSample(page, isMobile)
        await expect(page.locator("html")).not.toHaveAttribute("saved-theme", before ?? "")

        expectStillGeometry(samples, testInfo)
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
