# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are the `vX.Y.Z` git tags created by the Cut release workflow.

## [Unreleased]

### Added

- **Start here on the home page and an All notes page.** The home page now offers four reader goals (resolve an operational problem, design or improve a platform, develop engineering skills, lead a platform team) with the section cards below, and the full note catalogue moved to `/all-notes`, linked from the first screen. The anchors `#note-index-title` and `#note-index-<section>` still work on the home page.
- **Authorship on every note.** After the note text (and its Linked from list) a quiet credit line names the author and links the AI skills catalogue. Plain links, no form or script; hidden in print. Folder, tag and 404 pages have none.
- **Stage and lesson navigation** on the learning path. Under the spec sheet, each lesson shows its stage (linked to the stage on the learning path), its place ("Lesson 31 of 43", or "Optional lesson 5 of 10" for the going-deeper lessons) and links to the previous and next lesson. The order lives in `local-plugins/note-meta/learn-path.json`, and a script test keeps it equal to the lists on the learning path index and to the hand-written next and previous links. The index gains a short list that jumps to each of the twelve stages.
- **Evidence levels for notes.** A note can declare `evidence` (`source-reviewed`, `lab-tested` or `operationally-verified`), `reviewed`, `review-due` and `destructive` in its frontmatter, with a matching `## Evidence` section in the body (sources checked, what was not verified, and for runbooks, destructive and tested notes the environment, prerequisites, expected results, failure conditions and cleanup). `npm run check:notes` enforces the rules in CI and prints a review queue (overdue, due within 30 days, changed since review, no level) in the run summary. The spec sheet shows Evidence and Reviewed.
- **Deploy stage** checks through the Cloudflare API that the stage Preview's latest deployment is the one the run uploaded (deployment id, the commit SHA as tag, the message `stage <sha7>`). Any mismatch, including a different latest deployment, fails the run and takes stage down; the API gives no ordering evidence between deployments, so a different one is never assumed to be newer.
- Deploy stage reports `stage_result` (`verified`, `uploaded-active`, `failure` or `skipped`) as the output of its `result` job, as a `stage_result=<level>` line in the run summary and as a notice. A skipped upload (main moved on) is `skipped`; a failed or cancelled build or upload is `failure`.
- **Browser smoke tests** (`npm run test:browser`, Playwright in Chromium and WebKit at desktop and phone sizes) against the built site served through the Worker. They cover the home page (no console errors, no sideways scroll), the search shortcut, the Browse drawer, the theme toggle, section navigation and Back, the tucking section row, keyboard folding of callouts and the graph dialog. CI runs them in the new Browser smoke tests job, which CI OK requires (so it also gates releases).
- 160 new notes across all sections: 50 architecture decision records (0002 to 0051, covering Artifactory, CI/CD, the Kubernetes platform, GCP foundations, infrastructure as code, security and supply chain, observability, and operations and release), 20 tool comparisons and deep dives, 15 patterns, 15 runbooks, 10 standards, 10 reference architectures, 10 compliance notes, 10 management guides, 10 AI notes and 10 learning lessons, with more Artifactory and wider DevOps tooling coverage. Their section indexes list them.

### Changed

- **Documented the measured CI timings and the Actions minute budget.** `docs/deployment.md` now describes the CI job graph, why CI cannot finish in 2 minutes with every check kept, the shard count and its minute cost, and replaces the "about 15 minutes" for a cold build with the measured 7 to 8 minutes on 4-core runners.
- **CI checks formatting in the first Chromium desktop browser job** instead of the build job. It needs no build output, and the build job is the start of the critical path, so the check no longer delays the browser jobs.
- **CI browser tests run as a matrix of eight jobs** (each of the four Playwright projects in two shards) instead of one job that runs all four in sequence, so the wall-clock time is the slowest shard. Every test still runs on Chromium and WebKit at desktop and phone sizes; a failed shard does not cancel the others (`fail-fast: false`), so re-running one flaky shard costs about 3 billed minutes instead of a full browser run, and each shard installs and caches only its own browser. Each job bills at least one minute, so this uses more Actions minutes per run.
- The smoke test User-Agent names the site (`notes-smoke-test/1 (+https://notes.szolotov.com)`) instead of the source repository, which is private.
- Ten high-risk notes were reviewed against official sources and now declare an evidence level and an `## Evidence` section: the leaked credential rotation, TLS certificate renewal, admission webhook certificate expiry, Terraform state recovery and compromised cluster containment runbooks, the secret rotation and Artifactory token patterns, and the three AI agent notes. Several steps were corrected (for example the Terraform state push rollback, fork pipelines for CI agents, and Artifactory token revocation), and destructive steps gained warnings and rollback notes.
- The Deploy stage `stage_result` output is `failure` when a step before the freshness check fails, and when the teardown ran after a level was decided (for example a cancelled run), instead of empty or a stale `verified`.
- Deploy stage no longer reports `stage serves <sha>` unconditionally, and says the content was checked only when the smoke test read it. With workers.dev behind Cloudflare Access the result is `uploaded-active`. The teardown step is now named "Take stage down after a failed check".
- **Cut release** also requires that the most recently executed Deploy stage run for the commit on `main` finished successfully and updated stage; otherwise it refuses and links the run. The release run summary records the Deploy stage run and the commit checked. The only exception is the first release: while no `vX.Y.Z` tag exists yet the check is skipped with a notice (stage needs the custom domain that the first production deploy creates); once any such tag exists it is always enforced, and it fails if the tag lookup itself errors.
- Stage and every host but production on `notes.szolotov.com` now serve a crawlable `robots.txt` (`User-agent: *`, `Allow: /`, no sitemap) instead of `Disallow: /`, and keep `X-Robots-Tag: noindex, nofollow` on every response. A crawler that may not fetch a page never sees its noindex, so a blocked page could still be indexed by its URL. `scripts/smoke-test.sh` in `noindex` mode now requires noindex on `/` and on `robots.txt`, and fails on `Disallow: /` or a `Sitemap:` line. Production is unchanged.
- The Preview deployment check (`scripts/verify-preview-deployment.mjs`) makes at most 5 requests in total, one loop where network errors, HTTP 429/5xx, a stale deployment id, a missing-preview answer (API 10025/10222) and missing annotations on this run's deployment share the same budget (before: up to 25 requests with nested retries). Worst case is about 160 seconds, well under the upload job's 15-minute timeout.
- The status of a note is no longer shown on the site: the Status column of the home page index, the Status chip in the spec sheet under the title and the Status column of the ADR records table are gone. The `status` frontmatter field is unchanged. The index has four columns on wide screens, and the phone card shows the type and number on its first line.
- **Private repository.** Deploy workflows read the repository secret `CLOUDFLARE_API_TOKEN` and the repository variable `CLOUDFLARE_ACCOUNT_ID` (no fallback to an account-id secret). Deploy production no longer waits for environment approval; its guard accepts only the owner or a Cut release run of the owner for the same commit.
- CI uses fewer Actions minutes: the attribution check runs in the workflow lint job, the Deploy stage guard is the first build step, Playwright browsers are cached and Dependabot version updates are monthly. Every gate CI OK requires still runs, with Chromium and WebKit.
- The deploy probes send the User-Agent `notes-smoke-test/1 (+https://notes.szolotov.com)`.

### Fixed

- Changing the theme no longer makes the top bar's theme icon jump: inside the desktop cross-fade the icons are swapped by the fade itself (no second turn that outlasts it), and on phones the icon turns without overshooting.

## [0.6.0] - 2026-10-19

### Added

- **Cleanup deployments** (`cleanup-deployments.yml`, manual, from `main`, owner only): deletes the old deployment records of `dev`, `staging` and `repo-admin` and the failed ones of `stage`, so the Deployments list shows only `stage` and `production`. It never touches `production`.
- **Delete merged branches** (`delete-merged-branches.yml`, manual, from `main`, owner only, dry run by default): deletes branches merged into `main` at their current head and the leftover branches named in its `extra` input (default `dev feature/notes-site`). It never deletes `main`, the default branch, Dependabot branches, protected branches or branches with an open pull request, and lists every decision with the branch head in the job summary.

### Changed

- Switching between light and dark is near-instant: the page cross-fades as one snapshot (180ms) on devices with a mouse or trackpad where the browser supports view transitions; phones and tablets, and anyone with reduced motion, get a one-frame flip, instead of fading thousands of elements one by one.
- The section links row of the top bar slides away while reading down a page and comes back on scrolling up or at the top. It stays while it has keyboard focus, while the Browse drawer or search is open, on short landscape windows and without JavaScript. Nothing on the page moves when it hides.
- The GitHub environment of Deploy stage is now `stage` (was `staging`); the repository secrets are shared, and a `main`-only branch policy on `stage` is recommended.
- The stage site is public and not indexed: no Cloudflare Access. The Worker sends `X-Robots-Tag: noindex, nofollow` and a disallow-all `robots.txt` on every host but production on `notes.szolotov.com`. Deploy stage smoke-tests the workers.dev Preview URL for the real site (HTTP 200, the expected version, noindex) and fails on any redirect except the Cloudflare Access login of that workers.dev URL, which it reports as a notice and skips the content checks (`SMOKE_ACCEPT_ACCESS=1`, see Fixed).
- Deploy stage deletes the old Preview `dev` when it still exists (idempotent).
- Callouts are redrawn as typeset asides: a thin rule in the type's tone (double for danger, failure and bug), an italic serif kind label run into the text, and no tinted box, icon or capitals. Note, info and example differ by their label. Danger has its own tone (`--danger`, AA in light and dark, checked by `check:contrast`).

### Removed

- The Cloudflare Access steps of Deploy stage (`scripts/cloudflare-stage.mjs` with its ensure, preflight and retire commands) and the `SMOKE_ALLOW_ACCESS` and `SMOKE_REQUIRE_ACCESS` switches of `scripts/smoke-test.sh`. The Cloudflare token needs no Access permission.

### Fixed

- Folded callouts can be opened with the keyboard (Tab, Enter or Space), announce whether they are expanded, keep hidden answers out of the tab order and away from screen readers, and fold the first paragraph too, including in old browsers that send only `keyCode`.
- Deploy stage deploys stage on every merge to `main` again; it no longer stops at a Cloudflare Access step the token cannot run.
- Deploy stage no longer fails and deletes the stage Preview when the Cloudflare account protects workers.dev Preview URLs with Cloudflare Access. With the opt-in `SMOKE_ACCEPT_ACCESS=1` (Deploy stage only), `scripts/smoke-test.sh` treats a redirect to the Access login for that host as a notice, because the content cannot be checked from CI. Any other redirect or failure still fails, Deploy production never accepts Access, and the run summary says when stage was not verified from CI.

## [0.5.0] - 2026-10-19

### Added

- The full graph of all notes, from every page (toolbar button or Ctrl/Cmd+G), with Obsidian-style depth, search, tag and orphan toggles, section colours with a legend, node size by links, a list view, and settings remembered in this browser; the `/static/graph.json` slim index it reads.
- **Cut release** (`cut-release.yml`, manual, from `main`, owner only) and `scripts/changelog-section.mjs`: the workflow validates the version, creates the annotated tag `vX.Y.Z` and the GitHub Release, then dispatches Deploy production on the tag. The tag message and the Release notes are the `CHANGELOG.md` section of that version.
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
- `scripts/check-attribution.mjs` and the CI job `attribution` (part of CI OK): a pull request or push fails when a commit message, an author or committer email, or the PR title or body carries tooling attribution (a tool co-author trailer, a generated-with footer, a session link, a vendor noreply or email address). Dependabot co-author lines stay allowed.
- Deploy stage creates the Access application for stage by itself when none covers stage and there is no dev one to copy: a self-hosted app for the stage host (and the workers.dev Preview host when the account subdomain is known), 24h sessions, one allow policy for the owner's email (`STAGE_ACCESS_EMAIL` in `deploy-stage.yml`). The new app passes the same safety checks; an unsafe existing app still fails. The token needs Account > Access: Apps and Policies > Edit.

### Changed

- The note's local graph is now `local-plugins/note-graph`, drawn with Canvas 2D; the graph no longer downloads the full content index. Tags no longer count as depth hops, as in Obsidian.
- The pre-production site is **stage**, at https://stage.notes.szolotov.com (the Worker Preview `stage`, behind Cloudflare Access). The flow is main-only: pull requests go into `main`, CI and Dependabot run for `main` only, **Deploy stage** (`deploy-stage.yml`) deploys every merge to `main` (and Run workflow from `main`), only for the owner, in the environment `staging`, and production is cut from `main` with Cut release. The Dev Preview (`deploy-dev.yml`) and dev.notes.szolotov.com are retired automatically after a verified stage deploy.
- Deploy stage refuses to upload unless the Cloudflare API shows an Access application covering stage and no Custom Domain or DNS record for the host. After the upload, the workers.dev Preview URL must redirect to Access, otherwise the Preview is deleted; the stage Preview is also deleted after any failed or cancelled step once the upload was attempted (`SMOKE_REQUIRE_ACCESS` in `scripts/smoke-test.sh`, `scripts/cloudflare-stage.mjs`). `DEV_SMOKE_TEST` is gone.
- `/version.txt` on stage reads `stage+<sha>`; `NOTES_VERSION` accepts `stage` instead of `dev`; `npm run preview:dev` is `npm run preview:stage`.
- A Deploy stage run skips the upload and succeeds when `main` moved on during the run, because the newer run deploys.
- Production starts only by dispatch on a `vX.Y.Z` tag (from Cut release, or Run workflow on a tag); on commits that include this change a pushed tag deploys nothing (a tag on an older commit runs that commit's own workflow).
- TypeScript 7.0.2 (native compiler) for `npm run check`; `tsconfig.json` uses `moduleResolution: "bundler"` (node10 was removed), types `micromorph` through `paths`, and `quartz/processors/parse.ts` takes the mdast `Root` type from `@types/mdast`.
- `engines.node` is `>=22.12.0` (required by mermaid 12); `lodash-es` is overridden to `^4.18.1` (see Security).
- The `DataMap.frontmatter` type is now inherited from `@quartz-community/types` 1.0, where `tags` is optional and `description`, `socialDescription` and `lang` are declared there; the build output is unchanged.
- mermaid 12.0.0 (diagrams in the browser, from `public/static/vendor/mermaid`), @types/node 26.6.3, @napi-rs/simple-git 1.2.0.

### Removed

- `release.yml` and `deploy-dev.yml` (replaced by Cut release and Deploy stage), and the `workflow_call` and tag-push triggers of `deploy-production.yml`.
- The `pixi.js` dependency and `static/vendor/{d3,pixi}.min.js`; the community graph plugin is disabled.

### Fixed

- Section links in their own scrolling second row under the main bar, so they never overlap Browse or the search at any width, zoom or text setting. The current section is scrolled into view before the first paint, focus rings are not clipped, anchors and the table of contents sit below the taller header, and the Browse button keeps its space while loading.
- The search button opens on the first click (a script in the head); text typed meanwhile is searched once the index is ready.
- Search results show at most three lines (the old clamp targeted `p.preview`, which no result has).
- The "Notes" hit area is at least 44 x 32 px.
- At large text sizes the empty right column no longer widens the page between 1200 and 1280 px.
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
