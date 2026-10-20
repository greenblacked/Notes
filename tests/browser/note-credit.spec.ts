import { expect, test } from "./fixtures"

const note = "/runbooks/tls-certificate-renewal"
// The first candidate without a "Linked from" list is used for the no-backlinks test; the first
// with one for the other.
const candidates = [
  "/", // nothing links to the home page
  "/runbooks/tls-certificate-renewal",
  "/learn/gke-for-beginners",
  "/adr/",
  "/compliance/",
  "/standards/",
  "/ai/",
]

test.describe("note credit", () => {
  test("names the author and links the catalogue, source and issue report", async ({ page }) => {
    await page.goto(note)
    const credit = page.locator(".note-credit")
    await expect(credit).toHaveCount(1)
    await expect(credit).toContainText("Engineering notes by Serhii Zolotov")
    await expect(credit.getByRole("link", { name: "AI skills catalogue" })).toHaveAttribute(
      "href",
      "https://ai.szolotov.com",
    )
    await expect(credit.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/greenblacked/Notes/blob/main/content/runbooks/tls-certificate-renewal.md",
    )
    const report = credit.getByRole("link", { name: "Report an issue with this note" })
    const url = new URL((await report.getAttribute("href"))!)
    expect(url.origin).toBe("https://github.com")
    expect(url.pathname).toBe("/greenblacked/Notes/issues/new")
    expect(url.searchParams.get("body")).toContain(
      "https://notes.szolotov.com/runbooks/tls-certificate-renewal",
    )
    const h1 = (await page.locator("h1").first().innerText()).trim()
    expect(url.searchParams.get("title")).toContain(h1)
    await expect(credit.locator("form")).toHaveCount(0)
    for (const a of await credit.locator("a").all()) {
      await expect(a).toHaveAttribute("rel", /noopener/)
    }
  })

  test("the aside is a labelled landmark", async ({ page }) => {
    await page.goto(note)
    await expect(page.getByRole("complementary", { name: "About this note" })).toHaveCount(1)
  })

  test("keeps the Linked from list where notes link here", async ({ page }) => {
    let found = 0
    for (const path of candidates) {
      await page.goto(path)
      if ((await page.locator(".linked-from").count()) > 0) {
        await expect(page.locator(".linked-from h2")).toHaveText("Linked from")
        found++
        break
      }
    }
    // The credit sits after the list.
    expect(found, "a candidate note has backlinks").toBeGreaterThan(0)
  })

  test("a note without backlinks still shows the credit", async ({ page }) => {
    let checked = ""
    for (const path of candidates) {
      await page.goto(path)
      if ((await page.locator(".linked-from").count()) === 0) {
        checked = path
        break
      }
    }
    expect(checked, "a candidate note without backlinks").not.toBe("")
    await expect(page.locator(".note-credit")).toHaveCount(1)
  })

  test("the home page reports the site root, with nothing after the slash", async ({ page }) => {
    await page.goto("/")
    const href = await page
      .locator(".note-credit")
      .getByRole("link", { name: "Report an issue with this note" })
      .getAttribute("href")
    const body = new URL(href!).searchParams.get("body")!
    expect(body).toContain("Page: https://notes.szolotov.com/\n")
  })

  test("section indexes (folder pages) and the 404 page have no credit", async ({ page }) => {
    await page.goto("/runbooks/")
    await expect(page.locator("h1").first()).toBeVisible()
    await expect(page.locator(".note-credit")).toHaveCount(0)
    await page.goto("/404.html")
    await expect(page.locator(".note-credit")).toHaveCount(0)
  })

  for (const scheme of ["light", "dark"] as const) {
    test(`no sideways overflow, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(note)
      await expect(page.locator(".note-credit")).toHaveCount(1)
      const over = await page.evaluate(() => {
        const el = document.querySelector(".note-credit")!
        const r = el.getBoundingClientRect()
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          right: r.right - document.documentElement.clientWidth,
        }
      })
      expect(over.page).toBeLessThanOrEqual(0)
      expect(over.right).toBeLessThanOrEqual(0)
    })
  }

  test("links are reachable by keyboard and show a focus outline", async ({ page }) => {
    await page.goto(note)
    const links = page.locator(".note-credit a")
    await expect(links).toHaveCount(3)
    await links.first().focus()
    for (let i = 0; i < 3; i++) {
      const focused = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement
        return { inside: !!a.closest(".note-credit"), outline: getComputedStyle(a).outlineStyle }
      })
      expect(focused.inside).toBe(true)
      expect(focused.outline).not.toBe("none")
      await page.keyboard.press("Tab")
    }
  })
})
