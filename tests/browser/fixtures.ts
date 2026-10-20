import { test as base, expect } from "@playwright/test"

// Every test also fails on an uncaught page error, a console error or a failed (status >= 400)
// request to the site's own origin.
export const test = base.extend<{ problems: void }>({
  problems: [
    async ({ page, baseURL }, use) => {
      const problems: string[] = []
      page.on("pageerror", (error) => problems.push(`page error: ${error.message}`))
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console error: ${message.text()}`)
      })
      page.on("response", (response) => {
        if (baseURL && response.url().startsWith(baseURL) && response.status() >= 400) {
          problems.push(`HTTP ${response.status()}: ${response.url()}`)
        }
      })
      await use()
      expect(problems, "no page errors, console errors or failed requests").toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
