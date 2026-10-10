// Per-environment build output. Production and stage are built from the same
// commit; only these values differ between them.
import { writeFile } from 'node:fs/promises';
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

// Keep every site-wide header in one "/*" block: a second "/*" block replaced
// the first instead of merging with it under wrangler dev. Stage adds X-Robots-Tag.
export function headersFile(env) {
	const site = [
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

// Served at /build-info.json; the smoke test polls it to confirm the new
// version is live. BUILD_COMMIT wins over GITHUB_SHA because GitHub ignores
// attempts to override GITHUB_* variables, and a dispatched production deploy
// builds a tag that is not the workflow's own commit.
export function buildInfo(env, vars = process.env) {
	return {
		env: env.name,
		commit: vars.BUILD_COMMIT || vars.GITHUB_SHA || 'local',
		ref: vars.BUILD_REF || vars.GITHUB_REF_NAME || 'local',
	};
}

export function deployEnv(env) {
	return {
		name: 'notes-deploy-env',
		hooks: {
			'astro:build:done': async ({ dir, logger }) => {
				const out = fileURLToPath(dir);
				await writeFile(`${out}robots.txt`, robotsTxt(env));
				await writeFile(`${out}_headers`, headersFile(env));
				await writeFile(`${out}build-info.json`, JSON.stringify(buildInfo(env)) + '\n');
				logger.info(`built for ${env.name} (${env.siteUrl}), noindex=${env.noindex}`);
			},
		},
	};
}
