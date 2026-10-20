import type { Page } from "@playwright/test"
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
    const w = window as unknown as { __s: Sample[]; __done: Promise<void> }
    const bar = document.querySelector(".page > #quartz-body > .sidebar.left")!
    const row = bar.querySelector(".section-row")!
    const icons = [...document.querySelectorAll<SVGElement>(".darkmode > svg")]
    const r = (el: Element) => {
      const b = el.getBoundingClientRect()
      return [b.top, b.left, b.width, b.height]
    }
    w.__s = []
    const t0 = performance.now()
    w.__done = new Promise<void>((res) => {
      let finished = false
      let last = -1
      const tick = () => {
        if (finished) return
        const t = performance.now() - t0
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
        if (t >= 900) {
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
    samples: (window as unknown as { __s: Sample[] }).__s,
    fadePath:
      typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition ===
        "function" &&
      matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches,
    motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  }))
}

function expectStillGeometry(samples: Sample[]) {
  const first = samples[0]
  // Frames get sparse while the snapshot is captured (and headless WebKit gives few), so check
  // the span and a floor that the 16ms timer reaches even when frames are sparse.
  expect(samples.at(-1)!.t).toBeGreaterThanOrEqual(900)
  expect(samples.length).toBeGreaterThanOrEqual(20)
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

        expectStillGeometry(samples)
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
