import assert from "node:assert/strict"
import { test } from "node:test"
import { experimental_readRawConfig as readRawConfig } from "wrangler"

// The indexing policy relies on these settings of wrangler.jsonc.
test("wrangler.jsonc: one Worker, production vars, stage Preview vars, Preview-enabled route", () => {
  const { rawConfig } = readRawConfig({ config: "wrangler.jsonc" })
  assert.equal(rawConfig.name, "notes")
  assert.equal(rawConfig.env, undefined)
  assert.equal(rawConfig.vars?.ENVIRONMENT, "production")
  assert.equal(rawConfig.previews?.vars?.ENVIRONMENT, "stage")
  assert.equal(rawConfig.workers_dev, true)
  assert.deepEqual(rawConfig.routes, [
    { pattern: "notes.szolotov.com", custom_domain: true, previews_enabled: true },
  ])
})
