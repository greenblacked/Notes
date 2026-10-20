/**
 * Serves the built site (public/) through the real Worker (worker/index.js) on 127.0.0.1, for the
 * browser smoke tests (`npm run test:browser`). Standard library only.
 *
 * The static assets binding is emulated the way wrangler.jsonc configures it:
 * `html_handling: auto-trailing-slash` (foo.html is /foo, foo/index.html is /foo/) and
 * `not_found_handling: 404-page` (404.html with a 404 status). Everything else, including every
 * response header, comes from the Worker.
 *
 *   PUBLIC_DIR  directory to serve (default: public)
 *   PORT        port on 127.0.0.1 (default: 4173)
 *
 * @module serve-built-site
 */

import { createServer } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath, pathToFileURL } from "node:url"

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
}

/** @param {string} file @returns {string} */
export function contentType(file) {
  return TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"
}

/** @param {string} file @returns {boolean} */
function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * @typedef {{ kind: "file", file: string, status: number }
 *   | { kind: "redirect", location: string }} Resolved
 */

/**
 * Map a URL path to a file of `publicDir`, or to a redirect, like the static assets binding.
 *
 * @param {string} publicDir
 * @param {string} pathname the URL path, still percent-encoded, without the query
 * @returns {Resolved}
 */
export function resolveAsset(publicDir, pathname) {
  const root = resolve(publicDir)
  const notFound = () => ({
    kind: /** @type {const} */ ("file"),
    file: join(root, "404.html"),
    status: 404,
  })

  let path
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return notFound()
  }
  if (path.includes("\0") || !path.startsWith("/")) return notFound()

  /** @param {string} p @returns {string | null} */
  const inside = (p) => {
    const full = resolve(root, `.${p}`)
    return full === root || full.startsWith(root + sep) ? full : null
  }
  if (inside(path) === null) return notFound()

  if (path === "/") {
    const index = join(root, "index.html")
    return isFile(index) ? { kind: "file", file: index, status: 200 } : notFound()
  }

  // The canonical URL has neither ".html" nor "index.html".
  if (path.endsWith("/index.html")) {
    return { kind: "redirect", location: path.slice(0, -"index.html".length) }
  }
  if (path.endsWith(".html")) {
    return { kind: "redirect", location: path.slice(0, -".html".length) }
  }

  const exact = inside(path)
  if (exact && !path.endsWith("/") && isFile(exact)) {
    return { kind: "file", file: exact, status: 200 }
  }

  if (path.endsWith("/")) {
    const index = inside(`${path}index.html`)
    if (index && isFile(index)) return { kind: "file", file: index, status: 200 }
    const page = inside(`${path.slice(0, -1)}.html`)
    if (page && isFile(page)) return { kind: "redirect", location: path.slice(0, -1) }
    return notFound()
  }

  const page = inside(`${path}.html`)
  if (page && isFile(page)) return { kind: "file", file: page, status: 200 }
  const index = inside(`${path}/index.html`)
  if (index && isFile(index)) return { kind: "redirect", location: `${path}/` }
  return notFound()
}

/**
 * The `ASSETS` binding for the Worker.
 *
 * @param {string} publicDir
 * @returns {{ fetch: (request: Request) => Promise<Response> }}
 */
export function assetsBinding(publicDir) {
  return {
    async fetch(request) {
      const url = new URL(request.url)
      const resolved = resolveAsset(publicDir, url.pathname)
      if (resolved.kind === "redirect") {
        return new Response(null, {
          status: 307,
          headers: { Location: `${resolved.location}${url.search}` },
        })
      }
      const body = request.method === "HEAD" ? null : readFileSync(resolved.file)
      return new Response(body, {
        status: resolved.status,
        headers: { "Content-Type": contentType(resolved.file) },
      })
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const publicDir = resolve(process.env.PUBLIC_DIR ?? "public")
  const port = Number(process.env.PORT ?? "4173")
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..")

  if (
    !existsSync(join(publicDir, "index.html")) ||
    !existsSync(join(repo, "worker", "csp.generated.js"))
  ) {
    console.error(
      `${publicDir}/index.html or worker/csp.generated.js is missing: run npm run build first`,
    )
    process.exit(1)
  }

  const worker = (await import("../worker/index.js")).default
  const env = { ASSETS: assetsBinding(publicDir), ENVIRONMENT: "preview" }

  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
      }
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers,
      })
      const response = await worker.fetch(request, env)
      const out = new Headers(response.headers)
      // Only for plain http://127.0.0.1: the browsers would upgrade every subresource request to
      // https, which this server does not speak. Every other directive is the Worker's.
      const csp = out.get("Content-Security-Policy")
      if (csp) {
        out.set(
          "Content-Security-Policy",
          csp
            .split(";")
            .map((d) => d.trim())
            .filter((d) => d && d !== "upgrade-insecure-requests")
            .join("; "),
        )
      }
      res.writeHead(response.status, Object.fromEntries(out))
      if (response.body && req.method !== "HEAD") {
        Readable.fromWeb(/** @type {any} */ (response.body)).pipe(res)
      } else {
        res.end()
      }
    } catch (error) {
      console.error(error)
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("Internal Server Error\n")
    }
  })

  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving ${publicDir} through the Worker at http://127.0.0.1:${port}`)
  })
}
