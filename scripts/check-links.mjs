#!/usr/bin/env node
// Checks internal links and asset references in the built site (dist/**/*.html).
// Run after `npm run build`. Exits 1 if any internal href/src cannot be resolved.
// Wikilinks are already checked at build time; this also covers plain Markdown
// links, hero actions, sidebar entries and asset paths.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(process.env.DIST_DIR || join(root, 'dist'));

if (!existsSync(distDir)) {
	console.error(`check-links: ${distDir} does not exist. Run \`npm run build\` first.`);
	process.exit(2);
}

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) yield* walk(full);
		else yield full;
	}
}

const files = [...walk(distDir)];
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const known = new Set(files.map((f) => relative(distDir, f).split(sep).join('/')));

const ATTR = /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// Any scheme (https:, mailto:, data:, ...) or protocol-relative URL.
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Does a site path (no leading slash, query or hash) map to an emitted file? */
function exists(sitePath) {
	const path = decodeURIComponent(sitePath).replace(/\/+$/, '');
	if (path === '') return known.has('index.html');
	return known.has(path) || known.has(`${path}.html`) || known.has(`${path}/index.html`);
}

function resolveRef(fromFile, ref) {
	const clean = ref.split('#')[0].split('?')[0];
	if (clean === '') return null;
	const base = new URL(`/${relative(distDir, fromFile).split(sep).join('/')}`, 'http://site.invalid');
	return new URL(clean, base).pathname.replace(/^\//, '');
}

const broken = [];
let checked = 0;
for (const file of htmlFiles) {
	for (const match of readFileSync(file, 'utf8').matchAll(ATTR)) {
		const ref = (match[2] ?? match[3] ?? '').trim();
		if (ref === '' || ref.startsWith('#') || EXTERNAL.test(ref)) continue;
		let target;
		try {
			target = resolveRef(file, ref);
		} catch {
			broken.push({ file, ref, why: 'unparseable' });
			continue;
		}
		if (target === null) continue;
		checked++;
		let ok = false;
		try {
			ok = exists(target);
		} catch {
			// Malformed percent-encoding.
		}
		if (!ok) broken.push({ file, ref, why: 'not found' });
	}
}

if (broken.length > 0) {
	console.error(`check-links: ${broken.length} broken internal link(s):`);
	for (const b of broken) console.error(`  ${relative(distDir, b.file)}: ${b.ref} (${b.why})`);
	process.exit(1);
}
console.log(`check-links: ${checked} internal references in ${htmlFiles.length} pages OK`);
