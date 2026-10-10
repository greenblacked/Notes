// Sätteri mdast plugin: converts Obsidian callouts (> [!warning] Title) into
// Starlight aside directives, so they render with Starlight's own styling.
// Must run before Starlight's directive plugins, which is the case for
// plugins passed to `satteri()` in astro.config.mjs.
import { defineMdastPlugin } from 'satteri';

const MARKER = /^\[!([a-z-]+)\][+-]?[ \t]*/i;

const ASIDE_TYPE = {
	note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note', todo: 'note', quote: 'note', cite: 'note',
	tip: 'tip', hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip', example: 'tip',
	warning: 'caution', caution: 'caution', attention: 'caution', question: 'caution', help: 'caution', faq: 'caution',
	danger: 'danger', error: 'danger', bug: 'danger', failure: 'danger', fail: 'danger', missing: 'danger',
};

export function asideType(calloutType) {
	return ASIDE_TYPE[calloutType.toLowerCase()] ?? 'note';
}

/**
 * Split the first paragraph's inline nodes into the title line (everything
 * up to the first line break, formatting included) and the body.
 */
export function splitTitle(inline) {
	const title = [];
	for (let i = 0; i < inline.length; i++) {
		const node = inline[i];
		if (node.type === 'break') return { title, body: inline.slice(i + 1) };
		if (node.type === 'text' && node.value.includes('\n')) {
			const at = node.value.indexOf('\n');
			const before = node.value.slice(0, at);
			const after = node.value.slice(at + 1);
			if (before) title.push({ type: 'text', value: before });
			return { title, body: [...(after ? [{ type: 'text', value: after }] : []), ...inline.slice(i + 1)] };
		}
		title.push(node);
	}
	return { title, body: [] };
}

export const callouts = defineMdastPlugin({
	name: 'notes-callouts',
	blockquote(node, ctx) {
		const [first, ...rest] = node.children;
		const lead = first?.type === 'paragraph' ? first.children[0] : undefined;
		if (lead?.type !== 'text') return;
		const match = MARKER.exec(lead.value);
		if (!match) return;

		const remainder = lead.value.slice(match[0].length);
		const inline = [...(remainder ? [{ type: 'text', value: remainder }] : []), ...first.children.slice(1)];
		const { title, body } = splitTitle(inline);
		const hasTitle = title.some((n) => n.type !== 'text' || n.value.trim());

		const children = [];
		if (hasTitle) children.push({ type: 'paragraph', data: { directiveLabel: true }, children: title });
		if (body.length) children.push({ type: 'paragraph', children: body });
		children.push(...rest);

		ctx.replaceNode(node, { type: 'containerDirective', name: asideType(match[1]), attributes: {}, children });
	},
});
