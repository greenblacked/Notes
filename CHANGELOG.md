# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are the `vX.Y.Z` git tags created by the Release workflow.

## [Unreleased]

### Added

- A **Repository settings** workflow (manual, from `main`, owner only, with a dry run) that applies the branch rulesets for `dev` and `main`, the environment branch policies (environment `stage` limited to `dev`; retired `dev` and `staging` environments deleted) and the fork approval policy.
- 50 new notes, all Markdown in `content/`:
  - a new **Architecture** section (`content/architecture/`, in the top bar and on the home page) with 13 reference designs: GCP resource hierarchy and landing zone, environment separation, IAM groups and CI Workload Identity Federation, Shared VPC hub and spoke, private GKE and controlled egress, Cloud DNS for hybrid and multi-project setups, zero-trust access with IAP and VPC Service Controls, GKE platform topology and tenancy, GitOps repository topology and promotion, disaster recovery tiers, backup architecture, the OpenTelemetry pipeline, and FinOps cost allocation;
  - a new **Compliance** section (`content/compliance/`, in the top bar and on the home page) with 11 notes: change management controls and pipeline evidence, audit evidence collection and retention, separation of duties, access reviews, CIS benchmarks with kube-bench, GCP organization policy guardrails, the policy exception and waiver process, SBOM generation and storage, SLSA build provenance, open-source licence compliance, and PCI DSS and GDPR for DevOps logs and data;
  - a new **AI in DevOps** section (`content/ai/`, in the top bar and on the home page) with 6 notes: securing AI agents in CI and cloud, an AI-generated code policy and provenance, AI code review bots, AI-assisted incident response, rolling out AI tools in a team, and agent skills and shared workflows;
  - 12 patterns: progressive delivery with Argo Rollouts, Kubernetes autoscaling, Linux host hardening with Chef and InSpec, a Conftest policy gate for manifests, Terraform plan policy checks, image signing and admission verification, GitLab runners on GKE, Jenkins controller and agent hardening, secret scanning, release versioning and changelog automation, Terraform testing, and Helm chart CI quality gates;
  - 3 tool comparisons: Argo Rollouts vs Spinnaker, Gatekeeper vs Kyverno vs ValidatingAdmissionPolicy, and service mesh on GKE;
  - 3 runbooks: network troubleshooting (DNS, MTU, TLS, load balancers), policy rollout from audit to enforce, and Chef to immutable images;
  - 2 standards: structured logging conventions, and change freezes and maintenance windows.
- 30 senior and engineering-manager notes, all Markdown in `content/`, linked from their section indexes:
  - 7 standards: production readiness review, error budget policy and release gating, toil budget, vulnerability management SLAs, platform threat modelling, artifact retention, and a Bash script standard;
  - 12 patterns: zero-downtime Postgres migrations, Postgres connection pooling on GKE, stateful workloads on GKE, Kubernetes node sysctls, test sharding and flaky tests, timeouts, retries and load shedding, load and performance testing, Cloud KMS key management, GCP audit logs and SIEM feeds, Cloudflare cache strategy, edge WAF and rate limiting, and Cloudflare Access service tokens;
  - 5 runbooks: compromised cloud cluster containment, node resource pressure triage, Kubernetes packet capture, game days and chaos experiments on GKE, and HA VPN and BGP troubleshooting;
  - 6 management notes: team charter, cross-team dependencies, inner-source contribution model, engineering budget planning, quarterly engineering review, and team reorganisation.
- A new **Learn** section (`content/learn/`, last in the top bar and on the home page) with a learning path index and 43 lessons from first steps to middle level: lab setup, Linux, networking, Git, scripting, containers, Kubernetes, Google Cloud, CI/CD and Terraform, security, observability and on-call. The lesson structure and the `learning` tag are documented in `content/standards/writing-notes.md`.
- A `reference` note type (shown as "Reference") and new tags `architecture`, `compliance`, `ai`, `spinnaker`, `chef`, `opentelemetry`, `linux`, `supply-chain`, `policy-as-code` and `audit` in the taxonomy (see `content/standards/writing-notes.md`).

### Changed

- The pre-production site is **stage** again, at https://stage.notes.szolotov.com (the Worker Preview `stage`, behind Cloudflare Access). **Deploy stage** (`deploy-stage.yml`) runs only by hand (`workflow_dispatch`), only from the `dev` branch, only for the owner; merges into `dev` or `main` deploy nothing. Work goes in through pull requests into `dev`, then `dev` to `main` with a merge commit; production releases are unchanged. CI runs for `dev` too, and Dependabot targets `dev`. dev.notes.szolotov.com is retired (one-time `retire_dev` input).
- Deploy stage refuses to upload unless the Cloudflare API shows an Access application covering stage and no Custom Domain or DNS record for the host. After the upload, the workers.dev Preview URL must redirect to Access, otherwise the Preview is deleted (`SMOKE_REQUIRE_ACCESS` in `scripts/smoke-test.sh`, `scripts/cloudflare-stage.mjs`). `DEV_SMOKE_TEST` is gone.
- `/version.txt` on stage reads `stage+<sha>`; `NOTES_VERSION` accepts `stage` instead of `dev`; `npm run preview:dev` is `npm run preview:stage`.
- A Deploy stage run fails (instead of skipping) when `dev` moved on during the run.
- The one-time `remove-stage` action is removed.
- TypeScript 7.0.2 (native compiler) for `npm run check`; `tsconfig.json` uses `moduleResolution: "bundler"` (node10 was removed), types `micromorph` through `paths`, and `quartz/processors/parse.ts` takes the mdast `Root` type from `@types/mdast`.
- `engines.node` is `>=22.12.0` (required by mermaid 12); `lodash-es` is overridden to `^4.18.1` (see Security).
- The `DataMap.frontmatter` type is now inherited from `@quartz-community/types` 1.0, where `tags` is optional and `description`, `socialDescription` and `lang` are declared there; the build output is unchanged.
- mermaid 12.0.0 (diagrams in the browser, from `public/static/vendor/mermaid`), @types/node 26.6.3, @napi-rs/simple-git 1.2.0.

### Fixed

- `@quartz-community/utils` 1.0.1 now comes from the npm registry: the upstream git head no longer builds `dist/` on install, which broke type checks and the build. The `DataMap.frontmatter` declaration in `quartz/plugins/index.ts` is dropped because `@quartz-community/types` 1.0 declares it. `@quartz-community/types` is now a direct registry dependency (^1.0.0) so that declaration no longer depends on a nested copy. `quartz/util` imports the `@quartz-community/utils/path`, `/lang` and `/escape` subpaths, so the client bundle (`postscript.js`) does not pull in the utils barrel and its preact copy.

### Security

- `@quartz-community/utils` and `@quartz-community/types` are no longer git dependencies (both resolve from the npm registry), so no `prepare` script of ours runs during the root install and the lockfile has no git-resolved package.
- `lodash-es` is overridden to `^4.18.1` because chevrotain, pulled in by mermaid 12, pins `lodash-es` 4.17.23, which has a high advisory.

## [0.4.0] - 2026-10-16

### Added

- 44 new notes for DevOps work and engineering management, all Markdown in `content/`:
  - a new **Management** section (`content/management/`, in the top bar and on the home page) with 14 guides: first 90 days as an EM, delegation, platform team operating model, one-on-ones, onboarding, hiring, career ladder, feedback, conflict, planning, DORA metrics, tech debt, stakeholder communication and on-call health;
  - 14 patterns: Pod Security admission, automated dependency and image updates with Renovate, GitLab CI pipeline structure, Jenkins shared libraries, SonarQube quality gates, Artifactory promotion, Dockerfile hardening, Helm chart conventions, resource requests and limits, zero-downtime deployments, network policies, External Secrets with Secret Manager, Terraform module and state layout, SLO burn-rate alerting;
  - 8 runbooks: Argo CD sync failure and drift, incident response, leaked credential rotation, TLS certificate renewal, Kubernetes pod troubleshooting, Helm release rollback, GKE cluster upgrade, Terraform state recovery;
  - 4 tool comparisons (GitLab CI vs Jenkins, Helm vs Kustomize, Terraform vs OpenTofu, Prometheus vs Cloud Monitoring) and 3 standards (production change checklist, code review, blameless postmortems).
- A `guide` note type (shown as "Guide"), and new tags for platforms (`terraform`, `helm`, `docker`, `gitlab-ci`, `jenkins`, `artifactory`, `sonarqube`, `prometheus`), concerns (`ci-cd`, `incident-management`, `on-call`, `cost`) and people topics (`leadership`, `hiring`, `career`, `team-process`, `delivery`) in the taxonomy.
- Dev Preview: `deploy-dev.yml` deploys the Worker Preview `dev` at https://dev.notes.szolotov.com. It is the pre-production site and runs only manually (`workflow_dispatch`), only from `main`, when the owner asks for it; a `guard` job fails every other ref. `is-main-head.sh` takes the branch from `BRANCH` (default `main`), and `read-wrangler-output.mjs --preview` also prints the Preview's `custom_url`.

### Security

- The build jobs of `ci.yml`, `deploy-dev.yml` and `deploy-production.yml` run with `NPM_CONFIG_IGNORE_SCRIPTS=true`: no install script of our dependencies or of the third-party plugins' npm dependencies runs. The output is identical to a build with scripts.
- `scripts/check-artifact.mjs` (tested by `scripts/check-artifact.test.mjs`) replaces the inline artifact check of the deploy workflows. Besides the expected layout it rejects `public/_redirects`, `public/_headers`, symlinks and any file extension outside an allowlist. It also runs after the build in CI and in both build jobs.
- Deploy production now requires, for tag pushes, manual runs and the call from `release.yml`, a successful `ci.yml` push run for the exact commit and that the commit is on `main` (`compare/main...<sha>` is `identical` or `behind`). The check is shared with `release.yml` (`.github/scripts/require-ci-success.sh`); the guard job has `actions: read` and `contents: read`.
- `deploy-dev.yml`: `GH_TOKEN` is set on the one step that needs it (the re-check of the head of `main` in the `upload` job) instead of on the whole job.
- The `upload` and `deploy` jobs that hold the Cloudflare token no longer install the root dependencies. `--ignore-scripts` alone did not keep third-party code out: `@quartz-community/types` and `@quartz-community/utils` are git dependencies whose `prepare` script npm runs anyway. They now run `npm ci --ignore-scripts --prefix tools` (`tools/package.json` pins only wrangler, with its own lockfile and a Dependabot entry) and call `tools/node_modules/.bin/wrangler`; the scripts they run use only Node built-ins. The build jobs, which hold no secrets, keep the root install.
- The build artifact is `public/` only. `worker/csp.generated.js` is no longer taken from it: the `upload` and `deploy` jobs regenerate it with `scripts/build-csp.mjs` from the checked `public/`, and `check-artifact.mjs --root` fails on a `worker/` directory.
- `require-ci-success.sh` resolves the SHA of `main` first and compares `<main sha>...<commit>` instead of the ambiguous name `main`.
- `npm audit fix` (no `--force`): fflate, js-yaml (gray-matter's copy), immutable, picomatch and source-map-js updated within their ranges; 19 advisories before, 16 after. An `overrides` entry lifts `satori`'s exact pin of `fflate` 0.7.3 (unzipSync DoS) to 0.7.5. What remains needs a breaking change (`globby`, `gray-matter`, `mermaid`, `rehype-katex`, `remark-math`) or an upstream release (`@xmldom/xmldom` pinned by `speech-rule-engine`, `esbuild` pinned by `tsup`).

### Fixed

- `postprocess-build.mjs` no longer fails the build when a note shows a Google API URL inside a code block (an OIDC audience in the Terraform CI example). Text in `<pre>` and `<code>` is skipped in HTML; any other reference to a third-party CDN or font host still fails it.
- From 800px to 1199px the sheet ran to the window's edges with no gutter (on the home page before, on every page once all pages share its width). It now keeps a 1rem gutter on each side.
- The Browse drawer no longer flashes open after a click on a link or when a page loads. Quartz's explorer script leaves the explorer neither loading nor collapsed for an instant (it removes `hide-until-loaded`, reads the layout, then adds `.collapsed`), and the CSS drew that instant as open. The drawer is now drawn open only with `data-open`, which the top-bar script sets from a MutationObserver once each change is complete.
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

- Every page now uses the home page's 68rem sheet, the text fills it, sidenotes sit inside the sheet and the table of contents stays beside it.
- The Browse drawer opens from the right edge, the side of its button in the top bar, instead of the left.
- Wider page: the reading column (`--measure`) is 46rem instead of 38rem, and 52rem from 1500px; the home sheet is 68rem instead of 60rem. Long code lines and tables fit without scrolling more often; the table of contents and sidenotes still sit beside the sheet without overlap at 1280px and wider.
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
- No stage environment any more: `dev` (https://dev.notes.szolotov.com, the Worker Preview `dev`) is the pre-production site. Deploy dev is manual only (`workflow_dispatch`) and only from `main`, with no push trigger and no `dev` branch; its upload job checks out the `main` commit (`github.sha`) and runs the smoke test as before. Feature previews happen outside CI. The flow is: feature branch, preview by the maintainer, merge to `main`, manual Deploy dev, Release tag, production.
- The `STAGE_SMOKE_TEST` variable is now `DEV_SMOKE_TEST`, and the GitHub environment `dev` (branch `main` only) replaces `staging`.
- `ENVIRONMENT` in `previews.vars` of `wrangler.jsonc` is `preview` instead of `stage`. The Worker only compares it with `production`, so behaviour is the same: only production on `notes.szolotov.com` is indexable.
- `npm run preview:stage` is now `npm run preview:dev` (`ENVIRONMENT:preview`, same port).
- `read-wrangler-output.mjs --preview` no longer prints `stage_url`; `custom_url` and `workers_dev_url` remain.
- The runbook `content/runbooks/cloudflare-workers-deploy-and-rollback.md`, `docs/deployment.md`, `README.md` and `content/standards/index.md` describe the new flow.

- `quartz plugin restore` exits non-zero when a plugin fails to build or install, instead of continuing with a partial set. The vendored `quartz/cli/plugin-git-handlers.js` is patched locally; `scripts/update-quartz.sh` notes this.
- `docs/deployment.md` states that on a tag push or tag dispatch the workflow file and guard script come from the tagged commit, so the guard only catches mistakes; the controls for creating production tags are the `v*` tag ruleset and required reviewers on the `production` environment ("Prevent self-review" when more than one person has access). The "rely on the guard for creations" fallback is removed. The rollback drill notes that tags from before the CI check have no such step and that a very old tag needs its `ci.yml` run record to still exist.

- `docs/deployment.md`: "Repository settings you must apply" (rulesets for `main` and `v*` tags, environment branch policies, optional separate dev token) and a one-time `wrangler rollback` drill.
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
- `deploy-stage.yml`, the Preview `stage` and its `staging` environment. Delete the existing Preview once with Deploy dev, action `remove-stage` (a new `workflow_dispatch` choice; harmless to re-run when the Preview is already gone).

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
