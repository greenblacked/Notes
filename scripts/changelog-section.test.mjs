import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { section } from "./changelog-section.mjs"

const script = join(dirname(fileURLToPath(import.meta.url)), "changelog-section.mjs")
const dir = mkdtempSync(join(tmpdir(), "changelog-section-"))
after(() => rmSync(dir, { recursive: true, force: true }))

const log = `# Changelog

## [Unreleased]

### Added

- next thing

## [1.2.0] - 2026-10-18

### Added

- new thing

### Fixed

- a fix

## [1.1.0] - 2026-10-01

- old thing
`

test("finds a section mid-file without bleeding into the next one", () => {
  const out = section(log, "1.2.0")
  assert.equal(out, "### Added\n\n- new thing\n\n### Fixed\n\n- a fix\n")
})

test("finds a section at the end of the file", () => {
  assert.equal(section(log, "1.1.0"), "- old thing\n")
})

test("a missing version fails", () => {
  assert.throws(() => section(log, "9.9.9"), /no section/)
})

test("a duplicate heading fails", () => {
  assert.throws(() => section(`${log}\n## [1.1.0] - 2026-10-02\n\n- again\n`, "1.1.0"), /duplicate/)
})

test("a section with only ### headings is empty", () => {
  assert.throws(() => section("## [1.0.0] - 2026-10-01\n\n### Added\n\n", "1.0.0"), /empty/)
})

test("a heading without a date is not found", () => {
  assert.throws(() => section("## [1.0.0]\n\n- x\n", "1.0.0"), /no section/)
})

test("a malformed version fails", () => {
  assert.throws(() => section(log, "01.2.3"), /X\.Y\.Z/)
  assert.throws(() => section(log, "v1.2.3"), /X\.Y\.Z/)
})

test("the CLI exits 0, 1 and 2", () => {
  const file = join(dir, "CHANGELOG.md")
  writeFileSync(file, log)
  const ok = spawnSync("node", [script, "1.2.0", file], { encoding: "utf8" })
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, /- new thing/)
  assert.equal(spawnSync("node", [script, "9.9.9", file], { encoding: "utf8" }).status, 1)
  assert.equal(spawnSync("node", [script], { encoding: "utf8" }).status, 2)
})
