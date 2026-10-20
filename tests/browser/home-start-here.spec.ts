import { expect, test } from "./fixtures"

const GOALS = [
  "Resolve an operational problem",
  "Design or improve a platform",
  "Develop engineering skills",
  "Lead a platform team",
]

const overflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test("the home page offers four reader goals, each leading to a note with evidence", async ({
  page,
}) => {
  await page.goto("/")
  const area = page.locator(".start-here")
  await expect(area.getByRole("heading", { level: 2, name: "Start here" })).toBeVisible()
  await expect(area.locator(".start-here-goal > h3")).toHaveText(GOALS)
  const goals = area.locator(".start-here-goal")
  for (let i = 0; i < GOALS.length; i++) {
    expect(await goals.nth(i).locator("a").count()).toBeGreaterThan(0)
  }
  const featured = await area
    .locator(".start-here-featured a")
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))
  // at least one featured note per goal that features notes; the exact count is data
  expect(featured.length).toBeGreaterThanOrEqual(2)
  for (const href of featured) {
    const response = await page.goto(href)
    expect(response?.status(), href).toBe(200)
    await expect(page.locator(".note-meta").first()).toContainText("Evidence")
  }
})

test("the All notes link is in the first viewport and opens the full catalogue", async ({
  page,
}) => {
  await page.goto("/")
  // Guards the intro link in content/index.md: if the intro is reworded so that this
  // link falls below the first screen, a returning visitor no longer reaches the catalogue at once.
  const link = page.locator('.center a[href$="all-notes"]').first()
  await expect(link).toBeVisible()
  const box = (await link.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  await link.click()
  await expect(page).toHaveURL(/\/all-notes$/)
  await expect(page.locator(".note-index")).toBeVisible()
  expect(await page.locator(".note-index-row").count()).toBeGreaterThan(100)
  expect(await page.locator('.note-index-row a[href$="all-notes"]').count()).toBe(0)
})

test("the old home anchors still land on the same content", async ({ page }) => {
  for (const id of ["note-index-title", "note-index-runbooks"]) {
    await page.goto(`/#${id}`)
    const target = page.locator(`[id="${id}"]`)
    await expect(target).toHaveCount(1)
    await expect(target).toBeInViewport()
  }
  await page.goto("/all-notes")
  await expect(page.locator('[id="note-index-title"]')).toHaveCount(1)
  await expect(page.locator('[id="note-index-runbooks"]')).toHaveCount(1)
})

for (const theme of ["light", "dark"]) {
  test(`no sideways scroll on the home page and All notes (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme)
    for (const path of ["/", "/all-notes"]) {
      await page.goto(path)
      await expect(page.locator("html")).toHaveAttribute("saved-theme", theme)
      await expect(page.locator(".start-here, .note-index").first()).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    }
  })
}

test("the home page shows no status chips", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator(".start-here")).toBeVisible()
  await expect(page.locator(".chip-status, [data-status]")).toHaveCount(0)
})

test("the home page has no Linked from block and All notes has a single All notes h1", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.locator(".linked-from")).toHaveCount(0)
  await page.goto("/all-notes")
  await expect(page.getByRole("heading", { name: "All notes", exact: true })).toHaveCount(1)
  await expect(page.locator('[id="note-index-title"]')).toHaveCount(1)
})
