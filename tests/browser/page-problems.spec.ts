// Uses Playwright's own test, not the fixture's: these tests raise page errors on purpose.
import { expect, test } from "@playwright/test"
import { recordProblems } from "./page-problems"

for (const [name, trigger, kind] of [
  [
    "a plain-object rejection",
    () => setTimeout(() => void Promise.reject({ probe: "plain-object" }), 0),
    "unhandledrejection",
  ],
  [
    "a thrown plain object",
    () =>
      setTimeout(() => {
        throw { probe: "thrown" }
      }, 0),
    "error",
  ],
] as const) {
  test(`${name} is reported with its source and shape`, async ({ page, baseURL }) => {
    const rec = await recordProblems(page, baseURL)
    await page.goto("/")
    await page.evaluate(trigger)
    await expect.poll(() => rec.problems.length).toBe(1)
    await expect.poll(() => rec.details.length).toBe(1)
    expect(rec.problems[0]).toMatch(/^page error: /)
    expect(rec.problems[0]).toContain(`page ${baseURL}/`)
    expect(rec.details[0].startsWith(`${kind}: `)).toBe(true)
    expect(rec.details[0]).toContain("constructor=Object")
    expect(rec.details[0]).toContain(
      name.includes("thrown") ? '"probe":"thrown"' : '"probe":"plain-object"',
    )
    expect(rec.details[0]).toContain(`document ${baseURL}/`)
  })
}

test("a rejection with an Error names its type and message and adds no detail", async ({
  page,
  baseURL,
}) => {
  const rec = await recordProblems(page, baseURL)
  await page.goto("/")
  await page.evaluate(() =>
    setTimeout(() => void Promise.reject(new TypeError("probe failure")), 0),
  )
  await expect.poll(() => rec.problems.length).toBe(1)
  expect(rec.problems[0]).toContain("TypeError")
  expect(rec.problems[0]).toContain("probe failure")
  expect(rec.details).toEqual([])
})
