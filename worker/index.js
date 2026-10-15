/**
 * Cloudflare Worker in front of the static Quartz site (Workers static assets).
 *
 * Responsibilities:
 *  - apply security headers (CSP, HSTS, nosniff, referrer and permissions policies) to every response
 *  - decide whether the host may be indexed (see `isIndexable`) and, if not, serve a disallow-all
 *    /robots.txt and mark every response `X-Robots-Tag: noindex, nofollow`
 *  - keep /version.txt uncacheable so deploy verification always sees the live build
 *
 * No dependencies. The CSP is assembled in ./csp.js from hashes that the build writes to
 * ./csp.generated.js (see scripts/build-csp.mjs).
 *
 * @module worker
 */

import { CONTENT_SECURITY_POLICY } from "./csp.js"
import { CANONICAL_HOST, isIndexable } from "./indexing.js"

/**
 * @typedef {Object} Env
 * @property {{ fetch: (request: Request) => Promise<Response> }} ASSETS Static assets binding.
 * @property {string} [ENVIRONMENT] "production" (top-level vars) or "preview" (`previews.vars`).
 */

const PRODUCTION_ORIGIN = `https://${CANONICAL_HOST}`

/** Headers applied to every response. */
const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": [
    "accelerometer=()",
    "autoplay=()",
    "camera=()",
    "display-capture=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "midi=()",
    "payment=()",
    "usb=()",
    "interest-cohort=()",
  ].join(", "),
  "Cross-Origin-Opener-Policy": "same-origin",
}

/**
 * @param {boolean} indexable
 * @returns {string}
 */
function robotsTxt(indexable) {
  if (!indexable) {
    return "User-agent: *\nDisallow: /\n"
  }
  return `User-agent: *\nAllow: /\n\nSitemap: ${PRODUCTION_ORIGIN}/sitemap.xml\n`
}

/**
 * Copy a response with the security headers applied.
 *
 * @param {Response} response
 * @param {Env} env
 * @param {URL} url
 * @returns {Response}
 */
function withHeaders(response, env, url) {
  const out = new Response(response.body, response)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    out.headers.set(name, value)
  }
  if (!isIndexable(env, url)) {
    out.headers.set("X-Robots-Tag", "noindex, nofollow")
  }
  if (url.pathname === "/version.txt") {
    out.headers.set("Cache-Control", "no-store")
  }
  return out
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method !== "GET" && request.method !== "HEAD") {
      return withHeaders(
        new Response("Method Not Allowed\n", {
          status: 405,
          headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
        }),
        env,
        url,
      )
    }

    if (url.pathname === "/robots.txt") {
      return withHeaders(
        new Response(request.method === "HEAD" ? null : robotsTxt(isIndexable(env, url)), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        }),
        env,
        url,
      )
    }

    return withHeaders(await env.ASSETS.fetch(request), env, url)
  },
}
