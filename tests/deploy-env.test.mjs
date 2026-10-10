import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInfo, contentSecurityPolicy, headersFile, inlineScriptHashes, resolveDeployEnv, robotsTxt } from '../src/integrations/deploy-env.mjs';

test('production is indexable', () => {
	const env = resolveDeployEnv('production');
	assert.equal(env.siteUrl, 'https://notes.szolotov.com');
	assert.doesNotMatch(headersFile(env, 'default-src \'self\''), /X-Robots-Tag/);
	assert.match(robotsTxt(env), /^Allow: \/$/m);
});

test('stage is noindex everywhere', () => {
	const env = resolveDeployEnv('stage');
	assert.equal(env.siteUrl, 'https://stage.notes.szolotov.com');
	assert.match(headersFile(env, 'default-src \'self\''), /X-Robots-Tag: noindex/);
	assert.match(robotsTxt(env), /^Disallow: \/$/m);
});

test('there is exactly one site-wide headers block', () => {
	for (const name of ['production', 'stage']) {
		const blocks = headersFile(resolveDeployEnv(name), 'x').split('\n').filter((line) => line === '/*');
		assert.equal(blocks.length, 1);
	}
});

test('unknown environments are rejected', () => {
	assert.throws(() => resolveDeployEnv('prod'), /Unknown DEPLOY_ENV/);
});

test('build info prefers BUILD_COMMIT over GITHUB_SHA', () => {
	const env = resolveDeployEnv('production');
	const vars = { BUILD_COMMIT: 'tagsha', BUILD_REF: 'v1.0.0', GITHUB_SHA: 'mainsha', GITHUB_RUN_ID: '42' };
	assert.deepEqual(buildInfo(env, vars, 1000), {
		env: 'production',
		commit: 'tagsha',
		ref: 'v1.0.0',
		build: 'tagsha-42.1-1000',
	});
	assert.equal(buildInfo(env, { GITHUB_SHA: 'mainsha' }).commit, 'mainsha');
	assert.equal(buildInfo(env, {}).commit, 'local');
});

test('two builds of the same commit get different build ids', () => {
	const env = resolveDeployEnv('stage');
	assert.notEqual(buildInfo(env, { GITHUB_SHA: 'abc' }, 1).build, buildInfo(env, { GITHUB_SHA: 'abc' }, 2).build);
});

test('inline scripts are hashed; external, JSON and empty scripts are not', () => {
	const hashes = inlineScriptHashes([
		['a.html', '<script>console.log(1)</script><script type="module">x()</script>'],
		['b.html', '<script>console.log(1)</script><script src="/a.js"></script><script type="application/json">{}</script><script> </script>'],
	]);
	assert.equal(hashes.length, 2);
	// sha256 of "console.log(1)", as browsers compute it for CSP.
	assert.ok(hashes.includes("'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='"), hashes.join(' '));
});

test('inline event handlers fail the build', () => {
	assert.throws(() => inlineScriptHashes([['x.html', '<button onclick="go()">x</button>']]), /onclick/);
});

test('CSP keeps scripts hash-only and blocks framing and plugins', () => {
	const csp = contentSecurityPolicy(["'sha256-abc'"]);
	assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'sha256-abc';/);
	assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
	assert.match(csp, /frame-ancestors 'none'/);
	assert.match(csp, /object-src 'none'/);
});
