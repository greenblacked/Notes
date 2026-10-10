// Sätteri mdast plugin: turns Obsidian [[target]], [[target|alias]] and
// [[target#heading]] into regular links. Unresolved targets are rendered as
// plain text and passed to `onMissing`.
//
// The plugin cannot fail the build itself: Astro's content loader catches
// render errors and publishes the page with an empty body. astro.config.mjs
// therefore collects misses and fails the build from an integration hook.
import { slug } from 'github-slugger';
import { noteKey } from './note-index.mjs';

const WIKILINK = /\[\[([^\[\]|#]+)(#[^\[\]|]+)?(?:\|([^\[\]]+))?\]\]/g;

export function wikilinks({ index, onMissing = console.warn }) {
	return {
		name: 'notes-wikilinks',
		text(node, ctx) {
			if (!node.value.includes('[[')) return;
			const parts = [];
			let last = 0;
			for (const match of node.value.matchAll(WIKILINK)) {
				const [raw, target, heading, alias] = match;
				if (match.index > last) parts.push({ type: 'text', value: node.value.slice(last, match.index) });
				const label = (alias ?? (heading ? `${target.trim()} › ${heading.slice(1).trim()}` : target)).trim();
				const url = index.get(noteKey(target));
				if (url) {
					// Same slugger Astro uses for heading ids (first occurrence).
					const hash = heading ? `#${slug(heading.slice(1).trim())}` : '';
					parts.push({ type: 'link', url: url + hash, children: [{ type: 'text', value: label }] });
				} else {
					onMissing(`Unresolved wikilink ${raw}${ctx.fileURL ? ` in ${ctx.fileURL.pathname}` : ''}`);
					parts.push({ type: 'text', value: label });
				}
				last = match.index + raw.length;
			}
			if (parts.length === 0) return;
			if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
			ctx.replaceNode(node, parts);
		},
	};
}
