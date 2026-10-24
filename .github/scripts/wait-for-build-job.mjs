#!/usr/bin/env node
/**
 * Waits for the latest attempt of this run's "Build and check" job (the browser shards in
 * ci.yml start with it and need its artifact). Exits 0 when that attempt succeeded, 1 when it
 * ended any other way, when the job list stayed unreadable, or after 1500 s.
 *
 * Environment: GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN (github.token).
 * Node only (global fetch): the Playwright image the shards run in has no gh.
 */
import { pathToFileURL } from "node:url"

export const JOB_NAME = "Build and check"
export const GIVE_UP_SECONDS = 1500
export const MAX_API_FAILURES = 10

// Poll often while a warm build is due, then slowly (a cold plugin restore takes minutes),
// which keeps 10 shards well under the token's API rate limit.
export function pollDelaySeconds(elapsed) {
  if (elapsed < 90) return 5
  if (elapsed < 300) return 15
  return 30
}

function nextLink(header) {
  for (const part of (header ?? "").split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

// Every job of the run, all attempts, following Link rel="next".
async function listJobs(fetchFn, { apiUrl, repository, runId, token }) {
  const jobs = []
  let url = `${apiUrl}/repos/${repository}/actions/runs/${runId}/jobs?filter=all&per_page=100`
  for (let pages = 0; url && pages < 100; pages++) {
    const res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body?.jobs)) throw new Error("no jobs array in the response")
    jobs.push(...body.jobs)
    url = nextLink(res.headers?.get?.("link"))
  }
  return jobs
}

export async function waitForBuildJob({
  env,
  fetch: fetchFn = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  log = (line) => console.log(line),
}) {
  const ctx = {
    apiUrl: (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, ""),
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    token: env.GH_TOKEN,
  }
  if (!ctx.repository || !ctx.runId || !ctx.token) {
    log("::error::GITHUB_REPOSITORY, GITHUB_RUN_ID and GH_TOKEN are required.")
    return 1
  }
  const start = now()
  let failures = 0
  for (;;) {
    try {
      const jobs = await listJobs(fetchFn, ctx)
      failures = 0
      const latest = jobs
        .filter((j) => j.name === JOB_NAME)
        .reduce((a, j) => (!a || j.run_attempt > a.run_attempt ? j : a), null)
      if (latest?.status === "completed") {
        if (latest.conclusion === "success") {
          log(`${JOB_NAME} (attempt ${latest.run_attempt}) succeeded.`)
          return 0
        }
        log(
          `::error::${JOB_NAME} (attempt ${latest.run_attempt}) ended with '${latest.conclusion}'; there is no build output to test.`,
        )
        return 1
      }
    } catch (err) {
      failures++
      log(
        `::warning::Could not read the job list (${failures} in a row): ${err.message}; retrying.`,
      )
      if (failures >= MAX_API_FAILURES) {
        log("::error::The job list stayed unreadable (API error or rate limit); giving up.")
        return 1
      }
    }
    const elapsed = Math.floor((now() - start) / 1000)
    if (elapsed >= GIVE_UP_SECONDS) {
      log(`::error::Timed out after ${elapsed} s waiting for ${JOB_NAME}.`)
      return 1
    }
    await sleep(pollDelaySeconds(elapsed) * 1000)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await waitForBuildJob({ env: process.env })
}
