/**
 * Indexing policy. One Worker serves production and the `stage` Preview, so the decision is
 * made per request: indexable only for the production build on the canonical host. Everything
 * else (the stage Preview, any workers.dev URL, production version URLs, localhost) is noindex.
 *
 * @module indexing
 */

export const CANONICAL_HOST = "notes.szolotov.com"

/**
 * @param {{ ENVIRONMENT?: string }} env
 * @param {URL} url
 * @returns {boolean}
 */
export function isIndexable(env, url) {
  return env.ENVIRONMENT === "production" && url.hostname === CANONICAL_HOST
}
