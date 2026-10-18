/**
 * Content-Security-Policy for the site.
 *
 * Verified in Chromium against the built site (SPA navigation, search, graph, Mermaid and its
 * expand popup, popovers, dark mode, copy buttons) with zero `securitypolicyviolation` events.
 *
 * Built from the hashes of the inline scripts Quartz emits (worker/csp.generated.js, written by
 * scripts/build-csp.mjs during `npm run build`).
 *
 * Relaxations, each proven necessary by removing it and watching the browser:
 *
 *  - style-src 'unsafe-inline'. Everything else is strict, but styles cannot be. With
 *    `style-src 'self'` the browser reports ~2,600 violations on one visit: Quartz's SPA router
 *    (micromorph) copies `style=""` attributes into the live DOM with setAttribute, layout
 *    components render `style=""` attributes, and Mermaid creates `<style>` elements with
 *    runtime-generated CSS for every diagram. Splitting into style-src-attr (unsafe-inline) plus
 *    style-src-elem (hashes) still fails because of Mermaid's runtime `<style>` elements. CSS
 *    injection is a much weaker primitive than script injection, and script-src stays strict.
 *
 *  - img-src data:. The callout icons are `url("data:image/svg+xml...")` values in Quartz's CSS.
 *
 * NOT needed (do not add): 'unsafe-inline' or 'unsafe-eval' for scripts, blob:, worker-src beyond
 * 'self', or any third-party origin. The graph is Canvas 2D with a d3 subset bundled into
 * postscript.js, so it needs nothing extra. The explorer would need 'unsafe-eval' out of the box;
 * scripts/postprocess-build.mjs removes that cause at build time.
 *
 * @module csp
 */

import { SCRIPT_HASHES } from "./csp.generated.js"

/** @type {Record<string, string[]>} */
const directives = {
  "default-src": ["'self'"],
  "script-src": ["'self'", ...SCRIPT_HASHES],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": [],
}

export const CONTENT_SECURITY_POLICY = Object.entries(directives)
  .map(([name, values]) => [name, ...values].join(" "))
  .join("; ")
