import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { markdownToHtml } from 'satteri';
import { wikilinks } from '../src/plugins/wikilinks.mjs';
import { callouts, asideType } from '../src/plugins/callouts.mjs';
import { mermaid } from '../src/plugins/mermaid.mjs';
import { buildNoteIndex, pathToUrl } from '../src/plugins/note-index.mjs';

const index = new Map([
	['gke-workload-identity', '/patterns/gke-workload-identity/'],
	['patterns/gke-workload-identity', '/patterns/gke-workload-identity/'],
]);

// async so a throwing plugin surfaces as a rejection in assert.rejects
const render = async (md, plugins) => markdownToHtml(md, { mdastPlugins: plugins }).html;

test('wikilinks resolve by name, path, alias and heading', async () => {
	const html = await render(
		'[[gke-workload-identity]] [[patterns/gke-workload-identity|WI]] [[gke-workload-identity#Pre checks]]',
		[wikilinks({ index })],
	);
	assert.match(html, /<a href="\/patterns\/gke-workload-identity\/">gke-workload-identity<\/a>/);
	assert.match(html, /<a href="\/patterns\/gke-workload-identity\/">WI<\/a>/);
	assert.match(html, /href="\/patterns\/gke-workload-identity\/#pre-checks"/);
});

test('unresolved wikilinks warn by default and fail in strict mode', async () => {
	const warnings = [];
	const html = await render('see [[missing-note]] here', [wikilinks({ index, onMissing: (m) => warnings.push(m) })]);
	assert.equal(html.trim(), '<p>see missing-note here</p>');
	assert.equal(warnings.length, 1);
	await assert.rejects(async () => render('[[missing-note]]', [wikilinks({ index, strict: true })]), /Unresolved wikilink/);
});

test('wikilinks inside inline code are left alone', async () => {
	const html = await render('`[[gke-workload-identity]]`', [wikilinks({ index, strict: true })]);
	assert.match(html, /<code>\[\[gke-workload-identity\]\]<\/code>/);
});

test('callout types map onto Starlight aside types', () => {
	assert.equal(asideType('warning'), 'caution');
	assert.equal(asideType('Danger'), 'danger');
	assert.equal(asideType('tip'), 'tip');
	assert.equal(asideType('unknown-type'), 'note');
});

test('plain blockquotes are not treated as callouts', async () => {
	const html = await render('> just a quote', [callouts]);
	assert.match(html, /<blockquote>/);
});

test('mermaid fences become <pre class="mermaid"> with escaped source', async () => {
	const html = await render('```mermaid\ngraph TD; A-->B\n```', [mermaid]);
	assert.match(html, /<pre class="mermaid">graph TD; A--&gt;B<\/pre>/);
});

test('note index maps files to Starlight URLs', () => {
	assert.equal(pathToUrl('index.md'), '/');
	assert.equal(pathToUrl('standards/index.md'), '/standards/');
	const docs = buildNoteIndex(fileURLToPath(new URL('../src/content/docs/', import.meta.url)));
	assert.equal(docs.get('gke-workload-identity'), '/patterns/gke-workload-identity/');
	assert.equal(docs.get('adr/0001-gitops-with-argocd'), '/adr/0001-gitops-with-argocd/');
});
