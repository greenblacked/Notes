// Sätteri mdast plugin: turns Obsidian [[target]], [[target|alias]] and
// [[target#heading]] into regular links. Unresolved targets are rendered as
// plain text and reported; with `strict: true` they fail the build instead.
import { defineMdastPlugin } from 'satteri';
import { slugify } from './note-index.mjs';

const WIKILINK = /\[\[([^\[\]|#]+)(#[^\[\]|]+)?(?:\|([^\[\]]+))?\]\]/g;

function headingAnchor(heading) {
	return slugify(heading.slice(1))
		.replace(/[^\p{L}\p{N}\-_]/gu, '')
		.replace(/-+/g, '-');
}

export function wikilinks({ index, strict = false, onMissing = console.warn }) {
	return defineMdastPlugin({
		name: 'notes-wikilinks',
		text(node, ctx) {
			if (!node.value.includes('[[')) return;
			const parts = [];
			let last = 0;
			for (const match of node.value.matchAll(WIKILINK)) {
				const [raw, target, heading, alias] = match;
				if (match.index > last) parts.push({ type: 'text', value: node.value.slice(last, match.index) });
				const label = (alias ?? target + (heading ?? '')).trim();
				const url = index.get(slugify(target));
				if (url) {
					const hash = heading ? `#${headingAnchor(heading)}` : '';
					parts.push({ type: 'link', url: url + hash, children: [{ type: 'text', value: label }] });
				} else {
					const message = `Unresolved wikilink ${raw}${ctx.fileURL ? ` in ${ctx.fileURL.pathname}` : ''}`;
					if (strict) throw new Error(message);
					onMissing(message);
					parts.push({ type: 'text', value: label });
				}
				last = match.index + raw.length;
			}
			if (parts.length === 0) return;
			if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
			ctx.replaceNode(node, parts);
		},
	});
}
