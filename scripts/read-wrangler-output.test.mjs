import assert from "node:assert/strict"
import { test } from "node:test"
import { main, parseEntries, readDeploy, readPreview, validUrl } from "./read-wrangler-output.mjs"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Fixtures follow the entries Wrangler 4.149.0 writes (see the header of the parser).
const session = { type: "wrangler-session", version: 1, timestamp: "2026-10-10T10:00:00.000Z" }
const deploy = {
  type: "deploy",
  version: 1,
  worker_name: "notes",
  worker_tag: "abc123",
  version_id: "5f0a3b7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
  targets: [
    "https://notes.example-sub.workers.dev",
    "notes.szolotov.com (custom domain) [previews: enabled]",
  ],
  worker_name_overridden: false,
  timestamp: "2026-10-10T10:00:01.000Z",
}
const preview = {
  type: "preview",
  version: 1,
  worker_name: "notes",
  preview_id: "p1",
  preview_name: "stage",
  preview_slug: "stage",
  preview_urls: ["https://stage-notes.example-sub.workers.dev", "https://stage.notes.szolotov.com"],
  deployment_id: "d1",
  deployment_urls: ["https://0a1b2c3d-notes.example-sub.workers.dev"],
  timestamp: "2026-10-10T10:00:02.000Z",
}
const ndjson = (...entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n"

test("deploy: workers.dev URL, custom domain and version id", () => {
  assert.deepEqual(readDeploy(parseEntries(ndjson(session, deploy))), {
    workers_dev_url: "https://notes.example-sub.workers.dev",
    custom_domain: "yes",
    version_id: "5f0a3b7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
  })
})

test("deploy: custom_domain=no when Wrangler did not report it", () => {
  const entry = { ...deploy, targets: ["https://notes.example-sub.workers.dev"] }
  assert.equal(readDeploy([entry]).custom_domain, "no")
})

test("deploy: a disabled or plain route is not the custom domain", () => {
  const targets = (...t) => [
    { ...deploy, targets: ["https://notes.example-sub.workers.dev", ...t] },
  ]
  assert.equal(
    readDeploy(
      targets("notes.szolotov.com (custom domain) [production: disabled, previews: enabled]"),
    ).custom_domain,
    "no",
  )
  assert.equal(readDeploy(targets("notes.szolotov.com")).custom_domain, "no")
})

test("deploy: a missing deploy entry or version id is an error", () => {
  assert.throws(() => readDeploy([session]), /no "deploy" entry/)
  assert.throws(() => readDeploy([{ ...deploy, version_id: undefined }]), /version_id/)
})

test("preview: workers.dev and stage URLs", () => {
  assert.deepEqual(readPreview([session, preview]), {
    workers_dev_url: "https://stage-notes.example-sub.workers.dev",
    stage_url: "https://stage.notes.szolotov.com",
    custom_url: "https://stage.notes.szolotov.com",
  })
})

test("preview: custom_url is the Preview's own subdomain for any Preview name", () => {
  const entry = {
    ...preview,
    preview_urls: ["https://dev-notes.example-sub.workers.dev", "https://dev.notes.szolotov.com"],
  }
  assert.deepEqual(readPreview([entry]), {
    workers_dev_url: "https://dev-notes.example-sub.workers.dev",
    stage_url: "",
    custom_url: "https://dev.notes.szolotov.com",
  })
})

test("preview: stage_url is empty when the custom domain Preview is not active", () => {
  const entry = { ...preview, preview_urls: ["https://stage-notes.example-sub.workers.dev"] }
  assert.equal(readPreview([entry]).stage_url, "")
})

test("preview: no URLs at all gives empty values", () => {
  const entry = { ...preview, preview_urls: [], deployment_urls: undefined }
  assert.deepEqual(readPreview([entry]), { workers_dev_url: "", stage_url: "", custom_url: "" })
})

test("validUrl accepts only plain https URLs on allowed hosts", () => {
  assert.equal(validUrl("https://notes.szolotov.com/"), "https://notes.szolotov.com")
  assert.equal(validUrl("https://a.b.workers.dev"), "https://a.b.workers.dev")
  for (const bad of [
    "http://a.b.workers.dev",
    "https://user@a.b.workers.dev",
    "https://a.b.workers.dev:8443",
    "https://a.b.workers.dev/path",
    "https://a.b.workers.dev/?q=1",
    "https://a.b.workers.dev/#x",
    "https://evil.example.com",
    "https://notes.szolotov.com.evil.example",
    "https://workers.dev.evil.example",
    "not a url",
    42,
  ]) {
    assert.equal(validUrl(bad), null, String(bad))
  }
})

test("invalid lines fail with the line number", () => {
  assert.throws(() => parseEntries('{"type":"deploy"}\n{oops\n', "out.json"), /out\.json, line 2/)
  assert.throws(() => parseEntries("[1]\n"), /expected a JSON object/)
  assert.deepEqual(parseEntries("\n\n"), [])
})

test("main prints key=value lines and rejects bad usage or missing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "wrangler-output-"))
  const file = join(dir, "out.json")
  writeFileSync(file, ndjson(session, preview))
  assert.equal(
    main(["--preview", file]),
    "workers_dev_url=https://stage-notes.example-sub.workers.dev\nstage_url=https://stage.notes.szolotov.com\ncustom_url=https://stage.notes.szolotov.com",
  )
  assert.throws(() => main(["--preview", join(dir, "missing.json")]), /cannot read/)
  assert.throws(() => main(["--other", file]), /usage/)
})
