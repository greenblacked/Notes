# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are the `vX.Y.Z` git tags created by the Release workflow.

## [Unreleased]

### Added

- Metadata strip above the title, from the frontmatter fields `type`, `status`, `verified` and `decided` (plus reading time), as a local plugin (`local-plugins/note-meta`). It renders nothing on pages without those fields. The fields are documented in `content/standards/writing-notes.md` and the ADR template, and set on all existing notes.
- Section tabs: anchor links to the `##` sections under the title of notes with three or more of them, on desktop widths (`local-plugins/section-tabs`, from the table of contents data).
- Sidenotes: from 1200px up, Markdown footnotes appear in the margin next to their reference, with no script and no CSP change (`local-plugins/sidenotes`); narrower screens keep the normal footnotes.
- Self-hosted IBM Plex Sans, Plex Sans Condensed, Plex Mono and Literata (woff2 from `@fontsource`, latin, latin-ext and cyrillic subsets, `font-display: swap`), copied to `/static/fonts` by `scripts/postprocess-build.mjs`.
- Code block filename captions (`title="..."` on a fence) and a restyled copy button, which also shows on keyboard focus and on touch screens.
- `npm run check:contrast` (`scripts/check-contrast.mjs`): WCAG AA contrast of all text and background pairs in both themes, as a Markdown table; exits 1 on failure. Not wired into CI.
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
