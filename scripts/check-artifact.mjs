#!/usr/bin/env node
/**
 * Checks the build output before it is deployed. Used by ci.yml (after the build) and by the
 * upload and deploy jobs of deploy-dev.yml and deploy-production.yml, which receive the
 * output as an artifact from a job that ran third-party plugin code.
 *
 *   node scripts/check-artifact.mjs --root <dir>    an extracted artifact: <dir> holds exactly
 *                                                   `public/` (a `worker/` directory is a
 *                                                   failure: the deploy jobs regenerate
 *                                                   worker/csp.generated.js themselves), and
 *                                                   `public/` passes the check below
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
 * Problems found in an extracted artifact: only `public/`. Worker code never comes from the
 * artifact, so `worker/` (e.g. a csp.generated.js) is rejected like any other extra path.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function checkLayout(root) {
  const problems = []
  try {
    if (!lstatSync(join(root, "public")).isDirectory()) throw new Error("not a directory")
  } catch {
    return [`${root}/public is not a directory`]
  }
  for (const { path, type } of walk(root)) {
    if (path.startsWith("public/") || (type === "dir" && path === "public")) continue
    problems.push(
      path === "worker" || path.startsWith("worker/")
        ? `${root}/${path}: worker code is not accepted from the build artifact`
        : `${root}/${path}: unexpected file in the build artifact`,
    )
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
