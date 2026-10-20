#!/usr/bin/env node
/**
 * Confirms through the Cloudflare API that the stage Preview's latest deployment is the one a
 * Deploy stage run just uploaded.
 *
 *   node scripts/verify-preview-deployment.mjs --worker notes --preview stage \
 *     --deployment <id> --tag <40-hex commit sha> --message <text>
 *
 * Prints, on success (GITHUB_OUTPUT format):
 *     active=true
 *     active_deployment_id=<id>
 * and exits 1 with `error: <reason>` otherwise.
 *
 * If our deployment is not the latest after the whole attempt budget, or any check fails, it exits
 * 1 with `error: <reason>`. A different deployment id is never treated as newer than ours: the API
 * gives no ordering evidence, so the caller takes stage down (fail closed). Right after the upload
 * creates or recreates the Preview, the read side may briefly answer 10025 / 10222 (or show our
 * deployment without annotations); those are retried within the same attempt budget.
 *
 * "Active" means the Preview's `latest` deployment. A Preview has no gradual rollout: its URLs
 * serve the latest deployment. The check therefore requires `latest.id` to equal the deployment id
 * Wrangler reported for this upload, and the annotations the upload set (`workers/tag` = the
 * commit sha from `--tag`, `workers/message` from `--message`) to match. On GitHub Actions
 * Wrangler also sets `workers/commit_sha` = GITHUB_SHA; when present it must equal the tag, and
 * its absence is not an error. No status field is relied on.
 *
 * Endpoint (Wrangler 4.149.0 reads it itself, in assemblePreviewDeploymentSettings, during every
 * upload to an existing Preview, with the same token):
 *     GET /accounts/{account}/workers/workers/{worker}/previews/{preview}/deployments/latest
 * The answer is the usual { success, errors, result } envelope. API error 10025 means the Preview
 * was not found, 10222 that it has no deployment. The response shape is not documented here from
 * a live answer; on a mismatch the error lists the keys received.
 *
 * Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment. Error messages never
 * contain the token, the account id or the full URL.
 *
 * Node built-ins only (it runs next to the token) and the built-in fetch.
 */
import { pathToFileURL } from "node:url"

export const API = "https://api.cloudflare.com/client/v4"

const USAGE =
  "usage: verify-preview-deployment.mjs --worker <name> --preview <name> --deployment <id> --tag <sha> --message <text>"

/** @param {string} message */
function fail(message) {
  throw new Error(message)
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

/** An id mismatch can be read-after-write lag, so it is retried. */
class MismatchError extends Error {}

/**
 * Read-after-write lag that is not an id mismatch: the Preview was just created or recreated and
 * the read side still answers "not found" (10025) or "no deployment" (10222), or still shows our
 * deployment without its annotations. Retried against the same attempt budget as a mismatch; if it
 * persists it is an ordinary failure.
 */
class PendingError extends Error {}

/** @param {unknown} body */
const hasMissingPreviewCode = (body) =>
  isObject(body) &&
  Array.isArray(body.errors) &&
  body.errors.some((e) => isObject(e) && (e.code === 10025 || e.code === 10222))

const FLAGS = {
  "--worker": ["worker", (v) => /^[a-z0-9-]{1,63}$/.test(v)],
  "--preview": ["preview", (v) => /^[a-z0-9-]{1,63}$/.test(v)],
  "--deployment": ["deployment", (v) => /^[A-Za-z0-9-]{1,64}$/.test(v)],
  "--tag": ["tag", (v) => /^[0-9a-f]{40}$/.test(v)],
  "--message": ["message", (v) => v.length >= 1 && v.length <= 100],
}
/**
 * @param {string[]} argv
 * @returns {{ worker: string, preview: string, deployment: string, tag: string, message: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    const spec = FLAGS[flag]
    if (!spec || value === undefined) fail(USAGE)
    const [key, valid] = spec
    if (key in out || !valid(value)) fail(`${USAGE} (bad or repeated ${flag})`)
    out[key] = value
  }
  for (const [flag, [key]] of Object.entries(FLAGS)) {
    if (!(key in out)) fail(`${USAGE} (missing ${flag})`)
  }
  return /** @type {any} */ (out)
}

/**
 * @param {string} accountId
 * @param {string} worker
 * @param {string} preview
 */
export function deploymentPath(accountId, worker, preview) {
  if (!/^[0-9a-f]{32}$/.test(accountId)) {
    fail("CLOUDFLARE_ACCOUNT_ID is not a 32-character hex id")
  }
  return `/accounts/${accountId}/workers/workers/${worker}/previews/${encodeURIComponent(preview)}/deployments/latest`
}

/** @param {unknown} body @param {string} preview */
function describeErrors(body, preview) {
  const errors = isObject(body) && Array.isArray(body.errors) ? body.errors : []
  const parts = errors
    .filter(isObject)
    .map((e) => `${e.code ?? "?"}: ${String(e.message ?? "").slice(0, 200)}`)
  let text = parts.length > 0 ? parts.join("; ") : "no error details"
  if (errors.some((e) => isObject(e) && e.code === 10025)) {
    text += ` (the Preview "${preview}" does not exist)`
  }
  if (errors.some((e) => isObject(e) && e.code === 10222)) {
    text += " (the Preview has no deployment)"
  }
  return text
}

/**
 * @param {unknown} body
 * @param {{ deployment: string, tag: string, message: string, preview?: string }} expected
 * @returns {{ id: string }}
 */
export function checkDeployment(body, expected) {
  if (!isObject(body) || body.success !== true) {
    const text = `the API answered without success: ${describeErrors(body, expected.preview ?? "stage")}`
    if (hasMissingPreviewCode(body)) throw new PendingError(text)
    fail(text)
  }
  const result = body.result
  if (!isObject(result)) fail("the API answer has no result object")
  if (result.id !== expected.deployment) {
    throw new MismatchError(
      `the latest stage deployment is ${String(result.id)}, not the one this run uploaded (${expected.deployment})`,
    )
  }
  const annotations = result.annotations
  if (!isObject(annotations)) {
    // Our own deployment is already visible but its annotations are not: replica lag. Any other
    // type (array, string) is a shape change and stays a hard failure.
    const Failure = annotations === undefined || annotations === null ? PendingError : Error
    throw new Failure(
      `the latest deployment has no annotations object (result keys: ${Object.keys(result).sort().join(", ")})`,
    )
  }
  const keys = Object.keys(annotations).sort().join(", ")
  if (annotations["workers/tag"] !== expected.tag) {
    fail(
      `annotation workers/tag is ${JSON.stringify(annotations["workers/tag"])}, expected ${JSON.stringify(expected.tag)} (annotation keys: ${keys})`,
    )
  }
  if (annotations["workers/message"] !== expected.message) {
    fail(
      `annotation workers/message is ${JSON.stringify(annotations["workers/message"])}, expected ${JSON.stringify(expected.message)} (annotation keys: ${keys})`,
    )
  }
  const sha = annotations["workers/commit_sha"]
  if (sha !== undefined && sha !== expected.tag) {
    fail(
      `annotation workers/commit_sha is ${JSON.stringify(sha)}, expected ${JSON.stringify(expected.tag)}`,
    )
  }
  return { id: result.id }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Total requests main() ever makes, and the pause between them. */
export const MAX_ATTEMPTS = 5
export const RETRY_DELAY_MS = 3000
/** Per-request timeout. Worst case: MAX_ATTEMPTS * 30 s + (MAX_ATTEMPTS - 1) * 3 s = 162 s. */
export const REQUEST_TIMEOUT_MS = 30000

/** A network error, HTTP 429 or 5xx: worth another attempt from the caller's loop. */
class TransientError extends Error {}

/**
 * ONE request for the latest deployment, with no retry of its own. Network errors, HTTP 429 and
 * 5xx throw a TransientError, and API codes 10025 / 10222 a PendingError (main() counts both
 * against the same attempt budget as a stale answer); any other failure throws at once.
 *
 * @param {{ token: string, accountId: string, worker: string, preview: string,
 *   fetchImpl?: typeof fetch }} options
 * @returns {Promise<unknown>} the parsed body
 */
export async function fetchLatest({ token, accountId, worker, preview, fetchImpl = fetch }) {
  const path = deploymentPath(accountId, worker, preview)
  const shown = `/accounts/<account>/workers/workers/${worker}/previews/${preview}/deployments/latest`
  let response
  try {
    response = await fetchImpl(API + path, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new TransientError(
      `GET ${shown} failed: ${error instanceof Error ? error.name : "network error"}`,
    )
  }
  if (response.status === 429 || response.status >= 500) {
    throw new TransientError(`GET ${shown} answered HTTP ${response.status}`)
  }
  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (response.status < 200 || response.status > 299) {
    const details = isObject(body) ? `: ${describeErrors(body, preview)}` : ""
    const text = `GET ${shown} answered HTTP ${response.status}${details}`
    // main() retries a missing-preview answer.
    if (hasMissingPreviewCode(body)) throw new PendingError(text)
    fail(text)
  }
  if (body === undefined) fail(`GET ${shown} answered with a body that is not JSON`)
  return body
}

/**
 * One bounded loop: at most `attempts` requests in total (default MAX_ATTEMPTS), one per
 * iteration, with `delayMs` between them. Transient errors, a stale deployment id, a
 * missing-preview answer (10025 / 10222) and missing annotations on our own deployment all count
 * against that single budget; any other failure throws at once.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ fetchImpl?: typeof fetch, attempts?: number, delayMs?: number,
 *   sleep?: (ms: number) => Promise<void> }} [deps]
 */
export async function main(argv, env, deps = {}) {
  const args = parseArgs(argv)
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) fail("CLOUDFLARE_API_TOKEN is not set")
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? ""
  const attempts = deps.attempts ?? MAX_ATTEMPTS
  const delayMs = deps.delayMs ?? RETRY_DELAY_MS
  const sleep = deps.sleep ?? defaultSleep
  let last = "no attempt was made"
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delayMs)
    try {
      const body = await fetchLatest({
        token,
        accountId,
        worker: args.worker,
        preview: args.preview,
        fetchImpl: deps.fetchImpl,
      })
      const { id } = checkDeployment(body, args)
      return `active=true\nactive_deployment_id=${id}`
    } catch (error) {
      if (!(
        error instanceof MismatchError ||
        error instanceof TransientError ||
        error instanceof PendingError
      )) {
        throw error
      }
      last = error.message
    }
  }
  return fail(`${last} (after ${attempts} attempts)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await main(process.argv.slice(2), process.env))
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
