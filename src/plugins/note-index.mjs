// Builds the lookup table used to resolve Obsidian-style [[wikilinks]].
// Keys are what an author types, lower-cased: the docs-relative path without
// extension ("patterns/gke-workload-identity") and, when unique, the bare
// file name ("gke-workload-identity"). Values are the URLs Astro actually
// serves, which slug every path segment with github-slugger.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { slug } from 'github-slugger';

const MARKDOWN = /\.(md|mdx)$/i;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Normalise what an author writes in [[...]] or a file path into an index key. */
export function noteKey(value) {
	return value.trim().replace(MARKDOWN, '').replace(/\\/g, '/').toLowerCase();
}

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walk(path);
		return MARKDOWN.test(entry.name) ? [path] : [];
	});
}

function frontmatter(file) {
	return FRONTMATTER.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
}

/** Map a docs-relative file path to the URL Starlight serves it at. */
export function pathToUrl(relPath, slugOverride) {
	const path = slugOverride ?? relPath.split(sep).join('/').replace(MARKDOWN, '').split('/').map((s) => slug(s)).join('/');
	const clean = path.replace(/^\/+|\/+$/g, '').replace(/(^|\/)index$/, '');
	return clean ? `/${clean}/` : '/';
}

export function buildNoteIndex(docsDir) {
	const index = new Map();
	const byName = new Map();
	for (const file of walk(docsDir)) {
		const fm = frontmatter(file);
		// Drafts are never built, so a link to one would be a dead link.
		if (/^draft:\s*true\s*$/m.test(fm)) continue;
		const slugOverride = /^slug:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(fm)?.[1];
		const rel = relative(docsDir, file);
		const url = pathToUrl(rel, slugOverride);
		const key = noteKey(rel.split(sep).join('/'));
		index.set(key, url);
		const name = key.split('/').pop();
		if (name !== 'index') byName.set(name, byName.has(name) ? null : url);
	}
	for (const [name, url] of byName) {
		// Ambiguous bare names must be linked by full path.
		if (url && !index.has(name)) index.set(name, url);
	}
	return index;
}
