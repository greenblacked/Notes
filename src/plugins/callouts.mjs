// Sätteri mdast plugin: converts Obsidian callouts (> [!warning] Title) into
// Starlight aside directives, so they render with Starlight's own styling.
// Must run before Starlight's directive plugins, which is the case for
// plugins passed to `satteri()` in astro.config.mjs.
import { defineMdastPlugin } from 'satteri';

const CALLOUT = /^\[!([a-z-]+)\][+-]?[ \t]*([^\n]*)\n?/i;

const ASIDE_TYPE = {
	note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note', todo: 'note', quote: 'note', cite: 'note',
	tip: 'tip', hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip', example: 'tip',
	warning: 'caution', caution: 'caution', attention: 'caution', question: 'caution', help: 'caution', faq: 'caution',
	danger: 'danger', error: 'danger', bug: 'danger', failure: 'danger', fail: 'danger', missing: 'danger',
};

export function asideType(calloutType) {
	return ASIDE_TYPE[calloutType.toLowerCase()] ?? 'note';
}

export const callouts = defineMdastPlugin({
	name: 'notes-callouts',
	blockquote(node, ctx) {
		const [first, ...rest] = node.children;
		const lead = first?.type === 'paragraph' ? first.children[0] : undefined;
		if (lead?.type !== 'text') return;
		const match = CALLOUT.exec(lead.value);
		if (!match) return;

		const [raw, type, title] = match;
		const remainder = lead.value.slice(raw.length);
		const leadRest = [
			...(remainder ? [{ type: 'text', value: remainder }] : []),
			...first.children.slice(1),
		];
		// A soft line break right after the marker line is not content.
		if (leadRest[0]?.type === 'break') leadRest.shift();

		const children = [];
		if (title.trim()) {
			children.push({ type: 'paragraph', data: { directiveLabel: true }, children: [{ type: 'text', value: title.trim() }] });
		}
		if (leadRest.length) children.push({ type: 'paragraph', children: leadRest });
		children.push(...rest);

		ctx.replaceNode(node, {
			type: 'containerDirective',
			name: asideType(type),
			attributes: {},
			children,
		});
	},
});
