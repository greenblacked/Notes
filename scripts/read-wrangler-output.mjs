#!/usr/bin/env node
/**
 * Reads the NDJSON file Wrangler appends to when WRANGLER_OUTPUT_FILE_PATH is set and prints
 * the facts the deploy workflows need, as `key=value` lines (GITHUB_OUTPUT format).
 *
 *   node scripts/read-wrangler-output.mjs --deploy  <file>   wrangler deploy
 *     workers_dev_url=https://notes.<subdomain>.workers.dev
 *     custom_domain=yes|no      Wrangler reported notes.szolotov.com as a target
 *     version_id=<uuid>
 *
 *   node scripts/read-wrangler-output.mjs --preview <file>   wrangler preview
 *     workers_dev_url=<the Preview's workers.dev URL, or empty>
 *     custom_url=<the Preview's https://<name>.notes.szolotov.com URL, or empty>
 *
 * Shape of the entries (wrangler 4.149.0, node_modules/wrangler/wrangler-dist/cli.js):
 *  - one JSON object per line, each with a `timestamp` added by writeOutput() (line ~64635);
 *    Wrangler also writes other entry types (e.g. `wrangler-session`, `command-failed`), which
 *    are ignored here.
 *  - `deploy` (line ~180601): { type: "deploy", version: 1, worker_name, worker_tag, version_id,
 *    targets, ... }. `targets` are strings from the triggers step (~165144): workers.dev targets
 *    carry an `https://` prefix, a Custom Domain is rendered by renderRoute() (~163989) as
 *    `notes.szolotov.com (custom domain) [previews: enabled]` (a `production: enabled|disabled`
 *    flag is only added when the route sets `enabled`).
 *  - `preview` (line ~348787): { type: "preview", version: 1, worker_name, preview_id,
 *    preview_name, preview_slug, preview_urls, deployment_id, deployment_urls }, where the two
 *    url fields are arrays of URLs (the stable Preview URLs and the per-deployment URLs).
 *
 * URLs are validated strictly before they reach later workflow steps: https, no credentials,
 * port, query or fragment, and a path of at most "/"; the host must be on workers.dev, or be
 * notes.szolotov.com or one of its subdomains.
 *
 * No dependencies.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const CUSTOM_DOMAIN = "notes.szolotov.com"

/** @param {string} message */
function fail(message) {
  throw new Error(message)
}

/**
 * Parse NDJSON text. Blank lines are skipped; any other line must be a JSON object.
 *
 * @param {string} text
 * @param {string} [source]
 * @returns {Record<string, unknown>[]}
 */
export function parseEntries(text, source = "Wrangler output") {
  const entries = []
  const lines = text.split("\n")
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === "") continue
    let value
    try {
      value = JSON.parse(line)
    } catch {
      fail(`${source}, line ${index + 1}: not valid JSON`)
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(`${source}, line ${index + 1}: expected a JSON object`)
    }
    entries.push(value)
  }
  return entries
}

/**
 * Return a normalised origin for an allowed URL, or null.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function validUrl(value) {
  if (typeof value !== "string") return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  if (url.username || url.password || url.port) return null
  if (url.search || url.hash || url.href.includes("?") || url.href.includes("#")) return null
  if (url.pathname !== "/") return null
  const host = url.hostname
  const allowed =
    host.endsWith(".workers.dev") || host === CUSTOM_DOMAIN || host.endsWith(`.${CUSTOM_DOMAIN}`)
  return allowed ? url.origin : null
}

/** @param {Record<string, unknown>[]} entries @param {string} type */
function lastOfType(entries, type) {
  const found = entries.filter((e) => e.type === type)
  if (found.length === 0) {
    fail(`no "${type}" entry in the Wrangler output (did the command succeed?)`)
  }
  return found[found.length - 1]
}

/** @param {unknown} value @param {string} field @returns {unknown[]} */
function arrayField(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`"${field}" is not an array`)
  return value
}

/**
 * @param {Record<string, unknown>[]} entries
 * @returns {{ workers_dev_url: string, custom_domain: "yes" | "no", version_id: string }}
 */
export function readDeploy(entries) {
  const entry = lastOfType(entries, "deploy")
  const targets = arrayField(entry.targets, "targets")
  let workersDev = ""
  let customDomain = "no"
  for (const target of targets) {
    if (typeof target !== "string") fail('"targets" contains a non-string value')
    const first = target.trim().split(/\s+/)[0] ?? ""
    if (first === CUSTOM_DOMAIN) {
      if (target.includes("(custom domain") && !target.includes("production: disabled")) {
        customDomain = "yes"
      }
      continue
    }
    const url = validUrl(first)
    if (url !== null && new URL(url).hostname.endsWith(".workers.dev") && workersDev === "") {
      workersDev = url
    }
  }
  const versionId = entry.version_id
  if (typeof versionId !== "string" || !/^[0-9a-f-]{8,64}$/i.test(versionId)) {
    fail('the "deploy" entry has no valid version_id')
  }
  return { workers_dev_url: workersDev, custom_domain: customDomain, version_id: versionId }
}

/**
 * @param {Record<string, unknown>[]} entries
 * @returns {{ workers_dev_url: string, custom_url: string }}
 */
export function readPreview(entries) {
  const entry = lastOfType(entries, "preview")
  // The stable Preview URLs come first, then the per-deployment ones.
  const urls = [
    ...arrayField(entry.preview_urls, "preview_urls"),
    ...arrayField(entry.deployment_urls, "deployment_urls"),
  ]
  let workersDev = ""
  let custom = ""
  for (const raw of urls) {
    const url = validUrl(raw)
    if (url === null) continue
    const host = new URL(url).hostname
    // The first stable URL on a subdomain of the custom domain is the Preview's own address.
    if (custom === "" && host.endsWith(`.${CUSTOM_DOMAIN}`)) custom = url
    if (host.endsWith(".workers.dev") && workersDev === "") workersDev = url
  }
  return { workers_dev_url: workersDev, custom_url: custom }
}

/** @param {string[]} argv */
export function main(argv) {
  const [mode, file, ...rest] = argv
  if ((mode !== "--deploy" && mode !== "--preview") || !file || rest.length > 0) {
    fail("usage: read-wrangler-output.mjs --deploy|--preview <output-file>")
  }
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    fail(`cannot read ${file}: ${error instanceof Error ? error.message : error}`)
  }
  const entries = parseEntries(text, file)
  const result = mode === "--deploy" ? readDeploy(entries) : readPreview(entries)
  return Object.entries(result)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
