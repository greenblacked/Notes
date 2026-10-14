# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are the `vX.Y.Z` git tags created by the Release workflow.

## [Unreleased]

### Security

- The build jobs of `ci.yml`, `deploy-stage.yml` and `deploy-production.yml` run with `NPM_CONFIG_IGNORE_SCRIPTS=true`: no install script of our dependencies or of the third-party plugins' npm dependencies runs. The output is identical to a build with scripts.
- `scripts/check-artifact.mjs` (tested by `scripts/check-artifact.test.mjs`) replaces the inline artifact check of the deploy workflows. Besides the expected layout it rejects `public/_redirects`, `public/_headers`, symlinks and any file extension outside an allowlist. It also runs after the build in CI and in both build jobs.
- Deploy production now requires, for tag pushes, manual runs and the call from `release.yml`, a successful `ci.yml` push run for the exact commit and that the commit is on `main` (`compare/main...<sha>` is `identical` or `behind`). The check is shared with `release.yml` (`.github/scripts/require-ci-success.sh`); the guard job has `actions: read` and `contents: read`.
- `deploy-stage.yml`: `GH_TOKEN` is set on the one step that needs it (the re-check of the head of `main` in the `upload` job) instead of on the whole job.
- The `upload` and `deploy` jobs that hold the Cloudflare token no longer install the root dependencies. `--ignore-scripts` alone did not keep third-party code out: `@quartz-community/types` and `@quartz-community/utils` are git dependencies whose `prepare` script npm runs anyway. They now run `npm ci --ignore-scripts --prefix tools` (`tools/package.json` pins only wrangler, with its own lockfile and a Dependabot entry) and call `tools/node_modules/.bin/wrangler`; the scripts they run use only Node built-ins. The build jobs, which hold no secrets, keep the root install.
- The build artifact is `public/` only. `worker/csp.generated.js` is no longer taken from it: the `upload` and `deploy` jobs regenerate it with `scripts/build-csp.mjs` from the checked `public/`, and `check-artifact.mjs --root` fails on a `worker/` directory.
- `require-ci-success.sh` resolves the SHA of `main` first and compares `<main sha>...<commit>` instead of the ambiguous name `main`.
- `npm audit fix` (no `--force`): fflate, js-yaml (gray-matter's copy), immutable, picomatch and source-map-js updated within their ranges; 19 advisories before, 16 after. An `overrides` entry lifts `satori`'s exact pin of `fflate` 0.7.3 (unzipSync DoS) to 0.7.5. What remains needs a breaking change (`globby`, `gray-matter`, `mermaid`, `rehype-katex`, `remark-math`) or an upstream release (`@xmldom/xmldom` pinned by `speech-rule-engine`, `esbuild` pinned by `tsup`).

### Fixed

- A code block inside a list item (the `curl` line in the runbook's numbered steps) sat tight against the text above and below and ran off the right edge: Quartz's `li > *` rule removed the block's margin. Blocks in list items now have the same frame and padding as top-level blocks and a vertical margin; a long line scrolls sideways inside the block (the `<pre>`, which the keyboard can focus) and has room at its end. Tables and callouts in list items get the same margin.
- `scripts/smoke-test.sh` no longer follows redirects: any 3xx is a failure with the status and `Location`. A Cloudflare Access redirect is still detected from the response headers (a notice with `SMOKE_ALLOW_ACCESS=1`, a failure otherwise), but only on a 3xx response: a `Location` header on a 200 is not Access. Tested by `scripts/smoke-test.test.mjs`.
- Note pages no longer open scrolled down. The Explorer's script calls `scrollIntoView` on the open note's entry at load, which scrolled the whole page (about 260px at 1440px wide) when the entry was visible in the sidebar. The list now lives in a fixed, hidden drawer, so there is nothing to scroll; pages open at the top unless the URL has a `#hash`.
- The tag page listed its notes twice; one copy is hidden. The tag index (`/tags`) listed each tag's notes twice as well, and now shows each listing once.
- The closed Browse drawer is inert, so Tab no longer reaches its open folders (the explorer's CSS made them visible again), at every width.
- The top bar keeps its solid band with reduced motion; the fade from transparent applies only without it.
- Following a link to a `#heading` lands the heading below the bar after the layout settles (code and diagram blocks grow after the router scrolls).
- Opening the search (button, Ctrl/Cmd+K) closes the Browse drawer first; Escape and Tab then act on the search only.
- "Skip to content" targets the title instead of the article, and works without JavaScript. The centre column is the `main` landmark, the home section cards are named "Browse by section" (the top bar keeps "Sections") and their headings are level 2.

### Added

- Paper design: the article is a sheet of warm paper on a desk-coloured page, with a subtle grain (an SVG noise tile as a data URI in `quartz/styles/custom.scss`), a layered shadow and a faint margin rule. The sidebars have no panels. The dark theme is "paper at night" (warm charcoal sheet, off-white ink, salmon accent). All text pairs, in both themes, pass WCAG AA.
- `local-plugins/note-index`: the home page shows an index of every note grouped by section, with number and file name, title, type and status chips and the verified (or modified) date, as a table that turns into cards on a phone. Section indexes, the tags pages, 404 and `template.md` files are left out.
- Numbered `##` sections (01, 02, ...) in notes, by CSS counter, with the same numbers in the table of contents.
- Print stylesheet: plain paper without sidebars, buttons and shadow, the address after external links, sidenotes as footnotes, and the light colours in both themes.

### Changed

- Smoother motion. One set of motion tokens in `quartz/styles/custom.scss` (`--dur-fast` 180ms, `--dur` 260ms, `--dur-slow` 380ms, `--dur-theme` 300ms, `--dur-drawer-in` 360ms, `--dur-drawer-out` 260ms; the curves `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--ease-spring`) replaces the ad-hoc durations and `ease`; only `opacity`, `transform`, colours and `box-shadow` are transitioned.
- Page navigation: the sheet's content fades in and rises 6px over 380ms instead of dimming while the next page loads, with no layout shift; the router's scroll to the top is instant. A link to a `#heading` fades without the rise. The top-bar script starts it on the router's `prenav` and `nav` events (no View Transitions API: the router does not expose the DOM swap).
- The Browse drawer slides in over 360ms on a spring-like curve with a fade (the scrim in step) and out over 260ms; its contents stay visible until it has left, and it is still inert when closed.
- Section cards lift 2px with a softer, growing shadow and a border colour change on hover and on keyboard focus; body links ease their underline from thin to 2px; the section pill and table of contents entries fade; the table of contents indicator is one bar that slides between entries.
- Theme toggle: colours, surfaces and the sun/moon icon (which now turns and cross-fades) change over 300ms, only when the theme is switched, never on load. The search overlay fades in with its panel scaling from 98%. The top bar's band comes in over the first 80px of scrolling.
- With `prefers-reduced-motion: reduce` all of it is off: no animation, transition or smooth scrolling, and the top bar's band stays solid.
- Light by default: `scripts/postprocess-build.mjs` now makes the first visit light (it was dark). A saved toggle choice still wins, and the OS theme is not followed at all. It still fails when it does not recognise the darkmode script.
- Fonts: Source Serif 4 (400, 600, italic; latin, latin-ext and cyrillic) for all text and IBM Plex Mono for code, replacing IBM Plex Sans, Plex Sans Condensed and Literata. A page loads 76 KB of fonts for Latin text: three Source Serif 4 files (62 KB) and IBM Plex Mono (15 KB). Body text is 1.125rem with a 66ch measure and old-style numerals.
- The metadata strip above the title is now a spec sheet under it: a ruled list of label and value pairs (type, status, decided, verified, modified, reading time). It is a definition list, and `verified` is shown as a full date. The date line of the content-meta plugin is hidden where the sheet has the modified date.
- Printing uses the light palette whatever the saved theme, chips and status colours included.
- The home index lists notes at the top level of `content/` under "Other notes", and switches to cards on phones even where container queries are unsupported.
- `quartz/styles/custom.scss` is rewritten for the paper design (callouts, code blocks, tables, graph, search, explorer, backlinks, table of contents, sidenotes), with `:focus-visible`, `prefers-reduced-motion` and a single-column layout below 800px. The table of contents comes first in the right sidebar.
- `scripts/check-contrast.mjs` checks the new tokens: body, muted, link, hover, chip, code, callout title and focus-ring pairs on the sheet (including the strongest grain), the desk and the surface tint, in both themes. The light syntax theme's comment colour is darkened in CSS to stay above AA.
- `content/index.md` keeps its introduction and drops the section table and the "Start with these" list, which the index replaces. `content/standards/writing-notes.md` describes the metadata sheet, the numbered sections and the home index.
- `docs/screenshots/` holds new screenshots (home, runbook in light and dark, phone).

- `quartz plugin restore` exits non-zero when a plugin fails to build or install, instead of continuing with a partial set. The vendored `quartz/cli/plugin-git-handlers.js` is patched locally; `scripts/update-quartz.sh` notes this.
- `docs/deployment.md` states that on a tag push or tag dispatch the workflow file and guard script come from the tagged commit, so the guard only catches mistakes; the controls for creating production tags are the `v*` tag ruleset and required reviewers on the `production` environment ("Prevent self-review" when more than one person has access). The "rely on the guard for creations" fallback is removed. The rollback drill notes that tags from before the CI check have no such step and that a very old tag needs its `ci.yml` run record to still exist.

- `docs/deployment.md`: "Repository settings you must apply" (rulesets for `main` and `v*` tags, environment branch policies, optional separate stage token) and a one-time `wrangler rollback` drill.
- Modern, smoother design. The always-open Explorer sidebar is gone: a slim sticky top bar (`local-plugins/top-bar`) has the wordmark, section links with the current section highlighted, search and the theme toggle, and a **Browse** button that opens the Explorer as a drawer at every width (Escape, outside click, focus kept inside while open). The bar blurs on scroll and shows reading progress with CSS scroll-driven animations. The reader mode is removed (one centred column leaves nothing to hide).
- One centred reading column with the table of contents sticky beside it (the entry being read is highlighted); the local graph moves to the end of the note, under a new "Linked from" block (`local-plugins/linked-from`, replaces the Backlinks plugin). Sidenotes now appear from 1280px.
- Softer paper: lighter grain, a diffuse shadow, rounded corners, thinner and lighter rules, no margin line. Inter (self-hosted variable font) for the interface; Source Serif 4 stays for reading text.
- Home page: a short intro, a card per section (description, note count, last update) and then the index of notes. The home text now names the real search shortcut (Ctrl+K), not `/`.
- Polish: tags are light chips (no `#`, no capitals), the stray alias line under the tags is gone, tidier spacing between title, lede, tags and metadata, slash breadcrumbs, rounded tables, callouts and code blocks with a quieter caption and copy button, footnotes with a visible label, a styled search overlay and link previews, a 404 page with the top bar, section and tag page rows, a skip link, a phone-friendly search result and tables that scroll inside their frame.
- Motion: smooth anchor scrolling below the bar, hover and focus transitions, colours that fade when the theme is toggled, and a soft fade of the page content on SPA navigation, all disabled under `prefers-reduced-motion`.

### Removed

- Section tabs (`local-plugins/section-tabs`): the numbered table of contents makes them redundant.
- The "Recently updated" list and the `recent-notes` plugin (also from `quartz.lock.json`): the index shows every note with its date.
- `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-sans-condensed` and `@fontsource/literata`.
- The previous screenshots in `docs/screenshots/` (`phone-dark.png` and the old light and dark ones).

## [0.3.0] - 2026-10-11

### Added

- Metadata strip above the title, from the frontmatter fields `type`, `status`, `verified` and `decided` (plus reading time), as a local plugin (`local-plugins/note-meta`). It renders nothing on pages without those fields. The fields are documented in `content/standards/writing-notes.md` and the ADR template, and set on all existing notes.
- Section tabs: anchor links to the `##` sections under the title of notes with three or more of them, from 800px up (`local-plugins/section-tabs`, from the table of contents data).
- Sidenotes: from 1200px up, Markdown footnotes appear in the margin next to their reference, with no script and no CSP change (`local-plugins/sidenotes`); narrower screens, link previews and pages with a footnote that cannot sit in the margin keep the normal footnotes.
- Self-hosted IBM Plex Sans, Plex Sans Condensed, Plex Mono and Literata (woff2 from `@fontsource`, latin, latin-ext and cyrillic subsets, `font-display: swap`), copied to `/static/fonts` by `scripts/postprocess-build.mjs`.
- Code block filename captions (`title="..."` on a fence) and a restyled copy button, which also shows on keyboard focus and on touch screens.
- `npm run check:contrast` (`scripts/check-contrast.mjs`): WCAG AA contrast of all text and background pairs in both themes, as a Markdown table; exits 1 on failure. Runs in CI.
- `scripts/sidenotes.test.mjs`, run by `npm run test:scripts`.
- Screenshots of both themes and the phone layout in `docs/screenshots/`.

### Changed

- Redesigned theme: dark by default (a saved theme toggle still wins; the system theme is no longer followed), new light and dark palettes, sidebars and article on bordered surface panels, Literata article text at 17px, 1.7 line height and a 68ch measure, headings in IBM Plex Sans Condensed.
- Callouts have an accent left border (warning colour for warning-like types) on a surface background; code blocks use a raised surface and the high-contrast GitHub syntax themes so every token passes AA.
- `status` frontmatter values are lowercase (`accepted`, not `Accepted`). The reading time moved from the content-meta plugin to the metadata strip.
- Visible `:focus-visible` outlines everywhere, and transitions and animations are off under `prefers-reduced-motion`.
- The mobile explorer menu is pinned to the viewport, so it no longer adds 16px of horizontal overflow.

## [0.2.0] - 2026-10-11

### Added

- Runbooks section with a runbook for deploying to and rolling back on Cloudflare Workers, and the `runbooks` tag.
- "Recently updated" list on the home page: the five most recently modified notes (section index pages and the tags page excluded), from the `recent-notes` plugin.

### Fixed

- Release notes list each change as `* <PR title> (#N)`, without `by @user` mentions or the New Contributors block.
- Smoke test retries the content, header and indexing checks after `/version.txt` matches, so a route that is still propagating (Cloudflare error 1042 on a fresh workers.dev route) no longer fails a deploy or triggers a rollback.
- Stage smoke test passes with a notice when the Preview sits behind Cloudflare Access; production still fails on an Access redirect.

## [0.1.0] - 2026-10-11

### Changed

- Single Worker `notes`: stage is now the Worker Preview `stage` (`wrangler preview`, served at stage.notes.szolotov.com through `previews_enabled` on the Custom Domain) instead of the separate `notes-stage` Worker. Only production on notes.szolotov.com is indexable; every other host sends `noindex`. Deploys are verified on the workers.dev URLs (Cloudflare Bot Fight Mode blocks CI on the custom domains), Wrangler output is parsed by `scripts/read-wrangler-output.mjs`, and `STAGE_SMOKE_TEST=false` skips the stage smoke test. The site title is now just "Notes". Migration steps: docs/deployment.md.

### Added

- Notes site built with a vendored Quartz v5: content for ADRs, platform patterns, tools and standards, Obsidian-compatible Markdown.
- Cloudflare Worker serving the static build with security headers, `robots.txt` handling and `/version.txt`; production at notes.szolotov.com and staging at stage.notes.szolotov.com.
- CI workflow: type check, build, link check, format check, deploy dry run, actionlint and zizmor, with the aggregate required check `CI OK`.
- Staging deployment on every push to `main`, with a guard against stale runs and a post-deploy smoke test.
- Manual Release workflow (version validation, CI gate, annotated tag, GitHub Release) and tag-only production deployment with environment approval, smoke test and automatic rollback.
- Dependabot configuration, CODEOWNERS and `scripts/smoke-test.sh`.
- Documentation: README, deployment guide and Obsidian guide.
