import { expect, test } from "./fixtures"

const longPage = "/learn/gke-for-beginners"

test("home page loads cleanly and does not scroll sideways", async ({ page }) => {
  const response = await page.goto("/")
  expect(response?.status()).toBe(200)
  await expect(page.locator(".center").first()).toBeVisible()
  await expect(page.locator(".note-index").first()).toBeAttached()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test("search opens with the shortcut and closes with Escape", async ({ page }) => {
  await page.goto("/")
  await page.keyboard.press("ControlOrMeta+k")
  await expect(page.locator(".search-container.active")).toBeVisible()
  await expect(page.locator(".search-bar")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator(".search-container.active")).toHaveCount(0)
  await expect(page.locator(".search-button")).toBeFocused()
})

test("Browse drawer opens and closes from the keyboard", async ({ page }) => {
  await page.goto("/")
  const button = page.locator(".mobile-explorer:not(.hide-until-loaded)").first()
  await expect(button).toBeAttached()
  await button.focus()
  await page.keyboard.press("Enter")
  await expect(page.locator(".explorer[data-open]").first()).toBeAttached()
  await expect(button).toHaveAttribute("aria-expanded", "true")
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest(".explorer-content")))
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(page.locator(".explorer[data-open]")).toHaveCount(0)
  await expect(button).toBeFocused()
})

test("dark theme sticks across navigation and reload", async ({ page }) => {
  await page.goto("/")
  const root = page.locator(":root")
  await expect(root).not.toHaveAttribute("saved-theme", "dark")
  await page.locator(".darkmode").first().click()
  await expect(root).toHaveAttribute("saved-theme", "dark")
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark")

  const link = page.locator('.section-row a[href*="patterns"]').first()
  await link.scrollIntoViewIfNeeded()
  await link.click()
  await expect(page).toHaveURL(/\/patterns\/?$/)
  await expect(root).toHaveAttribute("saved-theme", "dark")

  await page.reload()
  await expect(root).toHaveAttribute("saved-theme", "dark")
})

test("section link navigates and Back returns home", async ({ page }) => {
  await page.goto("/")
  const link = page.locator('.section-row a[href*="patterns"]').first()
  await link.scrollIntoViewIfNeeded()
  await link.click()
  await expect(page).toHaveURL(/\/patterns\/$/)
  await expect(page.locator(".section-row a[aria-current]").first()).toBeAttached()
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator(".center").first()).toBeVisible()
})

test("section row tucks away on scrolling down and returns on scrolling up", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "desktop only")
  await page.goto(longPage)
  const html = page.locator("html")
  await expect(html).not.toHaveAttribute("data-bar-tucked", /.*/)
  await page.mouse.move(700, 500)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400)
  await expect(html).toHaveAttribute("data-bar-tucked", /.*/)
  await page.mouse.wheel(0, -200)
  await expect(html).not.toHaveAttribute("data-bar-tucked", /.*/)
})

test("collapsible callout folds from the keyboard", async ({ page }) => {
  await page.goto(longPage)
  const title = page.locator(".callout.is-collapsible > .callout-title").first()
  await expect(title).toBeAttached()
  const callout = page.locator(".callout.is-collapsible").first()
  const collapsed = await callout.evaluate((el) => el.classList.contains("is-collapsed"))
  await title.focus()
  await page.keyboard.press("Enter")
  await expect(callout).toHaveClass(collapsed ? /^(?!.*is-collapsed)/ : /is-collapsed/)
  await expect(title).toHaveAttribute("aria-expanded", String(collapsed))
  await page.keyboard.press("Enter")
  await expect(callout).toHaveClass(collapsed ? /is-collapsed/ : /^(?!.*is-collapsed)/)
  await expect(title).toHaveAttribute("aria-expanded", String(!collapsed))
})

test("graph dialog opens and closes with focus restored", async ({ page }) => {
  await page.goto("/")
  const launcher = page.locator(".graph-launcher").first()
  await launcher.click()
  await expect(page.locator("#graph-dialog[open]")).toBeAttached()
  await expect(launcher).toHaveAttribute("aria-expanded", "true")
  const wrap = page.locator(".graph-canvas-wrap").first()
  await expect(wrap).not.toHaveAttribute("data-state", "loading")
  await expect(wrap).not.toHaveAttribute("data-state", "error")
  await page.keyboard.press("Escape")
  await expect(page.locator("#graph-dialog[open]")).toHaveCount(0)
  await expect(launcher).toHaveAttribute("aria-expanded", "false")
  await expect(launcher).toBeFocused()
})

test("pretty URLs, 404 page and headers match the Worker", async ({
  request,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== "chromium" || isMobile, "server parity is checked once")

  const folder = await request.get("/learn", { maxRedirects: 0 })
  if (folder.status() === 200) {
    expect(folder.url()).toMatch(/\/learn$/)
  } else {
    expect(folder.status()).toBeGreaterThanOrEqual(300)
    expect(folder.status()).toBeLessThan(400)
    expect(folder.headers().location).toMatch(/\/learn\/$/)
  }

  const missing = await request.get("/does-not-exist")
  expect(missing.status()).toBe(404)
  expect(missing.headers()["content-type"]).toContain("text/html")
  expect(await missing.text()).toContain("<html")

  const version = await request.get("/version.txt")
  expect(version.status()).toBe(200)
  expect(version.headers()["x-robots-tag"]).toBe("noindex, nofollow")
  expect(version.headers()["x-content-type-options"]).toBe("nosniff")
  expect(version.headers()["cache-control"]).toBe("no-store")
})
