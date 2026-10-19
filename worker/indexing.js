/**
 * Indexing policy. One Worker serves production and the Worker Previews, so the decision is
 * made per request: indexable only for the production build on the canonical host. Everything
 * else (the stage Preview, any workers.dev URL, production version URLs, localhost) is noindex:
 * a crawlable robots.txt with no sitemap, plus `X-Robots-Tag: noindex, nofollow` on every
 * response. robots.txt must not block crawling there: a crawler cannot read noindex on a URL
 * that robots.txt blocks, so a blocked URL can still be indexed by its URL alone.
 *
 * @module indexing
 */

export const CANONICAL_HOST = "notes.szolotov.com"
export const PRODUCTION_ORIGIN = `https://${CANONICAL_HOST}`

/**
 * @param {{ ENVIRONMENT?: string }} env
 * @param {URL} url
 * @returns {boolean}
 */
export function isIndexable(env, url) {
  return env.ENVIRONMENT === "production" && url.hostname === CANONICAL_HOST
}

/**
 * Body of /robots.txt. Indexable: allow all and list the production sitemap. Otherwise: allow
 * crawling with no sitemap, so crawlers can fetch pages and see their noindex.
 *
 * @param {boolean} indexable
 * @returns {string}
 */
export function robotsTxt(indexable) {
  if (!indexable) {
    return "User-agent: *\nAllow: /\n"
  }
  return `User-agent: *\nAllow: /\n\nSitemap: ${PRODUCTION_ORIGIN}/sitemap.xml\n`
}
