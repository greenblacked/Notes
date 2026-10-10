// Builds the lookup table used to resolve Obsidian-style [[wikilinks]].
// Keys are lowercase slugs: the full path relative to the docs root
// ("patterns/gke-workload-identity") and, when unique, the bare file name
// ("gke-workload-identity"), so notes can be linked the way Obsidian does.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const MARKDOWN = /\.(md|mdx)$/i;

export function slugify(value) {
	return value
		.trim()
		.toLowerCase()
		.replace(/\.(md|mdx)$/, '')
		.replace(/\s+/g, '-');
}

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walk(path);
		return MARKDOWN.test(entry.name) ? [path] : [];
	});
}

/** Map a docs-relative file path to the URL Starlight serves it at. */
export function pathToUrl(relPath) {
	const slug = slugify(relPath.split(sep).join('/'));
	if (slug === 'index') return '/';
	return `/${slug.replace(/\/index$/, '')}/`;
}

export function buildNoteIndex(docsDir) {
	const index = new Map();
	const byName = new Map();
	for (const file of walk(docsDir)) {
		const rel = relative(docsDir, file);
		const url = pathToUrl(rel);
		const full = slugify(rel.split(sep).join('/'));
		index.set(full, url);
		const name = full.split('/').pop();
		if (name !== 'index') byName.set(name, byName.has(name) ? null : url);
	}
	for (const [name, url] of byName) {
		// Ambiguous bare names must be linked by full path.
		if (url && !index.has(name)) index.set(name, url);
	}
	return index;
}
