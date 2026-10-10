import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInfo, headersFile, resolveDeployEnv, robotsTxt } from '../src/integrations/deploy-env.mjs';

test('production is indexable', () => {
	const env = resolveDeployEnv('production');
	assert.equal(env.siteUrl, 'https://notes.szolotov.com');
	assert.doesNotMatch(headersFile(env), /X-Robots-Tag/);
	assert.match(robotsTxt(env), /^Allow: \/$/m);
});

test('stage is noindex everywhere', () => {
	const env = resolveDeployEnv('stage');
	assert.equal(env.siteUrl, 'https://stage.notes.szolotov.com');
	assert.match(headersFile(env), /X-Robots-Tag: noindex/);
	assert.match(robotsTxt(env), /^Disallow: \/$/m);
});

test('there is exactly one site-wide headers block', () => {
	for (const name of ['production', 'stage']) {
		const blocks = headersFile(resolveDeployEnv(name)).split('\n').filter((line) => line === '/*');
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
