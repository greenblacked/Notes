import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-links.mjs', import.meta.url));

function site(pages) {
	const dir = mkdtempSync(join(tmpdir(), 'notes-links-'));
	for (const [path, html] of Object.entries(pages)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), html);
	}
	return spawnSync(process.execPath, [script], { env: { ...process.env, DIST_DIR: dir }, encoding: 'utf8' });
}

test('passes when every internal reference resolves', () => {
	const run = site({
		'index.html': '<a href="/adr/">a</a> <a href="adr/#x">b</a> <img src="/logo.svg"> <a href="https://example.com/">c</a>',
		'adr/index.html': '<a href="../">home</a>',
		'logo.svg': '<svg/>',
	});
	assert.equal(run.status, 0, run.stderr);
});

test('fails on a missing page or asset', () => {
	const run = site({ 'index.html': '<a href="/missing/">x</a> <img src="/nope.png">' });
	assert.equal(run.status, 1);
	assert.match(run.stderr, /2 broken internal link/);
});
