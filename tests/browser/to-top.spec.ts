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

test("works after client-side navigations, with one listener", async ({ page }) => {
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
  await page.locator("#to-top").click()
  await expect.poll(() => scrollYOf(page)).toBe(0)
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
