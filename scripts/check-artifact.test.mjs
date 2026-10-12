import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { ALLOWED_EXTENSIONS, checkLayout, checkPublic } from "./check-artifact.mjs"

const script = join(dirname(fileURLToPath(import.meta.url)), "check-artifact.mjs")
const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A temp directory holding the given files (paths relative to it, content "x"). */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "check-artifact-"))
  dirs.push(root)
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), "x")
  }
  return root
}

const good = ["index.html", "index.css", "static/a.mjs", "static/a.mjs.map", "static/f.woff2"]

test("the allowlist is the extensions of a real build", () => {
  assert.deepEqual([...ALLOWED_EXTENSIONS].sort(), [
    ".css",
    ".html",
    ".ico",
    ".js",
    ".json",
    ".map",
    ".mjs",
    ".png",
    ".txt",
    ".woff2",
    ".xml",
  ])
})

test("public: allowed files pass", () => {
  assert.deepEqual(checkPublic(tree(good)), [])
})

test("public: _redirects and _headers are rejected at any depth, in any case", () => {
  for (const name of ["_redirects", "_headers", "docs/_headers", "_REDIRECTS"]) {
    const problems = checkPublic(tree([...good, name]))
    assert.equal(problems.length, 1, name)
    assert.match(problems[0], /is not allowed/)
  }
})

test("public: extensions outside the allowlist are rejected", () => {
  for (const name of ["a.php", "a.exe", "a.svg", "a.HTML", "a.html.bak", "run", ".assetsignore"]) {
    const problems = checkPublic(tree([...good, name]))
    assert.equal(problems.length, 1, name)
    assert.match(problems[0], /not in the allowlist/)
  }
})

test("public: symlinks are rejected, even to an allowed file", () => {
  const root = tree(good)
  symlinkSync(join(root, "index.html"), join(root, "link.html"))
  const problems = checkPublic(root)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /not a regular file/)
})

test("public: an empty directory is rejected", () => {
  assert.deepEqual(checkPublic(tree([])).length, 1)
})

const layout = ["public/index.html"]

test("layout: only public passes", () => {
  assert.deepEqual(checkLayout(tree(layout)), [])
})

test("layout: a missing or non-directory public is rejected", () => {
  assert.equal(checkLayout(tree([])).length, 1)
  assert.equal(checkLayout(tree(["public"])).length, 1)
})

test("layout: a worker directory is rejected, csp.generated.js included", () => {
  for (const extra of ["worker/csp.generated.js", "worker/index.js"]) {
    const problems = checkLayout(tree([...layout, extra]))
    assert.ok(problems.length >= 1, extra)
    assert.ok(
      problems.every((p) => /worker code is not accepted/.test(p)),
      extra,
    )
  }
})

test("layout: extra files at the root are rejected", () => {
  for (const extra of ["package.json", "evil/x.js"]) {
    const problems = checkLayout(tree([...layout, extra]))
    assert.ok(
      problems.some((p) => /unexpected file/.test(p)),
      extra,
    )
  }
})

test("layout: public is checked too", () => {
  const problems = checkLayout(tree([...layout, "public/_headers", "public/a.sh"]))
  assert.equal(problems.length, 2)
})

test("cli: exit codes and ::error:: lines", () => {
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
  assert.equal(run("--public", join(tree(good), ".")).status, 0)
  const bad = run("--public", tree([...good, "_headers"]))
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /::error::.*_headers/)
  assert.equal(run("--root", tree(layout)).status, 0)
  assert.equal(run().status, 2)
  assert.equal(run("--public").status, 2)
})
