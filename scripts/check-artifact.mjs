#!/usr/bin/env node
/**
 * Checks the build output before it is deployed. Used by ci.yml (after the build) and by the
 * upload and deploy jobs of deploy-stage.yml and deploy-production.yml, which receive the
 * output as an artifact from a job that ran third-party plugin code.
 *
 *   node scripts/check-artifact.mjs --root <dir>    an extracted artifact: <dir> holds exactly
 *                                                   `public/` and `worker/csp.generated.js`,
 *                                                   and `public/` passes the check below
 *   node scripts/check-artifact.mjs --public <dir>  only the `public/` check (CI, after build)
 *
 * `public/` may contain only regular files with an extension from ALLOWED_EXTENSIONS (the set
 * `npm run build` produces today; add one here deliberately when the site needs it), and no
 * `_redirects` or `_headers` file at any depth: Cloudflare would apply them to the site, and
 * routing and headers are decided by the Worker (worker/index.js) alone. Symlinks and other
 * special files are rejected too.
 *
 * Prints one `::error::` line per problem and exits 1; exits 0 when everything is fine.
 * No dependencies.
 */
import { lstatSync, readdirSync } from "node:fs"
import { extname, join } from "node:path"
import { pathToFileURL } from "node:url"

export const ALLOWED_EXTENSIONS = new Set([
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

const FORBIDDEN_NAMES = new Set(["_redirects", "_headers"])

/**
 * All entries below `dir` as paths relative to it ("/"-separated), with their type.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {{ path: string, type: "file" | "dir" | "other" }[]}
 */
function walk(dir, prefix = "") {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) {
      found.push({ path, type: "dir" })
      found.push(...walk(join(dir, entry.name), `${path}/`))
    } else {
      // A symlink is "other" even when it points at a file.
      found.push({ path, type: entry.isFile() ? "file" : "other" })
    }
  }
  return found
}

/**
 * Problems found in a `public/` directory (empty when it is fine).
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function checkPublic(dir) {
  const problems = []
  let files = 0
  for (const { path, type } of walk(dir)) {
    if (type === "dir") continue
    const name = path.slice(path.lastIndexOf("/") + 1)
    if (FORBIDDEN_NAMES.has(name.toLowerCase())) {
      problems.push(
        `${dir}/${path}: ${name} is not allowed (Cloudflare would apply it to the site)`,
      )
    } else if (type === "other") {
      problems.push(`${dir}/${path}: not a regular file (symlink or special file)`)
    } else if (!ALLOWED_EXTENSIONS.has(extname(name))) {
      problems.push(`${dir}/${path}: file extension "${extname(name)}" is not in the allowlist`)
    }
    files++
  }
  if (files === 0) problems.push(`${dir}: no files`)
  return problems
}

/**
 * Problems found in an extracted artifact: only `public/` and `worker/csp.generated.js`.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function checkLayout(root) {
  const problems = []
  const kind = (path) => {
    try {
      const stat = lstatSync(path)
      return stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other"
    } catch {
      return "missing"
    }
  }
  if (kind(join(root, "public")) !== "dir") problems.push(`${root}/public is not a directory`)
  if (kind(join(root, "worker", "csp.generated.js")) !== "file") {
    problems.push(`${root}/worker/csp.generated.js is not a regular file`)
  }
  if (problems.length > 0) return problems
  for (const { path, type } of walk(root)) {
    if (type === "dir" || path.startsWith("public/") || path === "worker/csp.generated.js") continue
    problems.push(`${root}/${path}: unexpected file in the build artifact`)
  }
  return [...problems, ...checkPublic(join(root, "public"))]
}

/** @param {string[]} argv @returns {string[]} */
export function run(argv) {
  const [flag, dir, ...rest] = argv
  if ((flag !== "--root" && flag !== "--public") || !dir || rest.length > 0) {
    throw new Error("usage: check-artifact.mjs --root <artifact dir> | --public <public dir>")
  }
  return flag === "--root" ? checkLayout(dir) : checkPublic(dir)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let problems
  try {
    problems = run(process.argv.slice(2))
  } catch (error) {
    console.error(`check-artifact: ${error.message}`)
    process.exit(2)
  }
  for (const problem of problems) console.error(`::error::${problem}`)
  if (problems.length > 0) {
    console.error(`check-artifact: ${problems.length} problem(s)`)
    process.exit(1)
  }
  console.log("check-artifact: ok")
}
