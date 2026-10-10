// Per-environment build output. Production and stage are built from the same
// commit; only these values differ between them.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENVIRONMENTS = {
	production: { name: 'production', siteUrl: 'https://notes.szolotov.com', noindex: false },
	stage: { name: 'stage', siteUrl: 'https://stage.notes.szolotov.com', noindex: true },
};

export function resolveDeployEnv(value = 'production') {
	const env = ENVIRONMENTS[value];
	if (!env) throw new Error(`Unknown DEPLOY_ENV "${value}", expected one of: ${Object.keys(ENVIRONMENTS).join(', ')}`);
	return env;
}

export function robotsTxt(env) {
	return env.noindex
		? 'User-agent: *\nDisallow: /\n'
		: `User-agent: *\nAllow: /\n\nSitemap: ${env.siteUrl}/sitemap-index.xml\n`;
}

// Script types the browser executes; JSON data blocks need no hash.
const EXECUTABLE = /^(?:|module|(?:text|application)\/(?:javascript|ecmascript))$/i;

/**
 * sha256 CSP sources for every inline <script> in the built HTML. Inline event
 * handlers can't be allowed without 'unsafe-hashes', so they fail the build.
 */
export function inlineScriptHashes(htmlPages) {
	const hashes = new Set();
	const handlers = [];
	for (const [name, html] of htmlPages) {
		for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
			if (/\ssrc\s*=/i.test(` ${attrs}`)) continue;
			const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(` ${attrs}`)?.[1] ?? '';
			if (!EXECUTABLE.test(type) || body.trim() === '') continue;
			hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
		}
		for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
			for (const [, handler] of tag.matchAll(/\s(on[a-z]+)\s*=/gi)) handlers.push(`${name}: ${handler}`);
		}
	}
	if (handlers.length > 0) throw new Error(`Inline event handlers break the CSP:\n  ${handlers.join('\n  ')}`);
	return [...hashes].sort();
}

/**
 * Relaxations, each needed by the built site:
 * - script-src 'wasm-unsafe-eval': Pagefind search runs as WebAssembly.
 * - style-src 'unsafe-inline': Starlight and Mermaid set inline styles and
 *   Mermaid injects <style> per diagram. Scripts stay hash-only.
 * - img-src data:: inline SVG icons in CSS.
 */
export function contentSecurityPolicy(scriptHashes) {
	const directives = {
		'default-src': ["'self'"],
		'script-src': ["'self'", "'wasm-unsafe-eval'", ...scriptHashes],
		'style-src': ["'self'", "'unsafe-inline'"],
		'img-src': ["'self'", 'data:'],
		'font-src': ["'self'"],
		'connect-src': ["'self'"],
		'worker-src': ["'self'"],
		'manifest-src': ["'self'"],
		'object-src': ["'none'"],
		'base-uri': ["'self'"],
		'form-action': ["'self'"],
		'frame-ancestors': ["'none'"],
		'upgrade-insecure-requests': [],
	};
	return Object.entries(directives)
		.map(([name, values]) => [name, ...values].join(' '))
		.join('; ');
}

async function readHtmlPages(dir) {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	const files = entries.filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => join(e.parentPath, e.name));
	return Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')]));
}

// Keep every site-wide header in one "/*" block: a second "/*" block replaced
// the first instead of merging with it under wrangler dev. Stage adds X-Robots-Tag.
export function headersFile(env, csp) {
	const site = [
		`Content-Security-Policy: ${csp}`,
		'Strict-Transport-Security: max-age=31536000; includeSubDomains',
		'X-Content-Type-Options: nosniff',
		'X-Frame-Options: DENY',
		'Referrer-Policy: strict-origin-when-cross-origin',
		'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
		'Cross-Origin-Opener-Policy: same-origin',
		...(env.noindex ? ['X-Robots-Tag: noindex, nofollow'] : []),
	];
	const block = (pattern, lines) => [pattern, ...lines.map((line) => `  ${line}`)].join('\n');
	return [
		block('/*', site),
		block('/_astro/*', ['Cache-Control: public, max-age=31536000, immutable']),
		block('/build-info.json', ['Cache-Control: no-store']),
	].join('\n\n') + '\n';
}

// Served at /build-info.json. The smoke test polls `build`, which is unique
// per build, so redeploying a commit that is already live still waits for
// the new upload. BUILD_COMMIT wins over GITHUB_SHA because GitHub ignores
// attempts to override GITHUB_* variables, and a dispatched production deploy
// builds a tag that is not the workflow's own commit.
export function buildInfo(env, vars = process.env, now = Date.now()) {
	const commit = vars.BUILD_COMMIT || vars.GITHUB_SHA || 'local';
	const run = vars.GITHUB_RUN_ID ? `${vars.GITHUB_RUN_ID}.${vars.GITHUB_RUN_ATTEMPT || 1}` : 'local';
	return {
		env: env.name,
		commit,
		ref: vars.BUILD_REF || vars.GITHUB_REF_NAME || 'local',
		build: `${commit.slice(0, 12)}-${run}-${now}`,
	};
}

export function deployEnv(env) {
	return {
		name: 'notes-deploy-env',
		hooks: {
			'astro:build:done': async ({ dir, logger }) => {
				const out = fileURLToPath(dir);
				await writeFile(`${out}robots.txt`, robotsTxt(env));
				const csp = contentSecurityPolicy(inlineScriptHashes(await readHtmlPages(out)));
				await writeFile(`${out}_headers`, headersFile(env, csp));
				await writeFile(`${out}build-info.json`, JSON.stringify(buildInfo(env)) + '\n');
				logger.info(`built for ${env.name} (${env.siteUrl}), noindex=${env.noindex}`);
			},
		},
	};
}
