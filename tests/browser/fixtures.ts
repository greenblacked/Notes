import { test as base, expect } from "@playwright/test"
import { recordProblems } from "./page-problems"

// Every test also fails on an uncaught page error, a console error or a failed (status >= 400)
// request to the site's own origin. Details of non-Error values are shown with the failure; they
// never pass a test.
export const test = base.extend<{ problems: void }>({
  problems: [
    async ({ page, baseURL }, use) => {
      const { problems, details } = await recordProblems(page, baseURL)
      await use()
      expect(
        problems,
        `no page errors, console errors or failed requests${details.length ? "\n" + details.join("\n") : ""}`,
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
