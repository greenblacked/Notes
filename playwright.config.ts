/// <reference types="node" />
import { defineConfig } from "@playwright/test"

const port = 4173
const baseURL = `http://127.0.0.1:${port}`

// Browser smoke tests against the built site (public/) served through the Worker by
// scripts/serve-built-site.mjs. Build first: npm run build.
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "node scripts/serve-built-site.mjs",
    url: `${baseURL}/version.txt`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { PUBLIC_DIR: process.env.PUBLIC_DIR ?? "public", PORT: String(port) },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "webkit-desktop",
      use: { browserName: "webkit", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-phone",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "webkit-phone",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
