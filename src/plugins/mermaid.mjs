// Sätteri mdast plugin: replaces ```mermaid fences with <pre class="mermaid">
// so Expressive Code leaves them alone and the client-side renderer in
// src/components/Footer.astro can draw them.
import { defineMdastPlugin } from 'satteri';

const escapeHtml = (value) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const mermaid = defineMdastPlugin({
	name: 'notes-mermaid',
	code(node, ctx) {
		if (node.lang !== 'mermaid') return;
		ctx.replaceNode(node, { type: 'html', value: `<pre class="mermaid">${escapeHtml(node.value)}</pre>` });
	},
});
