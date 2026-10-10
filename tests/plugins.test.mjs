import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml } from 'satteri';
import { wikilinks } from '../src/plugins/wikilinks.mjs';
import { asideType, callouts, splitTitle } from '../src/plugins/callouts.mjs';
import { mermaid } from '../src/plugins/mermaid.mjs';
import { buildNoteIndex, pathToUrl } from '../src/plugins/note-index.mjs';

const index = new Map([
	['gke-workload-identity', '/patterns/gke-workload-identity/'],
	['patterns/gke-workload-identity', '/patterns/gke-workload-identity/'],
]);

const render = (md, plugins) => markdownToHtml(md, { mdastPlugins: plugins }).html;

test('wikilinks resolve by name, path, alias and heading', () => {
	const html = render(
		'[[gke-workload-identity]] [[patterns/gke-workload-identity|WI]] [[gke-workload-identity#A - B: C & D]]',
		[wikilinks({ index })],
	);
	assert.match(html, /<a href="\/patterns\/gke-workload-identity\/">gke-workload-identity<\/a>/);
	assert.match(html, /<a href="\/patterns\/gke-workload-identity\/">WI<\/a>/);
	// Same id github-slugger (and so Astro) gives the heading "A - B: C & D".
	assert.match(html, /href="\/patterns\/gke-workload-identity\/#a---b-c--d"/);
});

test('unresolved wikilinks render as text and are reported', () => {
	const missing = [];
	const html = render('see [[missing-note]] here', [wikilinks({ index, onMissing: (m) => missing.push(m) })]);
	assert.equal(html.trim(), '<p>see missing-note here</p>');
	assert.equal(missing.length, 1);
	assert.match(missing[0], /Unresolved wikilink \[\[missing-note\]\]/);
});

test('wikilinks inside inline code are left alone', () => {
	const missing = [];
	const html = render('`[[nope]]`', [wikilinks({ index, onMissing: (m) => missing.push(m) })]);
	assert.match(html, /<code>\[\[nope\]\]<\/code>/);
	assert.equal(missing.length, 0);
});

test('callout types map onto Starlight aside types', () => {
	assert.equal(asideType('warning'), 'caution');
	assert.equal(asideType('Danger'), 'danger');
	assert.equal(asideType('tip'), 'tip');
	assert.equal(asideType('unknown-type'), 'note');
});

test('callout titles keep inline formatting up to the first line break', () => {
	const bold = { type: 'strong', children: [{ type: 'text', value: 'bold' }] };
	const { title, body } = splitTitle([
		{ type: 'text', value: 'Title ' },
		bold,
		{ type: 'text', value: ' here\nfirst body line' },
	]);
	assert.deepEqual(title, [{ type: 'text', value: 'Title ' }, bold, { type: 'text', value: ' here' }]);
	assert.deepEqual(body, [{ type: 'text', value: 'first body line' }]);
});

test('plain blockquotes are not treated as callouts', () => {
	assert.match(render('> just a quote', [callouts]), /<blockquote>/);
});

test('mermaid fences become <pre class="mermaid"> with escaped source', () => {
	const html = render('```mermaid\ngraph TD; A-->B\n```', [mermaid]);
	assert.match(html, /<pre class="mermaid">graph TD; A--&gt;B<\/pre>/);
});

test('URLs follow Astro slugging of each path segment', () => {
	assert.equal(pathToUrl('index.md'), '/');
	assert.equal(pathToUrl('standards/index.md'), '/standards/');
	assert.equal(pathToUrl('misc/Foo.Bar Notes.md'), '/misc/foobar-notes/');
	assert.equal(pathToUrl('tools/C++ & Rust.md'), '/tools/c--rust/');
	assert.equal(pathToUrl('x/y.md', 'custom/path'), '/custom/path/');
});

test('note index skips drafts, honours slug overrides and real content resolves', () => {
	const dir = mkdtempSync(join(tmpdir(), 'notes-index-'));
	mkdirSync(join(dir, 'misc'));
	writeFileSync(join(dir, 'misc', 'Foo.Bar Notes.md'), '---\ntitle: Foo\n---\n');
	writeFileSync(join(dir, 'misc', 'secret.md'), '---\ntitle: Secret\ndraft: true\n---\n');
	writeFileSync(join(dir, 'misc', 'moved.md'), '---\ntitle: Moved\nslug: elsewhere/moved\n---\n');
	const fixture = buildNoteIndex(dir);
	assert.equal(fixture.get('foo.bar notes'), '/misc/foobar-notes/');
	assert.equal(fixture.has('secret'), false);
	assert.equal(fixture.get('moved'), '/elsewhere/moved/');

	const docs = buildNoteIndex(fileURLToPath(new URL('../src/content/docs/', import.meta.url)));
	assert.equal(docs.get('gke-workload-identity'), '/patterns/gke-workload-identity/');
	assert.equal(docs.get('adr/0001-gitops-with-argocd'), '/adr/0001-gitops-with-argocd/');
});
