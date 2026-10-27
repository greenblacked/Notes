#!/usr/bin/env node
// Fail closed before Quartz can silently skip an enabled remote plugin.
// Reads pinned package metadata and imports built JavaScript; never installs or builds packages.
import { readFileSync, statSync } from "node:fs"
import { join, resolve, relative, isAbsolute, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { parse } from "yaml"

const completionMarker = "\ncheck-plugins:imports-complete\n"
const importProbe = `
const entries = JSON.parse(process.argv[1]);
for (const {url, names, frames} of entries) {
  const mod = await import(url);
  for (const name of names) {
    if (!mod[name]) throw new Error('Declared export ' + name + ' missing from ' + url);
    if (frames && (!mod[name].name || typeof mod[name].render !== 'function'))
      throw new Error('Declared frame ' + name + ' lacks name/render in ' + url);
  }
}
process.stdout.write(${JSON.stringify(completionMarker)});
`

function file(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function targetPath(dir, target) {
  if (typeof target !== "string" || target.includes("*")) {
    throw new Error(`unsupported export target ${JSON.stringify(target)}; use explicit built files`)
  }
  const path = resolve(dir, target)
  const rel = relative(dir, path)
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`export escapes package: ${target}`)
  if (!file(path)) throw new Error(`incomplete cache: missing built file ${target}`)
  return path
}

// Validate every declared target, including type declarations and conditional alternatives.
function checkExportTargets(dir, value) {
  if (value === null) return
  if (typeof value === "string") {
    targetPath(dir, value)
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) checkExportTargets(dir, child)
  } else {
    throw new Error(`invalid exports declaration: ${JSON.stringify(value)}`)
  }
}

function runtimeTarget(entry) {
  // Quartz's git loader reads strings or the direct import condition.
  return typeof entry === "string" ? entry : entry?.import
}

function inspectPackage(dir, { timeout }) {
  const pkgPath = join(dir, "package.json")
  if (!file(pkgPath)) throw new Error("incomplete cache: package.json missing")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  if (!pkg.quartz || typeof pkg.quartz !== "object") throw new Error("missing quartz manifest")
  if (pkg.exports !== undefined) checkExportTargets(dir, pkg.exports)
  for (const field of ["main", "module", "types"]) {
    if (pkg[field]) targetPath(dir, pkg[field])
  }
  const rootExport = typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."]
  const main = runtimeTarget(rootExport) ?? pkg.module ?? pkg.main
  if (!main) throw new Error("no explicit built JavaScript entrypoint in exports/module/main")
  const entries = [{ url: pathToFileURL(targetPath(dir, main)).href, names: [] }]
  for (const kind of ["components", "frames"]) {
    const names = Object.keys(pkg.quartz[kind] ?? {})
    if (!names.length) continue
    const target = runtimeTarget(pkg.exports?.[`./${kind}`])
    if (!target)
      throw new Error(`manifest declares ${kind} but exports ./${kind} has no import target`)
    entries.push({
      url: pathToFileURL(targetPath(dir, target)).href,
      names,
      frames: kind === "frames",
    })
  }
  // Fresh process per package prevents cross-package singleton state from masking import failures.
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", importProbe, JSON.stringify(entries)],
    {
      cwd: dir,
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
    },
  )
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""
  if (result.error || result.status !== 0 || !stdout.endsWith(completionMarker)) {
    const detail = [
      result.error?.message,
      stderr.trim(),
      `exit ${result.status}, signal ${result.signal ?? "none"}`,
      !stdout.endsWith(completionMarker) ? "import probe did not complete" : undefined,
    ]
      .filter(Boolean)
      .join("; ")
    throw new Error(
      `runtime import/export check failed (missing runtime dist/dependency or invalid export): ${detail}`,
    )
  }
}

export function checkPlugins(root = process.cwd(), { timeout = 15000 } = {}) {
  const config = parse(readFileSync(join(root, "quartz.config.yaml"), "utf8"))
  const lock = JSON.parse(readFileSync(join(root, "quartz.lock.json"), "utf8"))
  if (!Array.isArray(config.plugins) || !lock.plugins)
    throw new Error("invalid plugin config/lock structure")
  const errors = []
  let checked = 0
  for (const entry of config.plugins) {
    if (entry.enabled === false) continue
    const source = entry.source
    try {
      if (typeof source !== "string") throw new Error("source must be a string")
      if (/^(\.\.?\/|\/|[A-Za-z]:[\\/])/.test(source)) {
        if (!statSync(resolve(root, source)).isDirectory())
          throw new Error("local source is not a directory")
        continue // Local TypeScript is compiled by Quartz, not imported as remote JavaScript.
      }
      const matches = Object.entries(lock.plugins).filter(([, pin]) => pin.source === source)
      if (matches.length !== 1)
        throw new Error("enabled remote source needs exactly one matching lock entry")
      const [name, pin] = matches[0]
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || !/^[a-f0-9]{40}$/i.test(pin.commit ?? "")) {
        throw new Error("invalid lock name or full commit pin")
      }
      const dir = join(root, ".quartz", "plugins", name)
      // Explicit git-dir: an incomplete directory must not resolve the enclosing site's HEAD.
      const head = spawnSync(
        "git",
        ["--git-dir", join(dir, ".git"), "rev-parse", "--verify", "HEAD"],
        {
          encoding: "utf8",
          timeout,
        },
      )
      if (head.error || head.status !== 0)
        throw new Error("incomplete cache: plugin Git HEAD unavailable")
      if (head.stdout.trim().toLowerCase() !== pin.commit.toLowerCase()) {
        throw new Error(
          `pinned revision mismatch: expected ${pin.commit}, found ${head.stdout.trim()}`,
        )
      }
      inspectPackage(dir, { timeout })
      checked++
    } catch (error) {
      errors.push(`${source}: ${error.message}`)
    }
  }
  return { checked, errors }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { checked, errors } = checkPlugins()
    if (errors.length) {
      for (const error of errors) console.error(`check-plugins: ${error}`)
      console.error(
        "check-plugins: stop before processing content. Inspect the affected cache and restore/rebuild the pinned plugin in a clean workspace; restore alone may skip existing incomplete directories. Plugin repair is a separate step; this check runs no lifecycle scripts.",
      )
      process.exitCode = 1
    } else {
      console.log(
        `check-plugins: ${checked} enabled remote plugins passed; local source paths checked`,
      )
    }
  } catch (error) {
    console.error(`check-plugins: ${error.message}`)
    process.exitCode = 1
  }
}
