import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"
import { checkPlugins } from "./check-plugins.mjs"

function fixture(
  t,
  { code = "export const Widget = () => null", manifest = {}, enabled = true } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "notes-plugin-check-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, ".quartz/plugins/example")
  mkdirSync(join(dir, "dist"), { recursive: true })
  const pkg = {
    name: "fixture-plugin",
    type: "module",
    main: "./dist/index.js",
    exports: { ".": { import: "./dist/index.js" } },
    quartz: { name: "example", ...manifest },
    scripts: Object.fromEntries(
      ["install", "postinstall", "prepare", "build"].map((name) => [
        name,
        "node -e \"require('fs').writeFileSync('lifecycle-ran', 'yes')\"",
      ]),
    ),
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg))
  writeFileSync(join(dir, "dist/index.js"), code)
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  git("init", "--quiet")
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "fixture",
  )
  const pin = git("rev-parse", "HEAD")
  writeFileSync(
    join(root, "quartz.config.yaml"),
    `plugins:\n  - source: github:fixture/example\n    enabled: ${enabled}\n`,
  )
  const lock = { plugins: { example: { source: "github:fixture/example", commit: pin } } }
  writeFileSync(join(root, "quartz.lock.json"), JSON.stringify(lock))
  return { root, dir, pkg, lock }
}

function savePackage(f) {
  writeFileSync(join(f.dir, "package.json"), JSON.stringify(f.pkg))
}

function failure(f, pattern) {
  const result = checkPlugins(f.root)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], pattern)
  assert.equal(result.checked, 0)
}

test("healthy pinned package imports without invoking any lifecycle scripts", (t) => {
  const f = fixture(t)
  assert.deepEqual(checkPlugins(f.root), { checked: 1, errors: [] })
  assert.equal(existsSync(join(f.dir, "lifecycle-ran")), false)
})

test("an existing incomplete directory cannot borrow the parent repository HEAD", (t) => {
  const f = fixture(t)
  rmSync(join(f.dir, ".git"), { recursive: true })
  execFileSync("git", ["init", "--quiet", f.root])
  execFileSync("git", [
    "-C",
    f.root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "parent",
  ])
  failure(f, /incomplete cache: plugin Git HEAD unavailable/)
})

test("wrong cached revision fails before import", (t) => {
  const f = fixture(t)
  f.lock.plugins.example.commit = "0".repeat(40)
  writeFileSync(join(f.root, "quartz.lock.json"), JSON.stringify(f.lock))
  failure(f, /pinned revision mismatch/)
})

test("missing package metadata and missing declared build files fail", (t) => {
  const f = fixture(t)
  rmSync(join(f.dir, "package.json"))
  failure(f, /package.json missing/)
  savePackage(f)
  rmSync(join(f.dir, "dist/index.js"))
  failure(f, /missing built file .*dist\/index.js/)
})

test("existing entrypoint with missing transitive runtime dist fails the import probe", (t) => {
  const f = fixture(t, { code: 'import "missing-runtime"; export const Plugin = () => null' })
  const dep = join(f.dir, "node_modules/missing-runtime")
  mkdirSync(dep, { recursive: true })
  writeFileSync(
    join(dep, "package.json"),
    JSON.stringify({ type: "module", exports: "./dist/index.js" }),
  )
  failure(f, /runtime import\/export check failed[\s\S]*missing-runtime[\s\S]*dist\/index.js/)
})

test("manifest component export must actually be available", (t) => {
  const f = fixture(t, { manifest: { components: { MissingWidget: {} } } })
  f.pkg.exports["./components"] = "./dist/index.js"
  savePackage(f)
  failure(f, /Declared export MissingWidget missing/)
})

test("manifest frame export must provide a name and render function", (t) => {
  const f = fixture(t, { code: "export const Frame = {}", manifest: { frames: { Frame: {} } } })
  f.pkg.exports["./frames"] = { import: "./dist/index.js" }
  savePackage(f)
  failure(f, /Declared frame Frame lacks name\/render/)
})

test("healthy declared components and frames pass", (t) => {
  const f = fixture(t, {
    code: 'export const Widget = () => null; export const Frame = {name:"fixture", render(){}}',
    manifest: { components: { Widget: {} }, frames: { Frame: {} } },
  })
  f.pkg.exports["./components"] = "./dist/index.js"
  f.pkg.exports["./frames"] = "./dist/index.js"
  savePackage(f)
  assert.deepEqual(checkPlugins(f.root), { checked: 1, errors: [] })
})

test("disabled remote plugins are ignored even with no cached package", (t) => {
  const f = fixture(t, { enabled: false })
  rmSync(f.dir, { recursive: true })
  assert.deepEqual(checkPlugins(f.root), { checked: 0, errors: [] })
})

test("enabled remote source absent from lock fails", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, "quartz.lock.json"), '{"plugins":{}}')
  failure(f, /exactly one matching lock entry/)
})

test("local TypeScript plugins need an existing source directory, not a remote lock entry", (t) => {
  const f = fixture(t)
  writeFileSync(
    join(f.root, "quartz.config.yaml"),
    "plugins:\n  - source: ./local-plugin\n    enabled: true\n",
  )
  failure(f, /local-plugin/)
  mkdirSync(join(f.root, "local-plugin"))
  assert.deepEqual(checkPlugins(f.root), { checked: 0, errors: [] })
})

test("runtime import is bounded by a timeout", (t) => {
  const f = fixture(t, { code: "setInterval(() => {}, 1000); await new Promise(() => {})" })
  const result = checkPlugins(f.root, { timeout: 100 })
  assert.match(result.errors[0], /runtime import\/export check failed.*ETIMEDOUT/)
})

test("silent runtime exit still reports its exit status", (t) => {
  const f = fixture(t, { code: "process.exit(7)" })
  failure(f, /runtime import\/export check failed[\s\S]*exit 7, signal none/)
})

test("early successful process exit cannot bypass component checks", (t) => {
  const f = fixture(t, { code: "process.exit(0)", manifest: { components: { MissingWidget: {} } } })
  f.pkg.exports["./components"] = "./dist/index.js"
  savePackage(f)
  failure(f, /exit 0, signal none; import probe did not complete/)
})

test("legal filenames beginning with two dots stay within the package", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.dir, "..entry.js"), "export const Plugin = () => null")
  f.pkg.exports["."] = "./..entry.js"
  savePackage(f)
  assert.deepEqual(checkPlugins(f.root), { checked: 1, errors: [] })
})

test("build, check and dev enforce preflight after restore and before processing", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  for (const name of ["build", "check", "dev"]) {
    assert.match(pkg.scripts[name], /plugin restore && npm run check:plugins && /, name)
  }
  assert.equal(pkg.scripts["check:plugins"], "node scripts/check-plugins.mjs")
})
