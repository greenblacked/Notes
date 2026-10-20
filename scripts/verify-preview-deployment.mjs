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
 * Superseded: when, after the whole retry budget, the last answer is still a well-formed
 * deployment id different from ours AND different from the Preview's latest deployment before this
 * run's upload (`--previous <id|none>`, read by `--read-previous` before the upload), it prints
 * `superseded=true` and `superseded_by=<id>` and exits 3, so the caller can leave the newer
 * deployment alone. An id equal to the previous one is a stale read (lag), not a newer upload: an
 * ordinary failure. Without `--previous`, with `none` (the Preview did not exist: a foreign id may
 * be a lagging replica's last deployment of a deleted Preview) or when the pre-read failed
 * (`unknown`), nothing is ever superseded. A tag or message mismatch on our own deployment, a transient or missing-preview
 * (10025 / 10222) answer on the last attempt, or a malformed answer is an ordinary failure
 * (exit 1). Right after the upload creates or recreates the Preview, the read side may briefly
 * answer 10025 / 10222 (or show our deployment without annotations); those are retried within the
 * same attempt budget.
 *
 *   node scripts/verify-preview-deployment.mjs --read-previous --worker notes --preview stage
 * prints `previous_deployment_id=<id>`, `none` (the Preview or its deployment does not exist yet)
 * or `unknown` (the read failed), and always exits 0.
 *
 *   node scripts/verify-preview-deployment.mjs --read-latest --worker notes --preview stage
 * is the same single read, printed as `latest_deployment_id=<id|none|unknown>`. The teardown uses
 * it right before deleting the Preview, to leave a deployment from another upload alone.
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

/**
 * An id mismatch can be read-after-write lag, so it is retried. `otherId` is set only when the
 * latest deployment is a well-formed id different from ours (a candidate for "superseded").
 */
class MismatchError extends Error {
  /** @param {string} message @param {string} [otherId] */
  constructor(message, otherId) {
    super(message)
    this.otherId = otherId
  }
}

/**
 * Read-after-write lag that is not an id mismatch: the Preview was just created or recreated and
 * the read side still answers "not found" (10025) or "no deployment" (10222), or still shows our
 * deployment without its annotations. Retried against the same attempt budget as a mismatch; if it
 * persists it is an ordinary failure (never superseded).
 */
class PendingError extends Error {}

/** @param {unknown} body */
const hasMissingPreviewCode = (body) =>
  isObject(body) &&
  Array.isArray(body.errors) &&
  body.errors.some((e) => isObject(e) && (e.code === 10025 || e.code === 10222))

/** Exit code of the CLI when a newer, valid deployment replaced ours (see SupersededError). */
export const EXIT_SUPERSEDED = 3

/**
 * After the whole attempt budget the Preview's latest deployment is still a different, well-formed
 * deployment (the last answer was that, not a transient error). Someone else uploaded to the
 * Preview after this run; the caller must not delete it. Never thrown for a tag, message or
 * commit_sha mismatch on our own deployment, nor when the last attempt was a transient error.
 */
export class SupersededError extends Error {
  /** @param {string} message @param {string} deploymentId */
  constructor(message, deploymentId) {
    super(message)
    this.deploymentId = deploymentId
  }
}

const FLAGS = {
  "--worker": ["worker", (v) => /^[a-z0-9-]{1,63}$/.test(v)],
  "--preview": ["preview", (v) => /^[a-z0-9-]{1,63}$/.test(v)],
  "--deployment": ["deployment", (v) => /^[A-Za-z0-9-]{1,64}$/.test(v)],
  "--tag": ["tag", (v) => /^[0-9a-f]{40}$/.test(v)],
  "--message": ["message", (v) => v.length >= 1 && v.length <= 100],
}
/** Optional: the Preview's latest deployment id before this run's upload, or `none`. */
const OPTIONAL_FLAGS = {
  "--previous": ["previous", (v) => /^[A-Za-z0-9-]{1,64}$/.test(v)],
}

/**
 * @param {string[]} argv
 * @returns {{ worker: string, preview: string, deployment: string, tag: string, message: string,
 *   previous?: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    const spec = FLAGS[flag] ?? OPTIONAL_FLAGS[flag]
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
    const wellFormed = typeof result.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(result.id)
    throw new MismatchError(
      `the latest stage deployment is ${String(result.id)}, not the one this run uploaded (${expected.deployment})`,
      wellFormed && isObject(result.annotations) ? result.id : undefined,
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
    // Same text as before, so readPrevious still maps it to "none"; main() retries it.
    if (hasMissingPreviewCode(body)) throw new PendingError(text)
    fail(text)
  }
  if (body === undefined) fail(`GET ${shown} answered with a body that is not JSON`)
  return body
}

/**
 * Reads the Preview's latest deployment id once, before the upload. Never throws: `none` when the
 * Preview or its deployment does not exist yet, `unknown` on any other failure or odd answer.
 *
 * @param {{ token: string, accountId: string, worker: string, preview: string,
 *   fetchImpl?: typeof fetch }} options
 * @returns {Promise<string>}
 */
export async function readPrevious(options) {
  try {
    const body = await fetchLatest(options)
    const id = isObject(body) && isObject(body.result) ? body.result.id : undefined
    if (isObject(body) && body.success === true && typeof id === "string") {
      return /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : "unknown"
    }
    return "unknown"
  } catch (error) {
    const text = error instanceof Error ? error.message : ""
    if (text.includes("does not exist)") || text.includes("has no deployment)")) return "none"
    return "unknown"
  }
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
  /** The other deployment's id when the LAST attempt was a clean id mismatch, else undefined. */
  let supersededBy
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
      supersededBy = error instanceof MismatchError ? error.otherId : undefined
    }
  }
  // Only a deployment that is neither ours nor the one that was live before our upload is newer
  // than our upload. Without a known previous id, a stale read cannot be told from a newer upload.
  // `none` is no basis either: a lagging replica can still serve the last deployment of a Preview
  // that an earlier teardown deleted, which would look like a newer upload.
  const known = args.previous !== undefined && args.previous !== "none"
  if (supersededBy !== undefined && known && supersededBy !== args.previous) {
    throw new SupersededError(`${last} (after ${attempts} attempts; superseded)`, supersededBy)
  }
  return fail(`${last} (after ${attempts} attempts)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readMode = { "--read-previous": "previous", "--read-latest": "latest" }[process.argv[2]]
  if (readMode) {
    const argv = process.argv.slice(3)
    let previous = "unknown"
    if (
      argv.length === 4 &&
      argv[0] === "--worker" &&
      argv[2] === "--preview" &&
      /^[a-z0-9-]{1,63}$/.test(argv[1]) &&
      /^[a-z0-9-]{1,63}$/.test(argv[3]) &&
      process.env.CLOUDFLARE_API_TOKEN &&
      /^[0-9a-f]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? "")
    ) {
      previous = await readPrevious({
        token: process.env.CLOUDFLARE_API_TOKEN,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
        worker: argv[1],
        preview: argv[3],
      })
    }
    console.log(`${readMode}_deployment_id=${previous}`)
    process.exit(0)
  }
  try {
    console.log(await main(process.argv.slice(2), process.env))
  } catch (error) {
    if (error instanceof SupersededError) {
      // stdout is appended to GITHUB_OUTPUT by the workflow; the exit code is distinct.
      console.log(`superseded=true\nsuperseded_by=${error.deploymentId}`)
      console.error(`error: ${error.message}`)
      process.exit(EXIT_SUPERSEDED)
    }
    console.error(`error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
