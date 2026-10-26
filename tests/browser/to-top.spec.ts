import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const longPage = "/learn/gke-for-beginners"

// Kept in step with local-plugins/to-top/scripts/to-top.mjs by scripts/to-top.test.mjs.
const MIN_REVEAL = 320
const STEP = 12

const limitOf = (page: Page) =>
  page.evaluate((min) => Math.max(min, Math.round(window.innerHeight / 2)), MIN_REVEAL)
const maxYOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
const scrollYOf = (page: Page) => page.evaluate(() => window.scrollY)

async function scrollTo(page: Page, y: number) {
  await page.evaluate(async (top) => {
    window.scrollTo({ top, behavior: "instant" })
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  }, y)
}

async function frames(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  )
}

// Reading down, then a short way back up: the button is on.
async function showIt(page: Page) {
  const limit = await limitOf(page)
  await scrollTo(page, limit + 300)
  await scrollTo(page, limit + 700)
  await scrollTo(page, limit + 500)
  await expect(page.locator("#to-top")).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto(longPage)
  await expect(page.locator("#to-top")).toBeAttached()
})

test("hidden at the top of the page", async ({ page }) => {
  const btn = page.locator("#to-top")
  const limit = await limitOf(page)
  expect(await maxYOf(page)).toBeGreaterThan(limit + 800)
  await expect(btn).not.toBeVisible()
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById("to-top")!).visibility),
  ).toBe("hidden")
})

test("hidden while reading downwards", async ({ page }) => {
  const limit = await limitOf(page)
  await scrollTo(page, limit + 300)
  await scrollTo(page, limit + 700)
  await expect(page.locator("#to-top")).not.toBeVisible()
})

test("a short step up does not show it", async ({ page }) => {
  const limit = await limitOf(page)
  await scrollTo(page, limit + 700)
  await scrollTo(page, limit + 700 - (STEP - 1))
  await expect(page.locator("#to-top")).not.toBeVisible()
})

test("shown when scrolling back up", async ({ page }) => {
  await showIt(page)
  await expect(page.locator("#to-top")).toHaveClass(/\bon\b/)
})

test("shown at the end of the page", async ({ page }) => {
  await scrollTo(page, await maxYOf(page))
  await expect(page.locator("#to-top")).toBeVisible()
})

test("focus keeps it shown", async ({ page }) => {
  const btn = page.locator("#to-top")
  await showIt(page)
  await btn.focus()
  await scrollTo(page, (await scrollYOf(page)) + 400)
  await expect(btn).toBeVisible()
})

test("a click goes to the top and puts the keyboard on the wordmark", async ({ page }) => {
  const btn = page.locator("#to-top")
  await scrollTo(page, await maxYOf(page))
  await expect(btn).toBeVisible()
  await btn.click()
  await expect.poll(() => scrollYOf(page)).toBe(0)
  expect(
    await page.evaluate(() => document.activeElement?.classList.contains("top-bar-brand")),
  ).toBe(true)
  await expect(btn).not.toBeVisible()
})

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" })
  test("the scroll is instant", async ({ page }) => {
    await scrollTo(page, await maxYOf(page))
    await page.locator("#to-top").click()
    await frames(page)
    expect(await scrollYOf(page)).toBe(0)
  })
})

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" })
  test("the scroll reaches the top and the button goes away", async ({ page }) => {
    const btn = page.locator("#to-top")
    await scrollTo(page, await maxYOf(page))
    await expect(btn).toBeVisible()
    await btn.click()
    await expect.poll(() => scrollYOf(page)).toBe(0)
    await expect(btn).not.toBeVisible()
  })
})

test("the label shows only on wide screens", async ({ page }) => {
  await scrollTo(page, await maxYOf(page))
  await expect(page.locator("#to-top")).toBeVisible()
  const width = page.viewportSize()!.width
  const label = page.locator("#to-top span")
  if (width >= 1440) await expect(label).toBeVisible()
  else await expect(label).not.toBeVisible()
})

test("a 44px target inside the viewport, no sideways scroll", async ({ page }) => {
  await scrollTo(page, await maxYOf(page))
  const btn = page.locator("#to-top")
  await expect(btn).toBeVisible()
  const box = (await btn.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test("the footer can scroll clear of the button at the end of the page", async ({ page }) => {
  await scrollTo(page, await maxYOf(page))
  await expect(page.locator("#to-top")).toBeVisible()
  const overlaps = await page.evaluate(() => {
    const b = document.getElementById("to-top")!.getBoundingClientRect()
    const hit = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top
    }
    const footer = document.querySelector("footer")!
    const links = [...footer.querySelectorAll("a")]
    return [footer, ...links].some(hit)
  })
  expect(overlaps).toBe(false)
})

test("hidden while the search is open", async ({ page }) => {
  const btn = page.locator("#to-top")
  await showIt(page)
  await page.keyboard.press("ControlOrMeta+k")
  await expect(page.locator(".search-container.active")).toBeVisible()
  await expect(btn).not.toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".search-container.active")).toHaveCount(0)
  await scrollTo(page, (await limitOf(page)) + 700)
  await scrollTo(page, (await limitOf(page)) + 500)
  await expect(btn).toBeVisible()
})

test("hidden while the Browse drawer is open", async ({ page }) => {
  const btn = page.locator("#to-top")
  await showIt(page)
  const toggle = page.locator(".mobile-explorer:not(.hide-until-loaded)").first()
  await toggle.evaluate((el: HTMLElement) => el.click())
  await expect(page.locator(".explorer[data-open]")).toBeAttached()
  await expect(btn).not.toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".explorer[data-open]")).toHaveCount(0)
  await scrollTo(page, (await limitOf(page)) + 700)
  await scrollTo(page, (await limitOf(page)) + 500)
  await expect(btn).toBeVisible()
})

test("works after client-side navigations, with exactly one listener", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("#to-top")).toBeAttached()
  await page.evaluate(() => {
    const a = document.createElement("a")
    a.href = "/learn/gke-for-beginners"
    a.id = "spa-link"
    document.body.append(a)
  })
  await page.locator("#spa-link").evaluate((el: HTMLElement) => el.click())
  await page.waitForURL(/gke-for-beginners/)
  await expect(page.locator("#to-top")).toHaveCount(1)
  await showIt(page)
  await page.locator("#to-top").click()
  await expect.poll(() => scrollYOf(page)).toBe(0)
  await page.goBack()
  await page.waitForURL((u) => u.pathname === "/")
  await page.goForward()
  await page.waitForURL(/gke-for-beginners/)
  await expect(page.locator("#to-top")).toHaveCount(1)
  await showIt(page)
  // A second binding would call scrollTo twice for one click.
  await page.evaluate(() => {
    const w = window as unknown as { __scrollTos: number }
    w.__scrollTos = 0
    const original = window.scrollTo.bind(window) as (...args: unknown[]) => void
    window.scrollTo = ((...args: unknown[]) => {
      w.__scrollTos++
      original(...args)
    }) as typeof window.scrollTo
  })
  await page.locator("#to-top").click()
  await expect.poll(() => scrollYOf(page)).toBe(0)
  expect(
    await page.evaluate(() => (window as unknown as { __scrollTos: number }).__scrollTos),
  ).toBe(1)
})

test("the keyboard reaches it after the page, not from the wordmark", async ({ page }) => {
  await showIt(page)
  const place = await page.evaluate(() => {
    const btn = document.getElementById("to-top")!
    const main = document.querySelector("main, article")!
    return {
      inBanner: !!btn.closest("[role=banner], header"),
      afterMain: !!(main.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
      // Only the table of contents (the right sidebar) and the footer come after it: nothing of
      // the bar or of the page itself.
      later: [
        ...document.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex]"),
      ].filter(
        (el) =>
          !el.closest("footer, .right.sidebar") &&
          el !== btn &&
          el.tabIndex >= 0 &&
          !!(btn.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).length,
    }
  })
  expect(place.inBanner).toBe(false)
  expect(place.afterMain).toBe(true)
  expect(place.later).toBe(0)
  await page.locator(".top-bar-brand").focus()
  await page.keyboard.press("Tab")
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("to-top")
})

test("the Browse drawer and the search paint over it", async ({ page }) => {
  // No ancestor makes a stacking context or a containing block for a fixed box, and the z-index is
  // below the bar's (the drawer and the search overlay are inside the bar).
  const ctx = await page.evaluate(() => {
    const btn = document.getElementById("to-top")!
    const bad: string[] = []
    for (let el = btn.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el)
      const flags = [
        cs.transform !== "none" && "transform",
        cs.filter !== "none" && "filter",
        cs.backdropFilter && cs.backdropFilter !== "none" && "backdrop-filter",
        cs.perspective !== "none" && "perspective",
        cs.contain !== "none" && cs.contain !== "" && "contain",
        cs.zIndex !== "auto" && cs.position !== "static" && "z-index",
        cs.willChange !== "auto" &&
          /transform|filter|perspective/.test(cs.willChange) &&
          "will-change",
      ].filter(Boolean)
      if (flags.length) bad.push(`${el.tagName.toLowerCase()}.${el.className}: ${flags.join(",")}`)
    }
    const bar = getComputedStyle(document.querySelector(".page > #quartz-body > .sidebar.left")!)
    return { bad, own: Number(getComputedStyle(btn).zIndex), bar: Number(bar.zIndex) }
  })
  expect(ctx.bad).toEqual([])
  expect(ctx.own).toBeGreaterThan(0)
  expect(ctx.own).toBeLessThan(ctx.bar)

  // Forced visible in the same task (the script reacts a frame later), the button is not what
  // is at its own centre while the search or the drawer is open.
  const topAtButton = (forceOn: boolean) =>
    page.evaluate((on) => {
      const btn = document.getElementById("to-top")!
      if (on) btn.classList.add("on")
      const r = btn.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit === btn || !!hit?.closest("#to-top")
    }, forceOn)
  await page.keyboard.press("ControlOrMeta+k")
  await expect(page.locator(".search-container.active")).toBeVisible()
  expect(await topAtButton(true)).toBe(false)
  await page.keyboard.press("Escape")
  await expect(page.locator(".search-container.active")).toHaveCount(0)
  await frames(page)
  const toggle = page.locator(".mobile-explorer:not(.hide-until-loaded)").first()
  await toggle.evaluate((el: HTMLElement) => el.click())
  await expect(page.locator(".explorer[data-open]")).toBeAttached()
  expect(await topAtButton(true)).toBe(false)
})

test("it is not printed", async ({ page }) => {
  await showIt(page)
  await page.emulateMedia({ media: "print" })
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById("to-top")!).display),
  ).toBe("none")
})

test("at tablet width it keeps 24px from the right and bottom edges", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.reload()
  await expect(page.locator("#to-top")).toBeAttached()
  await scrollTo(page, await maxYOf(page))
  const btn = page.locator("#to-top")
  await expect(btn).toBeVisible()
  const box = (await btn.boundingBox())!
  const vp = page.viewportSize()!
  expect(vp.width - (box.x + box.width)).toBeGreaterThanOrEqual(24)
  expect(vp.height - (box.y + box.height)).toBeGreaterThanOrEqual(24)
})

test("on a short landscape screen it still shows and stays inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.reload()
  await expect(page.locator("#to-top")).toBeAttached()
  await showIt(page)
  const box = (await page.locator("#to-top").boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
})

test("a scroll move the page announces as its own layout shift does not show it", async ({
  page,
}) => {
  const btn = page.locator("#to-top")
  const limit = await limitOf(page)
  await scrollTo(page, limit + 700)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("notes:layoutshift", { detail: [-80] }))
    window.scrollBy({ top: -80, behavior: "instant" })
  })
  await frames(page)
  await expect(btn).not.toBeVisible()
  // The same move, not announced, is the reader scrolling up.
  await page.evaluate(() => window.scrollBy({ top: -80, behavior: "instant" }))
  await frames(page)
  await expect(btn).toBeVisible()
})

test("a theme switch on a page with diagrams does not show it", async ({ page, isMobile }) => {
  const { browserName } = test.info().project.use
  test.slow(browserName === "webkit" && !!isMobile, "headless WebKit at 3x paints slowly")
  await page.goto("/patterns/gke-blue-green-releases")
  await page.waitForLoadState("networkidle")
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".center code.mermaid")].every((el) =>
        el.querySelector(":scope > svg"),
      ),
    undefined,
    { timeout: 15_000 },
  )
  const limit = await limitOf(page)
  await page.evaluate(async (min) => {
    const code = document.querySelector(".center code.mermaid")!
    const r = (code.closest("pre") ?? code).getBoundingClientRect()
    const y = Math.max(r.bottom + window.scrollY + 300, min + 300)
    window.scrollTo({ top: y - 200, behavior: "instant" })
    await new Promise<void>((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => res())),
    )
    window.scrollTo({ top: y, behavior: "instant" })
  }, limit)
  await frames(page)
  const btn = page.locator("#to-top")
  await expect(btn).not.toBeVisible()
  await page.evaluate(() => {
    const w = window as unknown as { __shown: number }
    w.__shown = 0
    const el = document.getElementById("to-top")!
    new MutationObserver(() => {
      if (el.classList.contains("on")) w.__shown++
    }).observe(el, { attributes: true, attributeFilter: ["class"] })
  })
  // Not locator.click(): it scrolls the toggle into view, which is the reader scrolling up.
  const box = (await page.locator(".darkmode").first().boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  if (isMobile) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark")
  await page.waitForTimeout(2_500)
  expect(await page.evaluate(() => (window as unknown as { __shown: number }).__shown)).toBe(0)
})

test("shows in both themes with an opaque background", async ({ page }) => {
  const bg = () =>
    page.evaluate(() => getComputedStyle(document.getElementById("to-top")!).backgroundColor)
  await showIt(page)
  const light = await bg()
  expect(light).not.toBe("rgba(0, 0, 0, 0)")
  await page.locator(".darkmode").first().click()
  await expect(page.locator("html")).toHaveAttribute("saved-theme", "dark")
  await showIt(page)
  const dark = await bg()
  expect(dark).not.toBe("rgba(0, 0, 0, 0)")
  expect(dark).not.toBe(light)
})
