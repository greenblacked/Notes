import { expect, test } from "./fixtures"

const nav = (page: import("@playwright/test").Page) => page.locator("nav.learn-nav")

test("a core lesson shows its stage, its number and the previous and next lesson", async ({
  page,
}) => {
  await page.goto("/learn/gke-for-beginners")
  const n = nav(page)
  await expect(n).toBeVisible()
  await expect(n).toContainText("Stage 7: Google Cloud")
  await expect(n).toContainText("Lesson 31 of 43")
  await expect(n.locator("a[rel=prev]")).toHaveAttribute(
    "href",
    /\/learn\/gcp-vpc-compute-and-cloud-sql$/,
  )
  await expect(n.locator("a[rel=prev]")).toContainText("GCP 03")
  await expect(n.locator("a[rel=next]")).toHaveAttribute(
    "href",
    /\/learn\/ci-cd-concepts-and-branching$/,
  )
  await expect(n.locator("a[rel=next]")).toContainText("Delivery 01")
})

test("the stage link goes to its heading on the learning path", async ({ page }) => {
  await page.goto("/learn/gke-for-beginners")
  const stage = nav(page).locator("a.learn-nav-stage")
  await expect(stage).toHaveAttribute("href", /\/learn\/?#stage-7-google-cloud$/)
  await stage.click()
  await expect(page).toHaveURL(/\/learn\/?#stage-7-google-cloud$/)
  await expect(page.locator("#stage-7-google-cloud")).toBeAttached()
})

test("the first lesson has no previous link and the last has no next link", async ({ page }) => {
  await page.goto("/learn/lab-setup")
  await expect(nav(page)).toContainText("Lesson 1 of 43")
  await expect(nav(page).locator("a[rel=prev]")).toHaveCount(0)
  await expect(nav(page).locator("a[rel=next]")).toHaveAttribute(
    "href",
    /\/learn\/linux-shell-and-filesystem$/,
  )
  await page.goto("/learn/becoming-a-middle-devops-engineer")
  await expect(nav(page)).toContainText("Lesson 43 of 43")
  await expect(nav(page).locator("a[rel=next]")).toHaveCount(0)
  await expect(nav(page).locator("a[rel=prev]")).toHaveCount(1)
})

test("a going-deeper lesson follows the optional chain", async ({ page }) => {
  await page.goto("/learn/rbac-roles-bindings-and-least-privilege")
  const n = nav(page)
  await expect(n).toContainText("Going deeper")
  await expect(n).toContainText("Optional lesson 3 of 10")
  await expect(n.locator("a[rel=prev]")).toHaveAttribute(
    "href",
    /\/learn\/image-build-speed-cache-mounts-and-measurement$/,
  )
  await expect(n.locator("a[rel=next]")).toHaveAttribute(
    "href",
    /\/learn\/helm-chart-authoring-schema-dependencies-and-tests$/,
  )
})

test("other pages have no lesson navigation", async ({ page }) => {
  for (const path of ["/learn/", "/runbooks/tls-certificate-renewal", "/"]) {
    await page.goto(path)
    await expect(page.locator(".learn-nav")).toHaveCount(0)
  }
})

for (const scheme of ["light", "dark"] as const) {
  test(`the navigation does not scroll sideways (${scheme})`, async ({ page }) => {
    // The longest titles: first and last of a stage with long neighbours.
    for (const path of [
      "/learn/gke-for-beginners",
      "/learn/helm-chart-authoring-schema-dependencies-and-tests",
      "/learn/jenkins-agents-configuration-as-code-and-shared-libraries",
    ]) {
      await page.goto(path)
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("saved-theme", theme),
        scheme,
      )
      await expect(nav(page)).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      const box = await nav(page).boundingBox()
      const vw = page.viewportSize()!.width
      expect(box!.x + box!.width).toBeLessThanOrEqual(vw)
    }
  })
}

test("the navigation is a named landmark and its links are reachable with Tab", async ({
  page,
}) => {
  await page.goto("/learn/gke-for-beginners")
  const n = page.getByRole("navigation", { name: "Learning path" })
  await expect(n).toHaveCount(1)
  const links = n.locator("a")
  const count = await links.count()
  expect(count).toBe(3)
  await links.first().focus()
  for (let i = 0; i < count; i++) {
    await expect(links.nth(i)).toBeFocused()
    const outline = await links.nth(i).evaluate((el) => {
      const s = getComputedStyle(el)
      return s.outlineStyle !== "none" || s.boxShadow !== "none"
    })
    expect(outline, "focus is visible").toBe(true)
    await page.keyboard.press("Tab")
  }
})
