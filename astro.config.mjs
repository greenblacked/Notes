// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import { buildNoteIndex } from './src/plugins/note-index.mjs';
import { wikilinks } from './src/plugins/wikilinks.mjs';
import { callouts } from './src/plugins/callouts.mjs';
import { mermaid } from './src/plugins/mermaid.mjs';
import { deployEnv, resolveDeployEnv } from './src/integrations/deploy-env.mjs';

// DEPLOY_ENV selects the target: "production" (default) or "stage".
// Stage builds get a noindex meta tag, X-Robots-Tag header and a
// disallow-all robots.txt; production builds get none of them.
const env = resolveDeployEnv(process.env.DEPLOY_ENV);
const strictLinks = process.env.STRICT_LINKS === '1';
const missingLinks = new Set();
const docsDir = fileURLToPath(new URL('./src/content/docs/', import.meta.url));

export default defineConfig({
	site: env.siteUrl,
	trailingSlash: 'always',
	markdown: {
		processor: satteri({
			mdastPlugins: [
				wikilinks({
					index: buildNoteIndex(docsDir),
					onMissing: (message) => {
						missingLinks.add(message);
						console.warn(`[notes-wikilinks] ${message}`);
					},
				}),
				callouts,
				mermaid,
			],
		}),
	},
	integrations: [
		starlight({
			title: 'Notes — Serhii Zolotov',
			description: 'Architecture decisions, platform patterns, and operational notes',
			lastUpdated: true,
			pagination: true,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
			customCss: ['./src/styles/custom.css'],
			head: env.noindex ? [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }] : [],
			components: {
				Footer: './src/components/Footer.astro',
			},
			sidebar: [
				{ label: 'Start here', items: [{ label: 'Home', link: '/' }, { label: 'Tags', link: '/tags/' }] },
				{ label: 'Architecture decisions', items: [{ autogenerate: { directory: 'adr' } }] },
				{ label: 'Patterns', items: [{ autogenerate: { directory: 'patterns' } }] },
				{ label: 'Tools', items: [{ autogenerate: { directory: 'tools' } }] },
				{ label: 'Standards', items: [{ autogenerate: { directory: 'standards' } }] },
			],
		}),
		deployEnv(env),
		// Broken wikilinks fail CI and deploy builds (STRICT_LINKS=1) but only
		// warn while writing locally. Failing here, not in the plugin, is what
		// makes the build exit non-zero (see src/plugins/wikilinks.mjs).
		{
			name: 'notes-strict-links',
			hooks: {
				'astro:build:done': () => {
					if (strictLinks && missingLinks.size > 0) {
						throw new Error(`${missingLinks.size} unresolved wikilink(s):\n${[...missingLinks].join('\n')}`);
					}
				},
			},
		},
	],
});
