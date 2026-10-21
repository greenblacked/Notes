# Deployment

The site is a static Quartz build served by one Cloudflare Worker, `notes` (`worker/`), with static assets. Production and the stage site are two views of that Worker:

| Environment | What                                           | URL                              | Updated by                                                                              |
| ----------- | ---------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| production  | The deployed Worker (`wrangler deploy`)        | https://notes.szolotov.com       | `deploy-production.yml` on a tag, dispatched by `cut-release.yml` or `text-release.yml` |
| stage       | Worker Preview named `stage` (public, noindex) | https://stage.notes.szolotov.com | `deploy-stage.yml` (`wrangler preview`), on every push to `main`                        |

The path of a change is: work branch `<type>/<kebab>` from `main`, pull request into `main` (`CI OK` required), merge commit. The merge deploys **stage** automatically; check https://stage.notes.szolotov.com. Cut release needs the merge's Deploy stage run to be green and to have updated stage for that commit. To release, update `CHANGELOG.md` (`[Unreleased]` to `[X.Y.Z] - date`) by pull request, then Actions, **Cut release**, on `main`, version `X.Y.Z`: it creates the tag and the GitHub Release and dispatches **Deploy production** on the tag, whose guard accepts it because the owner ran Cut release. Notes text has a shorter path: a `text/<kebab>` branch that changes only `content/` is released straight to production by `text-release.yml` when the owner merges it, without stage and without Cut release (see [Text releases](#text-releases-text-branches)). There is no `dev` branch. Feature branches are not previewed in Cloudflare; only work merged to `main` reaches the stage site.

Both sites are also reachable on the Worker's workers.dev URLs, which CI uses for verification (see [Bot Fight Mode](#cloudflare-blocks-the-smoke-test)). Indexing is decided per request in `worker/indexing.js`: only the production build on the host `notes.szolotov.com` is indexable; the stage Preview, every workers.dev host and localhost send `X-Robots-Tag: noindex, nofollow` on every response and a crawlable `robots.txt` with no sitemap (a page blocked by `robots.txt` cannot be crawled, so its noindex would never be seen).

Workflows (all in `.github/workflows/`):

- `ci.yml`: pull requests and pushes for `main`: build, type check, link check, build-output check (`scripts/check-artifact.mjs`), script and Worker-policy tests (`npm run test:scripts`), format check, `wrangler deploy --dry-run`, browser smoke tests, actionlint and zizmor. The aggregate job `CI OK` is the required status check. The attribution step of the `workflow-lint` job ("Lint workflows and check attribution", part of CI OK): `scripts/check-attribution.mjs` fails a pull request or push when a commit message in the range, an author or committer email, or the current PR title or body (fetched when the job runs, so after cleaning a body, re-run the job) carries tooling attribution (a tool co-author trailer, a generated-with footer, a session link, a vendor email). It scans commit metadata and PR text, not files. Dependabot PR bodies are skipped, their commits are not.
- `deploy-stage.yml`: runs on every push to `main` (a merged pull request) and on Run workflow from `main`. The first step of the `build` job accepts only the repository, the ref `refs/heads/main`, the events `push` and `workflow_dispatch`, and the owner as actor and triggering actor. The job (no secrets) then builds the exact commit, and an `upload` job (environment `stage`) deletes the old Preview `dev` if it still exists, runs `wrangler preview --name stage`, confirms through the Cloudflare API that the Preview's latest deployment is the one just uploaded (deployment id, tag = commit SHA, message `stage <sha7>`), smoke-tests the workers.dev Preview URL (HTTP 200, expected version, security headers, noindex; a redirect to the Cloudflare Access login for that workers.dev host is a notice, any other redirect fails), probes the custom domain, and takes stage down if any step fails or the run is cancelled once the upload was attempted. If `main` moved on during the run, the run skips the upload and succeeds, because the newer run deploys. The `result` job's output `stage_result` is `verified`, `uploaded-active`, `failure` or `skipped` (see Stage result under [Stage Preview](#stage-preview)).
- `cut-release.yml`: manual, from `main`, owner only. Validates the version, requires the head of `main`, a version greater than the latest tag and a successful CI run for the commit (`.github/scripts/require-ci-success.sh`) and that the most recently executed Deploy stage run for the commit on `main` completed with success and its job "Update stage Preview" ran the upload step (`.github/scripts/require-stage-success.sh`; skipped only for the first release, while no `vX.Y.Z` tag exists; the run summary records the run URL and the commit checked), writes the release notes from the `CHANGELOG.md` section (`scripts/changelog-section.mjs`), creates an annotated tag and a GitHub Release, then dispatches `deploy-production.yml` on the tag. Its job requests `contents: write` and `actions: write`.
- `text-release.yml`: runs on every push to `main`. Job `detect` (no concurrency group): the push must be by the owner, and `.github/scripts/verify-text-merge.sh` must find that the commit is the merge commit of a pull request of this repository from a `text/<kebab>` branch into `main`, merged by the owner (`commits/{sha}/pulls`, then `pulls/{n}` for `merged_by`); otherwise it only prints a notice. It then waits, bounded to 45 minutes, for the `ci.yml` push run of the commit to succeed (`.github/scripts/wait-for-ci.sh`; a failed or cancelled run releases nothing). Job `release` (group `cut-release`, shared with Cut release, so the two never tag at the same time) plans the release with `.github/scripts/text-release-plan.sh`, re-checks CI (`require-ci-success.sh`) and the latest tag, creates the annotated tag (the next PATCH version), a GitHub Release that lists the changed notes, and dispatches `deploy-production.yml` on the tag exactly as Cut release does. It never calls `require-stage-success.sh`; Deploy stage still runs on the same push and nothing waits for it. The long CI wait is in `detect`, outside the group, so only the short `release` job can delay a Cut release. GitHub keeps one pending run per group and cancels older pending ones: if a Cut release shows as cancelled, run it again; a cancelled pending text run is covered by the next one, because its commit descends from the older one. Its `release` job requests `contents: write` and `actions: write`; `detect` only reads. Both jobs run every helper (`verify-text-merge.sh`, `wait-for-ci.sh`, `text-release-plan.sh` and the scripts it calls, `require-ci-success.sh`, `text-release-version.sh`) from the latest `vX.Y.Z` tag on `main`'s first-parent history, extracted with `git archive` into `$RUNNER_TEMP/trusted`, never from the pushed commit, and the plan must diff from that same tag. A tag without the helpers releases nothing (a warning in `detect`: run Cut release first).
- `deploy-production.yml`: starts only by `workflow_dispatch` on a `vX.Y.Z` tag ref (from Cut release or Text release, or Run workflow on a tag to redeploy). On commits that include this change, pushing a tag deploys nothing; a tag on an older commit (for example `v0.1.0` to `v0.4.0`) runs that commit's own `deploy-production.yml`, which still has the tag-push trigger, only the owner can push tags (no collaborators), which is the control for those. `guard` (tag check, the owner, the owner's Cut release run, or the owner's verified `text/` merge release for the highest tag, successful CI run for the commit, commit on `main`; it needs `pull-requests: read` for the text check), `build`, then `deploy` (record the live version, `wrangler deploy`, smoke test on workers.dev, check that the new version serves 100%, automatic rollback on failure).

## Stage Preview

The stage site is a [Worker Preview](https://developers.cloudflare.com/workers/previews/) (open beta) named `stage` of the Worker `notes`, not a second Worker. `wrangler preview --name stage` uploads the build as a new deployment of that Preview; it never changes production traffic, has no rollback and is not recorded anywhere but in Cloudflare. It is the pre-production site: what the owner looks at after running Deploy stage and before tagging a release.

- Deployed **automatically** on every push to `main` (a merged pull request), and by hand with Actions, **Deploy stage**, Run workflow, branch `main`. The run summary and the `stage` environment link to https://stage.notes.szolotov.com once it is deployed (about 8 to 9 minutes measured on 4-core runners (2026-10-20), slower on 2-core; the build is cold: the plugin restore alone is 7 to 8 minutes). `/version.txt` on stage shows `stage+<sha>`.
- Only `main`: the first step of the `build` job fails any run started from another ref ("Deploy stage runs only from main"), so a dispatch from another branch fails there. Deployment branch policies are not available on a private repository on GitHub Free, so this step is the only branch control. The jobs that hold the Cloudflare token therefore run only code of `main`. Only the owner deploys: the step also checks the actor and the triggering actor, so a re-run by another account stops there. Forks cannot push to `main`, their pull request runs have no secrets, and there is no `pull_request_target` or `workflow_run` anywhere.
- Feature branches are not previewed in Cloudflare; only work merged to `main` reaches stage.
- Deploy stage does not wait for the CI push run on `main`: its build job runs the type check, build, link check and artifact check itself, and the merged code already passed `CI OK` on its pull request.
- Settings: Preview settings are separate from the top level of `wrangler.jsonc` (not inherited). `previews.vars` sets `ENVIRONMENT=preview`; top-level `vars` sets `production`. The Worker only checks for `production`, so any other value is noindex.
- URL: the route `{ "pattern": "notes.szolotov.com", "custom_domain": true, "previews_enabled": true }` makes the custom domain serve production and Previews. Cloudflare manages a wildcard for `*.notes.szolotov.com`, so the Preview `stage` is served at https://stage.notes.szolotov.com ([Previews on custom domains](https://developers.cloudflare.com/workers/previews/custom-domains/)).
- `wrangler preview` does not apply routes. `previews_enabled` is applied by `wrangler deploy` (the first release) or in the dashboard (Workers & Pages, `notes`, Domains, **Production and Preview**). Until then the Deploy stage run fails with an error that points here, and, because a check failed, the run deletes the Preview. This is expected before the first release; run **Deploy stage** again after the release.
- Indexing: Cloudflare adds `X-Robots-Tag: noindex` only on workers.dev Preview URLs, not on custom-domain Previews. The Worker therefore sends noindex itself for everything that is not production on `notes.szolotov.com`. On workers.dev Preview URLs Cloudflare adds the header as well, so there the header alone does not prove the Worker's policy. The `robots.txt` body (crawlable, no `Sitemap:`) is the Worker-specific check.
- **Public, not indexed**: the custom domain has no Cloudflare Access (the workers.dev Preview URL does, see below); anyone with the URL can open it. Search engines are kept out by the Worker: every host except production on `notes.szolotov.com` gets `X-Robots-Tag: noindex, nofollow` and a crawlable `robots.txt` without a sitemap. After the upload, the smoke test on the workers.dev Preview URL requires HTTP 200 with the expected `/version.txt`, the security headers, noindex (also on `robots.txt`) and a `robots.txt` with neither `Disallow: /` nor `Sitemap:`, unless that URL redirects to the Cloudflare Access login (next bullet); any other redirect fails. Any failed or cancelled step once the upload was attempted deletes the Preview `stage`, so it stays only when every check that could run passed, the API check included (see Access on the workers.dev Preview URL).
- URLs of stage that search engines already indexed drop out only after a recrawl sees the noindex. Removal requests in Search Console are optional and outside this repository.
- **Access on the workers.dev Preview URL**: the Cloudflare account protects workers.dev Preview URLs (`stage-notes.<subdomain>.workers.dev`) with Cloudflare Access. That is an account setting this repository does not manage, and the token has no Access permission. Deploy stage passes `SMOKE_ACCEPT_ACCESS=1` to `scripts/smoke-test.sh` for that URL only. A 3xx to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<that host>` ends the test with the result `access`; the content is then not checked from CI. A login for another host, any other redirect, or any other failure still fails and deletes the Preview. Without the variable an Access redirect fails, and Deploy production never sets it. The custom domain is then the only other check: a 200 must carry noindex, otherwise the run fails and the Preview is deleted; a 403 is a notice; an Access redirect is a warning, because stage is meant to be public. When workers.dev is behind Access, the run passes whatever the custom domain answers (usually 403 from GitHub runners; even a 200 with noindex only proves the header, not the build), and the result is `uploaded-active`: the API confirmed the upload is active, but the served content was not checked from CI. Check `https://stage.notes.szolotov.com/version.txt` in a browser.
- **Stage result**: the `result` job output `stage_result`, a `stage_result=<level>` line in the run summary and a `Stage result` notice give one of four levels. `verified`: the workers.dev smoke test read this build, and the Cloudflare API confirms the upload is the active stage deployment. `uploaded-active`: the API confirms it, but Access kept the smoke test from the served content. `failure`: the Preview was taken down, or nothing was uploaded. `skipped`: `main` moved on and the newer run deploys. "Active" means the Preview's latest deployment, which is what its URLs serve; a Preview has no gradual rollout. The check (`scripts/verify-preview-deployment.mjs`) reads `GET /accounts/<account>/workers/workers/notes/previews/stage/deployments/latest` with the existing `CLOUDFLARE_API_TOKEN` (Wrangler reads the same endpoint during every upload) and requires the deployment id Wrangler reported, the tag (the commit SHA) and the message `stage <sha7>` to match. A stale id, a missing-preview answer (10025/10222, normal right after the Preview is recreated) or this run's deployment without annotations is retried within the attempt budget; if, after the whole budget, the latest deployment is still not this run's (including any other deployment id, which the API gives no way to order against this upload), or any field differs, the check fails and the teardown deletes the stage Preview, even if another upload put that deployment there; the next Deploy stage run restores stage. A missing Preview counts as already gone. Cut release refuses such a run because the job failed. The `result` job also writes the `Stage result` notice and the `stage_result=<level>` summary line for every outcome (including a skipped upload and a build that failed before the upload), so its notice and summary are the authoritative ones; the `upload` job adds detail. Other jobs in this workflow should read `needs.result.outputs.stage_result` (job `result`): a skipped `upload` job (main moved on before the upload) has no outputs, so `needs.upload.outputs.stage_result` is empty there, and `result` maps that case to `skipped` and a failed, cancelled or silent upload to `failure`. Other workflows can read the `Stage result` notice or the `stage_result=<level>` summary line through the check-run annotations API with `GITHUB_TOKEN`; a job output is not visible outside the run.
- Smoke test retries: `/version.txt` is retried until it serves the expected build, then the content, header and indexing checks are retried as a set (`SMOKE_CHECK_ROUNDS`, default 6, every `SMOKE_CHECK_DELAY`, default 10 s), because a new route or custom domain can take a moment to reach every Cloudflare edge.
- Who is trusted with the token: the repository is private on GitHub Free (2026-10-20), where environment secrets, deployment branch and tag policies and required reviewers are ignored (GitHub docs, Managing environments for deployment; plans change, check them). `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are therefore repository-level, and every workflow run on any branch pushed to this repository can read the token (Dependabot runs receive no Actions secrets). Write access must stay with the owner alone. Giving anyone else write access needs a paid plan with environment secrets first.
- Remove the Preview: `npx wrangler preview delete --name stage`.

History: stage was a separate Worker, then a Preview `stage` deployed from `main`, replaced on 2026-10-15 by a Preview `dev`. On 2026-10-18 dev was retired and stage deploys from `main` again, automatically. Stage is now public and noindex, without Cloudflare Access. Deploy stage deletes the old Preview `dev` (dev.notes.szolotov.com) when it still exists; the step is idempotent and needs nothing manual.

## One-time setup checklist

### 1. Cloudflare

1. The zone `szolotov.com` must be an **active zone in the same Cloudflare account** that the token and account id belong to. Custom Domains need an active zone and cannot be created on a hostname that already has a CNAME record ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
2. Make sure no DNS record already exists for `notes.szolotov.com` or `stage.notes.szolotov.com` (the latter would shadow the Preview wildcard). Wrangler creates the DNS records and certificates for the Custom Domain itself on the first deploy.
3. Note the **Account ID** (dashboard, Workers & Pages overview).
4. Create an API token (My Profile, API Tokens, Create Custom Token) with these permissions:

| Scope   | Permission             | Why                                                                                      |
| ------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Account | Workers Scripts: Edit  | Deploy, roll back and preview the Worker (new roles name this "Editor, Workers product") |
| Zone    | Zone: Read             | Look up the zone for the Custom Domain                                                   |
| Zone    | DNS: Edit              | Custom Domain DNS records, including the Preview wildcard                                |
| Zone    | Workers Routes: Edit   | Adding or changing Custom Domains during `wrangler deploy`                               |
| Account | Workers Tail: Read     | Wrangler reads Worker state during deploys                                               |
| Account | Account Settings: Read | Part of the token Cloudflare itself generates for Workers Builds                         |
| User    | Memberships: Read      | same                                                                                     |

`CLOUDFLARE_API_TOKEN` (secret) and `CLOUDFLARE_ACCOUNT_ID` (variable preferred, a secret of that name also works) are repository-level: the repository is private on GitHub Free (2026-10-20), where environment secrets are ignored (see the trust note under [Stage Preview](#stage-preview)). On a paid plan, environment secrets would be the stricter option.

Sources: [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/) and [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token). Validate the grants with a real deploy (the first release); tighten or add permissions from the error it reports.

Scope account resources to the one account and the zone resource to `szolotov.com` only.

What is **not verified** (confirm with the first release):

- Which of the Account Settings, Workers Tail and Memberships read permissions are needed when `CLOUDFLARE_ACCOUNT_ID` is set. They come from Cloudflare's own Workers Builds token.
- Whether `wrangler preview` needs anything beyond Workers Scripts: Edit. Worker Previews are in open beta.

### 2. GitHub repository settings

**Actions, General**

- Workflow permissions: **Read repository contents and packages permissions** (default read-only). Every workflow declares its own permissions; `cut-release.yml` requests `contents: write` and `actions: write` on its job only (`actions: write` also covers reading the CI and Deploy stage runs). "Allow GitHub Actions to create and approve pull requests" is not needed.
- Allowed actions: optionally restrict to actions from this repository plus `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact` and `actions/download-artifact`, and enable "Require actions to be pinned to a full-length commit SHA".

**Variables and secrets** (Settings, Secrets and variables, Actions)

- Repository variable `CLOUDFLARE_ACCOUNT_ID` (preferred). A repository secret of the same name also works: the workflows read `vars.CLOUDFLARE_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID`, variable first.
- Repository secret `CLOUDFLARE_API_TOKEN`.
- Optional repository secret `SMOKE_TEST_TOKEN` (see [Cloudflare blocks the smoke test](#cloudflare-blocks-the-smoke-test)).

**Environments**

`stage` and `production` exist only for deployment records and the environment URL. On a private Free repository they carry no secrets, branch or tag rules or reviewers. Delete any environment secrets; they are ignored.

Trade-off of a single Worker: the Preview and production are the same Worker, so the token that deploys stage can also deploy production. The controls are now in the workflows: Deploy stage refuses anything but `main`, a push or dispatch, and the owner; production refuses anything but a `vX.Y.Z` tag on a commit with green CI on `main`, started by the owner or by the owner's Cut release run.

**Production is tag-only, enforced in the workflow.** `deploy-production.yml` runs only by `workflow_dispatch`, and only on a tag: on commits that include this change a hand-pushed tag deploys nothing (a tag on an older commit runs that commit's own workflow file, which still has the tag-push trigger; only the owner can push tags, which is the control for those). The `guard` job refuses everything that is not a release tag: `github.ref` must be `refs/tags/vX.Y.Z` and the tag must resolve to exactly `github.sha`. The deploy job then checks out `github.sha`. Cut release creates the tag and dispatches the workflow on it; redeploying or rolling forward is Run workflow on the tag.

**The guard is the gate** (see also [Text releases](#text-releases-text-branches)). With no rulesets or reviewers available, the guard decides: it checks the tag ref, that the tag resolves to the commit, the actor (`.github/scripts/require-release-actor.sh`: the owner, or github-actions[bot] backed by a Cut release run of the owner for the same commit, or by a Text release push run of the owner for it plus a fresh `verify-text-merge.sh` and the tag being the highest `vX.Y.Z` tag, accepted while in progress or after success) and CI on main. The guard's code comes from the tagged commit, so it binds only as long as no one but the owner can push tags or code (single-owner write access). For a Text release tag that code is the previous tag's: the plan, run from that tag, allows only `content/` changes since it.

The guard also requires, on every path, a successful `ci.yml` run for the exact commit (event `push`, branch `main`) and that the commit is on `main` (`compare/main...<sha>` reports `identical` or `behind`), both in `.github/scripts/require-ci-success.sh`, which `cut-release.yml` uses too. A tag on a commit that never passed CI on `main`, or on a branch that was never merged, is therefore not deployed even if someone manages to create it. The guard job has `contents: read`, `actions: read` and `pull-requests: read` only. Cut release also requires the green Deploy stage run; Deploy production does not re-check it, so redeploying an existing tag is not blocked by later stage runs.

Rulesets and the optional separate Cloudflare token are discussed in [Repository settings](#repository-settings).

### 3. First deploy order

1. Actions, **Cut release**, Run workflow on `main`, the next version (historical: the first release was `0.1.0`; release tags `v0.1.0` and later exist) (its `CHANGELOG.md` section must be on `main`, and the Deploy stage run of the merge that put it there must be green; on a fresh deployment with no `vX.Y.Z` tag yet this stage check is skipped with a notice, because stage needs the custom domain that this first production deploy creates, and it is enforced for every later release). After the tag and release are created, Cut release dispatches the production deploy, which runs without approval. The first production deploy creates the `notes` Worker, the Custom Domain `notes.szolotov.com` and, through `previews_enabled`, the Preview wildcard.
2. Stage deploys on every merge to `main`, which creates the `stage` Preview. Before the first release it fails at the "Require the custom domain Preview URL" step and deletes the Preview, because it is only on workers.dev; run **Deploy stage** again from `main` after the first release ([Stage Preview](#stage-preview)).
3. Validate production and stage (commands below). DNS and the certificate can take a few minutes; the smoke test retries for about 2.5 minutes.

## Text releases (text/ branches)

Use a `text/<lower-case-kebab>` branch for changes to the notes' text only. It goes through all of CI, but not through stage and not through a manual Cut release: when the owner merges it into `main`, production is deployed from the next PATCH tag (`vX.Y.Z+1`).

When to use it:

- The change is only `.md` notes or raster images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`) under `content/`, with plain file names (no spaces or dot-segments; no symlinks, executables or submodules). CI (`require-text-paths.sh`, in the `workflow-lint` job, part of `CI OK`; it runs from the pull request's base commit, never its head, so a `text/` pull request cannot rewrite its own check) fails a pull request from a `text/` branch that changes anything else, including `CHANGELOG.md`. Other checks (build, links, notes check, browser suite) still run on it: text skips stage, not CI. GitHub still runs the workflow files of the pull request's merge commit, so a `text/` pull request that touches `.github/` is rejected in review. GitHub runs `text-release.yml` from the pushed commit, so the owner's review of a `text/` pull request (no `.github/` changes) remains the control for workflow files.
- Use a normal `<type>/<kebab>` branch and Cut release for anything else: code, configuration, workflows, dependencies, the changelog, SVG or HTML. Cut release is also the way out when `main` has unreleased code (below).

What happens on merge (see `text-release.yml` under Workflows):

1. The owner merges the pull request with a merge commit. Deploy stage and CI run on the push as for any merge.
2. `detect` verifies through the API that the commit is the merge commit of a `text/` pull request of this repository, merged into `main` by the owner, and waits for the CI push run of the commit (bounded to 45 minutes).
3. `release` refuses unless the whole diff from the latest `vX.Y.Z` tag to the commit touches only `content/` (the same file rules). This means it never ships code or configuration that skipped stage: if `main` has unreleased changes outside `content/`, it only warns "run Cut release", and Cut release ships the text together with them. Otherwise it re-checks CI, creates the annotated tag and a GitHub Release listing the changed notes, and dispatches Deploy production on the tag.
4. Deploy production's guard accepts the dispatch only for a verified owner merge of a `text/` pull request, a Text release push run of the owner for the commit, and only when the tag is the highest release tag (so a stale text tag cannot roll production back).

Limits and recovery:

- The text path works only after a Cut release that contains this change: Text release runs the helpers of the latest tag and the guard runs the scripts of the tagged commit, and the first text release needs a `vX.Y.Z` tag whose diff to `main` is content-only. Until then `detect` warns "run Cut release first" and releases nothing (there were many unreleased code changes after `v0.6.0` when this was added).
- Versions created this way have no `CHANGELOG.md` section; their GitHub Release lists the notes.
- A failed or cancelled CI run releases nothing. Fix CI and re-run the Text release run (an owner re-run of an already released commit is a no-op: "already in vX.Y.Z"), or merge the next `text/` pull request: its release covers the earlier content too. If the tag or the Release was created but a later step failed, the error message gives the manual command; do not tag again.
- A non-owner merge, a fork branch named `text/...` and a merge into another branch release nothing.
- Stage is not updated before production for these commits; it is updated by the same push's Deploy stage run, in parallel.
- Like the other gates here, the checks live in the merged commit: they guard against mistakes, not against someone else with write access, so the owner must be the only one who can push code.

## Production is tag-only

See "Production is tag-only, enforced in the workflow" above; Text release keeps this invariant by creating a `vX.Y.Z` tag ([Text releases](#text-releases-text-branches)). In short: a branch run of `deploy-production.yml` cannot deploy, whatever the repository settings say. On a tag dispatch the workflow file and the guard script come from the tagged commit, so the guard binds only while the owner alone can push tags and code (see [Repository settings](#repository-settings)).

## Build and deploy are separate jobs

`npm run build` runs `quartz plugin restore`, which at build time clones about 40 third-party Quartz plugins (`github.com/quartz-community/*`) at the commits pinned in `quartz.lock.json`, then runs `npm install` and `npm run build` inside each. That is third-party code, and the plugins' transitive npm dependencies are not pinned by any lockfile of ours. This is a known supply-chain risk. It is mitigated by isolating secrets and by reviewing every change to `quartz.lock.json`.

- The `build` job has no environment, no secrets and `contents: read` only. It builds, checks links, checks the output with `scripts/check-artifact.mjs --public public` and uploads an artifact (`public/` only, retention 1 day). It runs with `NPM_CONFIG_IGNORE_SCRIPTS=true`, in `ci.yml` too: no install script of our dependencies or of the plugins' npm dependencies (`npm install` inside each plugin honours the variable) runs. The build does not need any: the plugins are compiled by their `npm run build`, which is run explicitly and still works.
- The `upload` and `deploy` jobs (the ones with the `stage` or `production` environment and the Cloudflare token) check out the commit fresh and install **only wrangler**, from `tools/` (`npm ci --ignore-scripts --prefix tools`; `tools/package.json` pins wrangler to the same version as the root `package.json`, with its own lockfile). They do not install the root dependencies. No root dependency is a git dependency any more, but the jobs still install only wrangler as defence in depth, because a git dependency's `prepare` script runs even with `--ignore-scripts` and a root install would run third-party code next to the token. The other scripts these jobs run (`check-artifact.mjs`, `build-csp.mjs`, `read-wrangler-output.mjs`, `verify-preview-deployment.mjs`, `smoke-test.sh`) use only Node built-ins (`verify-preview-deployment.mjs` uses the built-in `fetch` against `api.cloudflare.com`), and the Worker imports no npm package, so wrangler bundles it from `tools/`. The jobs download the artifact, validate it with `scripts/check-artifact.mjs --root`, regenerate `worker/csp.generated.js` from the checked `public/` with `node scripts/build-csp.mjs`, and only then run wrangler (`tools/node_modules/.bin/wrangler`). The token is set on the individual wrangler steps, never job-wide. Keep `tools/` and the root wrangler version in step (Dependabot has an entry for each).
- The artifact check accepts only `public/` (a `worker/` directory fails it: no Worker code comes from the build, the CSP hashes are recomputed from the checked `public/`), and in `public/` only regular files whose extension is in the allowlist of `scripts/check-artifact.mjs` (`.css .html .ico .js .json .map .mjs .png .txt .woff2 .xml`, the set a build produces) and never `_redirects` or `_headers` (Cloudflare would apply them to the site; routing and headers belong to the Worker). A new kind of file in the site fails the build until the allowlist is extended on purpose.
- CI also builds once and passes `public/` to the **Browser smoke tests** job (artifact `ci-site`, retention 1 day), which CI OK requires. Each of those jobs has `contents: read` only, re-checks the artifact with `scripts/check-artifact.mjs --root`, regenerates the CSP hashes from it, installs only the browser of its matrix entry (Chromium or WebKit) from the Playwright version in `package-lock.json` and runs one shard of one Playwright project (`npm run test:browser -- --project=<p> --shard=<k>/<n>`) against the built site served through the Worker. Eight such jobs together run every test in all four projects (Chromium and WebKit, desktop and phone). Because Cut release and Deploy production require a successful push run of `ci.yml` (`.github/scripts/require-ci-success.sh`), a failing browser test blocks releases.
- Build jobs need network access to github.com and the npm registry.
- No dependency cache is used in the deploy and release workflows (cache-poisoning risk), so every deploy build restores plugins cold: expect about 7 to 8 minutes measured on 4-core runners (2026-10-20), slower on 2-core (the build job timeout is 45 minutes). CI caches `.quartz/plugins` keyed on `quartz.lock.json`, so a warm CI build takes seconds.

## Validation commands

```sh
gh run list --repo greenblacked/Notes --workflow deploy-stage.yml --branch main --commit "$(git rev-parse origin/main)" --limit 5   # Cut release needs the newest one green
curl -sI https://notes.szolotov.com
curl -s  https://notes.szolotov.com/version.txt        # <X.Y.Z>+<40-char commit sha>
curl -s  https://notes.szolotov.com/robots.txt         # allows crawling, lists the sitemap
curl -sI https://notes.szolotov.com | grep -i x-robots-tag   # no output expected

curl -sI https://stage.notes.szolotov.com | grep -i x-robots-tag   # x-robots-tag: noindex, nofollow
curl -s  https://stage.notes.szolotov.com/version.txt        # stage+<40-char commit sha>
curl -s  https://stage.notes.szolotov.com/robots.txt         # User-agent: * / Allow: / (no Disallow, no Sitemap)

npm run build && npm run test:browser    # browser smoke tests against the built site, through the Worker (needs `./node_modules/.bin/playwright install chromium webkit` once)
```

From a GitHub-hosted runner the custom domains answer 403 (below), so CI runs the same checks as `scripts/smoke-test.sh <base_url> <expected_version> <indexable|noindex>` against the workers.dev URLs, which are `noindex`.

## Rollback

Find the version ids and the active deployment:

```sh
npx wrangler deployments status
npx wrangler deployments list
npx wrangler versions list
```

Roll back to a previous version immediately (creates a new deployment of that version; `--yes` skips the prompt):

```sh
npx wrangler rollback <version-id> --message "reason" --yes
```

Rollback applies to production only. The stage Preview is not part of rollback and has no rollback of its own: merge a fix into `main` (stage redeploys), or remove it with `npx wrangler preview delete --name stage`. You can only roll back to one of the 100 most recent versions, and not if bindings changed ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). A rollback is not recorded in git: the site then serves an older build while `main` has moved on.

Roll forward or back through the pipeline: Actions, **Deploy production**, "Run workflow" with the **tag** selected as the ref (for example `v0.1.0`). This rebuilds that tag and deploys it. If the deploy or smoke test fails, the workflow rolls back to the version that was live before the run and fails the job.

Automatic rollback is skipped when no previous version could be recorded (first deploy) or when a gradual deployment is active (more than one version).

## Troubleshooting

| Symptom                                                                                                                        | Likely cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails: "A DNS record already exists" / custom domain conflict                                                           | A CNAME/A record for the hostname exists. Delete it in Cloudflare DNS, then redeploy. Custom Domains cannot be created over an existing CNAME.                                                                                                                                                                                                                                                                                         |
| `Authentication error [code: 10000]`                                                                                           | Token missing a permission or scoped to the wrong account or zone. Re-check the table above, the repository secret, and that the zone is in the same account.                                                                                                                                                                                                                                                                          |
| `Could not route to /accounts/...` or wrong account                                                                            | `CLOUDFLARE_ACCOUNT_ID` (repository variable or secret) missing or from another account.                                                                                                                                                                                                                                                                                                                                               |
| Deploy production guard fails at "Require the owner or a Cut release by the owner"                                             | The run was dispatched or re-run by another account, or by github-actions[bot] without a Cut release run of the owner for that commit. Run Cut release, or Run workflow on the tag as the owner.                                                                                                                                                                                                                                       |
| Deploy stage: notice "main moved on; the newer run deploys it"                                                                 | A newer commit reached `main` while the run was building; the run skipped the upload and succeeded. The newer run deploys. Nothing to do.                                                                                                                                                                                                                                                                                              |
| Smoke test: `/version.txt` does not match                                                                                      | Edge propagation or Custom Domain still provisioning (retried for about 2.5 minutes). If it persists, check `npx wrangler deployments status`, and that the build used the right `NOTES_VERSION` and `NOTES_SHA`. Stale caches are bypassed by a random query string.                                                                                                                                                                  |
| Smoke test: `GET /` returns 403 without `X-Robots-Tag`, while `/version.txt` passes                                            | A Cloudflare security feature answered instead of the Worker (the Worker sets its headers on every response, errors included). The smoke test prints `server`, `cf-ray` and `cf-mitigated` for the failing response; see [Cloudflare blocks the smoke test](#cloudflare-blocks-the-smoke-test).                                                                                                                                        |
| Deploy stage fails: "The stage Preview is not served at https://stage.notes.szolotov.com"                                      | `notes.szolotov.com` is not enabled for Production and Preview yet (first release not done, or the toggle is off), or the Preview wildcard is still provisioning. Run the first release or enable it in the dashboard, then run **Deploy stage** from `main` again. See [Stage Preview](#stage-preview).                                                                                                                               |
| Deploy stage fails at "Smoke-test the workers.dev Preview URL" (any failure once the upload was attempted deletes the Preview) | Read the FAIL lines. A redirect to the Cloudflare Access login for the Preview's own workers.dev host is accepted (a notice). A failure here is a login for another host, another redirect, a non-200, the wrong version, missing noindex, or a `robots.txt` that blocks crawling or lists a sitemap. A missing noindex means the Preview runs with `ENVIRONMENT=production`: check `previews.vars` in `wrangler.jsonc`.               |
| Deploy stage is green with `stage_result=uploaded-active`                                                                      | Expected while workers.dev Preview URLs are behind Access. The API confirmed this commit's deployment is active; the served content was not checked. Check `/version.txt` in a browser.                                                                                                                                                                                                                                                |
| Deploy stage fails at "Confirm the uploaded version is active"                                                                 | The Preview's latest deployment is not this run's upload (another `wrangler preview --name stage` ran meanwhile), or its tag or message differ, or the API shape changed (the error lists the fields received). The Preview was taken down; run Deploy stage again.                                                                                                                                                                    |
| Deploy stage fails at "Delete the old dev Preview"                                                                             | Wrangler could not delete the Preview `dev` and did not report it as missing (bad token, network). Nothing was uploaded; read the output and run again.                                                                                                                                                                                                                                                                                |
| Deploy stage: custom domain preview URL missing, `stage.notes` has a DNS record                                                | A manual `stage.notes` DNS record shadows the Preview wildcard. Remove it.                                                                                                                                                                                                                                                                                                                                                             |
| Deploy stage fails at the Build step "Require the main branch and the owner": "Deploy stage runs only from main"               | The run was started from another branch. Run workflow again with branch `main` selected.                                                                                                                                                                                                                                                                                                                                               |
| Deploy stage upload rejected: "Branch main is not allowed to deploy to stage"                                                  | The environment `stage` exists with a deployment branch policy that excludes `main`. A missing environment is not the cause: GitHub auto-creates it unprotected, with no branch policy, so check the policy of a freshly created `stage` after the first run. Fix the environment policy under Settings, Environments (deployment branch policies exist only on a paid plan, so this should not occur on the private Free repository). |
| Deploy stage guard fails: "limited to the repository owner"                                                                    | The run was started or re-run by an account other than the owner. Only the owner deploys.                                                                                                                                                                                                                                                                                                                                              |
| `curl https://notes.szolotov.com` works from your machine but CI sees 403                                                      | Bot Fight Mode on the zone blocks GitHub-hosted runners on the custom domains. Expected: CI verifies on workers.dev and only logs a notice for the custom domain. See [below](#cloudflare-blocks-the-smoke-test).                                                                                                                                                                                                                      |
| Deploy stage deleted the Preview                                                                                               | The Preview is deleted after any failed or cancelled step once the upload was attempted. Read the first failed step in the run, fix it, then run Deploy stage again.                                                                                                                                                                                                                                                                   |
| Deploy production: guard fails with "No successful ci.yml push run found" or "is not on main"                                  | The tagged commit has no successful CI push run on `main`, or is not reachable from `main`. Merge it through a pull request and let CI finish on `main`, then tag a commit from `main`.                                                                                                                                                                                                                                                |
| Cut release: "No successful ci.yml push run found"                                                                             | CI on `main` for that commit has not finished or failed. Wait or fix, then run Cut release again.                                                                                                                                                                                                                                                                                                                                      |
| Cut release: "No Deploy stage run found for ... on main"                                                                       | Deploy stage never ran for this commit, or it ran outside `main`. Run workflow on `main` for Deploy stage, wait for it, then run Cut release again.                                                                                                                                                                                                                                                                                    |
| Cut release: Deploy stage run "is still queued/in_progress"                                                                    | Wait for it to finish (a cold build and deploy takes about 8 to 9 minutes measured on 4-core runners (2026-10-20), slower on 2-core, or more), then run Cut release again.                                                                                                                                                                                                                                                             |
| Cut release: Deploy stage run "ended with 'failure'/'cancelled'"                                                               | Open the linked run, fix the cause or re-run Deploy stage, then run Cut release again.                                                                                                                                                                                                                                                                                                                                                 |
| Cut release: "did not update stage"                                                                                            | `main` moved on during that Deploy stage run, so it skipped the upload (the job or its upload step shows as skipped). Run Cut release from the new head once its Deploy stage run is green.                                                                                                                                                                                                                                            |
| Cut release: tag step fails with a ruleset error                                                                               | Only with a tag ruleset (paid plan or public repository): it blocks creation by the Actions app. See the tag ruleset notes below.                                                                                                                                                                                                                                                                                                      |
| Cut release: "must be strictly greater than the latest tag"                                                                    | Pick a higher X.Y.Z. A failure after the tag step needs a new version number (tags are never reused); run only the deploy via Deploy production on that tag.                                                                                                                                                                                                                                                                           |
| Cut release: "has no section for X.Y.Z" or "is empty"                                                                          | `CHANGELOG.md` on `main` has no `## [X.Y.Z] - YYYY-MM-DD` heading with at least one `- ` item. Merge the CHANGELOG pull request first, then run Cut release.                                                                                                                                                                                                                                                                           |
| Cut release: tag and Release exist but the dispatch failed                                                                     | Run `gh workflow run deploy-production.yml --repo greenblacked/Notes --ref vX.Y.Z`, or Run workflow on the tag in Actions. Do not cut again.                                                                                                                                                                                                                                                                                           |

### Cloudflare blocks the smoke test

Bot Fight Mode on the `szolotov.com` zone answers GitHub-hosted runners with HTTP 403 (`cf-mitigated`) on the custom-domain hosts (observed on https://stage.notes.szolotov.com). That is why the Worker keeps `workers_dev` and `preview_urls` enabled and the deploy workflows smoke-test the workers.dev URLs and check `wrangler deployments status` (production) or the Preview deployment API (stage), and fetch the custom domains once only to log a notice. The rest of this section is for when you want the custom domains checked too (zone WAF rules do not apply to workers.dev).

Symptom: `/version.txt` and `/robots.txt` pass, but `GET /` (HTML) fails with 403 and no `X-Robots-Tag`. The Worker adds its headers to every response, errors included, so the 403 was produced in front of it. GitHub-hosted runners come from cloud provider IP ranges, which Cloudflare's bot protections may challenge while ordinary visitors get through. The smoke test reports it as `blocked by Cloudflare (cf-mitigated: <value>)` and prints the `cf-ray` value.

1. **Find what acted.** In the Cloudflare dashboard open **Security, Events**, filter on the hostname, and look up the Ray ID from the smoke-test log. The event names the product (Bot Fight Mode, Super Bot Fight Mode, a managed rule, Security Level).
2. **Bot Fight Mode (Free plan):** it cannot be bypassed with a WAF custom rule (Skip action) or any other exception; the only control is turning it off for the whole zone (**Security, Bots**), see the [Bot Fight Mode documentation](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/). CI is unaffected by it: the deploy workflows verify on the workers.dev URLs, so only CI's fetches of the custom domains are blocked (logged as notices).
3. **Super Bot Fight Mode or other WAF features (Pro and above):** add a WAF custom rule with the action **Skip** for the products that fired (see [Skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)), matching both hostnames and a shared secret header rather than the User-Agent, which anyone can spoof:

   ```text
   (http.host in {"notes.szolotov.com" "stage.notes.szolotov.com"}
    and any(http.request.headers["x-notes-smoke-test"][*] eq "<value of SMOKE_TEST_TOKEN>"))
   ```

   Then add the same random value as the GitHub secret `SMOKE_TEST_TOKEN` (repository level), for example from `openssl rand -hex 32`. The deploy workflows pass it to `scripts/smoke-test.sh`, which sends it as the `X-Notes-Smoke-Test` request header; without the secret the header is not sent. Rotate it by updating the rule and the secret together.

The smoke test also sends the User-Agent `notes-smoke-test/1 (+https://notes.szolotov.com)` (override with `SMOKE_USER_AGENT`), which makes its requests easy to find in Security Events.

## One-time cleanup of old deployments

The repository's Deployments list keeps a record for every environment a workflow ever used. Only `stage` and `production` are wanted. The workflow `cleanup-deployments.yml` (Actions, Cleanup deployments, Run workflow, branch `main`, owner only) deletes the old records: for each environment in the input `environments` (default `dev staging repo-admin`) it sets every deployment inactive, which GitHub requires, and deletes it. With `include_failed_stage` (default on) it also deletes the deployments of `stage` whose latest status is `failure` or `error`; successful ones stay. It refuses a list that contains `production` or `stage`, never touches `production`, and holds only `deployments: write`. The job summary shows a count per environment. Run it once after the rename of the environment to `stage`; afterwards the workflow is not needed again. Run it when no Deploy stage run is in progress, so it does not read a deployment between status updates. Deleting the environments `dev`, `staging` and `repo-admin` themselves is separate and runs after the cleanup run. It needs a credential with administration permission (`GITHUB_TOKEN` has none): `gh api -X DELETE repos/greenblacked/Notes/environments/<name>`. The `stage` environment was auto-created without a deployment branch policy; the first Build step already restricts Deploy stage to `main` and the owner (branch policies are not available on a private Free repository).

## Deleting merged branches

The workflow `delete-merged-branches.yml` (Actions, Delete merged branches, Run workflow, branch `main`, owner only) deletes branches whose work is in `main`. It is a dry run by default (`dry_run` on): the job summary lists every branch with its head commit, the decision and the reason, and nothing is deleted until it runs with `dry_run` off. A branch is deleted only when a pull request from that branch of this repository into `main` was merged and the branch still points at that pull request's head commit, so nothing pushed after the merge is lost; right before the delete the workflow reads the head again and keeps the branch if it moved (a tiny window remains between that check and the delete). It always keeps `main`, the default branch, `dependabot/*`, protected branches, branches with an open pull request and branches that are the base of an open pull request. The input `extra` (default `dev feature/notes-site`) names leftover branches to delete without a merged pull request; it accepts only branch names separated by single spaces and refuses `main` and `dependabot/*`. A listed branch is still kept when it has an open pull request, except that open Dependabot pull requests based on it do not block it: GitHub closes them together with the branch, the summary lists them, and Dependabot opens its updates against `main`. The default of `extra` is meant for the first cleanup: after it, run the workflow with `extra` cleared, so a branch of that name created later is not deleted without a merged pull request. The job holds only `contents: write` and `pull-requests: read` and fails when GitHub refuses a delete, for example because of a ruleset. To restore a branch, use Restore branch on its pull request, or `gh api repos/greenblacked/Notes/git/refs -f ref=refs/heads/<branch> -f sha=<head>` with the head commit from the summary.

## Repository settings

Rulesets and branch protection do not apply to a private repository on GitHub Free (2026-10-20); the pipeline does not rely on them. The release gates (`require-ci-success.sh`, `require-stage-success.sh`, `require-release-actor.sh`, `verify-text-merge.sh`, `wait-for-ci.sh` and the content-only checks of the text path) use the API or git. A direct push to `main` or a merge with red CI deploys stage, and Cut release refuses such a commit. Remove the leftover environments `dev`, `staging` and `repo-admin` (see [One-time cleanup of old deployments](#one-time-cleanup-of-old-deployments)). Only `stage` and `production` should remain.

If the repository moves to a paid plan or becomes public again, the expected settings are:

- **Ruleset `main`** (target branch `main`): enforcement active, no bypass actors, pull request required (0 approvals; the owner works alone), required status check `CI OK` from the GitHub Actions app only, no force pushes, no deletion, merge commits as the only merge method. There is no `dev` branch.
- **Ruleset for `v*` tags** (target tag, pattern `v*`):
  - Restrict creations, updates and deletions. Bypass list: the repository **admin** role and the **GitHub Actions** app, which is the actor that creates the tag in `cut-release.yml` and `text-release.yml` (`GITHUB_TOKEN`).
  - Not verified: whether the GitHub Actions app can be added to a ruleset's bypass list. If it is not offered, a creation restriction makes `cut-release.yml` fail at "Create the annotated tag" (403 or ruleset error; nothing is deployed). Then restrict only updates and deletions, so a published tag can never be moved or removed, and accept that creations are limited only by the required reviewers on the `production` environment: the `guard` job is not a control for creations, because a dispatch on a tag runs the workflow and guard script of the tagged commit ([Production is tag-only](#production-is-tag-only)). Use "Prevent self-review" on that environment when more than one person has access.
  - With the ruleset in place, the real controls for production are this ruleset (who can create `v*` tags) **and** required reviewers on the `production` environment. The guard only catches mistakes.
- **Environments** (Settings, Environments; details in the [table above](#2-github-repository-settings)):
  - `stage`: deployment branches limited to `main`. Only code that went through the `main` ruleset can reach the job that holds the Cloudflare token.
  - `production`: deployment tag rule `v*`, plus required reviewers.
- **Fork pull requests**: workflows from all external contributors need the owner's approval (CI has no secrets anyway; this only limits resource use).

**Optional: a separate Cloudflare account or token for stage.** The stage Preview is a Preview of the same Worker, so the stage token can also deploy production. If that matters, deploy stage from a separate Cloudflare account (its own `CLOUDFLARE_ACCOUNT_ID` and token as separate secrets, which needs environment secrets on a paid plan, and a Worker named `notes` there) so a compromised stage job cannot touch production. Until then the control is that only the owner has write access to the repository (rulesets are not enforced on a private repository on GitHub Free).

### Rollback drill (once, after the first two releases)

Run this once in a quiet moment to know that rollback works before you need it. It needs two released versions; the site serves the older build for a few minutes.

1. Set the credentials (the same token and account as the production environment) and note the live version:

   ```sh
   export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
   npx wrangler deployments status
   curl -s https://notes.szolotov.com/version.txt     # e.g. 0.2.0+<40-char sha>
   ```

   Expected: one version at 100% and the newest release in `version.txt`.

2. List the deployments and pick the version id of the previous release (not the live one):

   ```sh
   npx wrangler deployments list
   npx wrangler versions list
   ```

   Expected: a table of deployments with the version id, source and message; the earlier release's deploy is in it.

3. Roll back:

   ```sh
   npx wrangler rollback <version-id> --message "Rollback drill" --yes
   ```

   Expected: Wrangler reports the rollback to that version and a new deployment. The exact wording differs between Wrangler versions; a non-zero exit code is the failure signal.

4. Validate:

   ```sh
   npx wrangler deployments status                    # the older version id, 100%
   curl -s https://notes.szolotov.com/version.txt     # the older release: <older X.Y.Z>+<its sha>
   curl -sI https://notes.szolotov.com | head -n 1     # HTTP/2 200
   ```

   Expected: `version.txt` shows the previous release immediately (it is served with `no-store`).

5. Roll forward through the pipeline (never leave a manual rollback in place): Actions, **Deploy production**, Run workflow, select the **tag** of the newest release as the ref (for example `v0.3.0`). For a tag created after this change the guard re-checks the tag, CI and `main`; tags created before it (for example `v0.1.0` to `v0.3.0`) run their own workflow file, which has no CI check, so only their own checks apply. The deploy smoke-tests workers.dev. Redeploying a very old tag also needs the `ci.yml` run record for its commit to still exist; run records expire with the retention period. If it is gone, the guard of a newer tag fails closed ("No successful ci.yml push run found") and the manual `wrangler rollback` from step 3 is the path.

6. Validate again: `curl -s https://notes.szolotov.com/version.txt` shows `0.3.0+<sha>` again and `npx wrangler deployments status` lists the new version at 100%.

Record the date of the drill and any surprise (for example a missing token permission) in the pull request or release notes.

## CI minutes

GitHub Free includes 2,000 Actions minutes a month for private repositories, each job is rounded up to a whole minute, and private repositories get 2-core Linux runners instead of 4-core, so expect slower jobs (check GitHub's billing docs; limits and runner sizes change). Actual figures: the Billing page, or `gh api /users/greenblacked/settings/billing/usage`.

What the pipeline already does: PR runs of `ci.yml` cancel when a newer commit arrives, `ci.yml` runs on pull requests into `main` and on pushes to `main` only (a commit never gets both), every job has a timeout, there are no scheduled workflows, CI caches npm, the Quartz plugins and the Playwright browsers, and every job runs in a few minutes except the cold deploy builds.

### CI job graph

Every check runs on every pull request and every push to `main`; none is optional, path-filtered or deferred. `CI OK` waits for all jobs. The durations in the graph are estimated for 2-core runners (private repositories). The CI-measured figures are from public 4-core runner runs on 2026-10-20: the single browser job, the cold plugin restore and the 8-shard graph (about 4 minutes start to CI OK, see "Measured 8-shard runs" below). The 2-core private figures are still estimated.

```
workflow-lint            attribution, actionlint, shellcheck, zizmor            about 15 s
build-and-check          type check, check:notes, build, check:links,
                         check-artifact, upload ci-site, test:scripts,
                         check:contrast, deploy:dry-run                          about 85 to 100 s warm
  browser (8 jobs)       each: check-artifact --root, build-csp, check:browser,
                         one Playwright project shard (+ format:check in
                         chromium-desktop-1)                                     about 110 to 150 s after the build
ci-ok                    CI OK                                                    seconds
```

`test:scripts`, `check:contrast` and `deploy:dry-run` stay in the build job because they need `public/` and the restored plugins (without them some of their checks skip, which would weaken them). `format:check` needs neither and runs in the first Chromium desktop browser job.

### Why CI is not 2 minutes

The target was 2 minutes with every check. It is not reachable on GitHub-hosted runners for the browser suite, because a browser job needs the build output and the setup of every job is a fixed cost. The owner chose 8 shards (about 4.3 minutes and about 25 billed minutes per run on 2-core runners, estimated; 4 min 0 s to 4 min 5 s and 24 to 25 billed minutes measured 2026-10-20 on 4-core runners, public repository) over the 2-minute target, which would need about 38 shards. All figures below are estimated unless marked measured; re-measure after the repository is private:

- A browser job needs the build output, so the critical path is the build (about 85 to 100 s on 2 vCPU), then a shard's setup (checkout, `npm ci`, artifact download, browser restore, about 55 to 65 s), then its tests, then `CI OK`. That is about 150 to 160 s before the first test starts.
- With 8 shards the floor is about 4.3 minutes on 2 vCPU (the slowest is a WebKit shard) and about 3.2 minutes on 4 vCPU. Running the browser jobs before the build finishes and waiting for the artifact would need about 38 shards, about 80 billed minutes per run, so it was rejected.
- Measured locally on a development machine (not in CI), the suite is 172 tests (43 per project: home-start-here 7, learn-nav 9, note-credit 11, page-problems 3, smoke 9, theme-switch 4), about 4 s each on Chromium; two workers on 2 CPUs take about 227 s for the two Chromium projects against 170 s on 4 CPUs. Four workers on 2 CPUs were no faster and made the theme-switch test flaky, so `workers` stays at 2.
- Follow-ups, not part of this change: `trace: "retain-on-failure"` costs about 23% of the test time (`on-first-retry` is faster but exposes a race in which the explorer plugin logs `Failed to fetch` when a test navigates while it loads the 5.5 MB `static/contentIndex.json`), and every page downloads that file 2 to 3 times.

### Measured 8-shard runs

Measured 2026-10-20 on 4-core runners (public repository), PR #73, two runs of the 8-shard graph (22 and 21 tests per shard):

| Head      | Start to CI OK | Build and check | Slowest browser shard        | Billed minutes |
| --------- | -------------- | --------------- | ---------------------------- | -------------- |
| `214d3f4` | 4 min 5 s      | 1 min 19 s      | webkit-desktop-1, 2 min 35 s | 25             |
| `cce229a` | 4 min 0 s      | 1 min 13 s      | webkit-desktop-1, 2 min 39 s | 24             |

Job durations from the GitHub API (`started_at` to `completed_at`), with billed minutes in brackets (each job's duration rounded up to a whole minute, minimum 1; the total is the sum over the 11 jobs):

- Run of `214d3f4`: Build and check 1:19 (2), Lint 0:14 (1, its re-run), chromium-desktop-1 2:01 (3), chromium-desktop-2 1:15 (2), chromium-phone-1 1:43 (2), chromium-phone-2 1:40 (2), webkit-desktop-1 2:35 (3), webkit-desktop-2 2:15 (3), webkit-phone-1 2:34 (3), webkit-phone-2 2:09 (3), CI OK 0:02 (1); total 25 billed minutes.
- Run of `cce229a`: Build and check 1:13 (2), Lint 0:14 (1), chromium-desktop-1 1:58 (2), chromium-desktop-2 1:19 (2), chromium-phone-1 1:43 (2), chromium-phone-2 1:30 (2), webkit-desktop-1 2:39 (3), webkit-desktop-2 2:04 (3), webkit-phone-1 2:30 (3), webkit-phone-2 2:06 (3), CI OK 0:04 (1); total 24 billed minutes.

Billed minutes per measured 4-core run are 24 to 25. These are 4-core figures; the 2-core private-repository figures below stay estimated.

### Shards and billed minutes

The browser matrix uses `fail-fast: false`: when one shard fails the others finish, `CI OK` still fails, and "Re-run failed jobs" re-runs only the failed shard (about 3 billed minutes, estimated). With `fail-fast: true` the cancelled shards would be re-run too, costing about 8 minutes or more (estimated). The price is that a real failure still bills the other shards. The shard count is the `matrix.include` list of the `browser` job in `.github/workflows/ci.yml` (each project's shards must be exactly `1/N` to `N/N`; `scripts/workflows.test.mjs` checks it). More jobs shorten the wall-clock time, but each job bills at least one whole minute and is rounded up on its own. Rows are estimated with warm caches, except the first row and the measured 8-shard row, which were measured on public 4-core runners on 2026-10-20 (re-measure from `gh api repos/greenblacked/Notes/actions/runs/<id>/jobs`):

| Variant                                 | PR wall-clock | Billed per CI run                   | Per merged PR (3 PR runs, 1 push run, Deploy stage)                  | Merged PRs per 2,000 min |
| --------------------------------------- | ------------- | ----------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| Before: one browser job (4 vCPU)        | 7 to 11.5 min | 10 to 14                            | 50 to 55                                                             | about 35                 |
| Before, projected on 2 vCPU             | about 12.5    | about 15                            | about 71                                                             | about 28                 |
| 8 shards (this setup), estimated 2-core | about 4.3     | about 25                            | about 111                                                            | about 18                 |
| 8 shards (this setup), measured 4-core  | 4.0 to 4.1    | 24 to 25 (11 jobs, each rounded up) | about 111 (4 runs x 25 + Deploy stage about 11, worst case, derived) | about 18                 |
| 4 jobs (one per project, `shard: 1/1`)  | about 5.7     | about 19                            | about 87                                                             | about 23                 |
| About 38 shards (rejected)              | about 2       | about 80                            | about 330                                                            | about 6                  |

Eight shards cost about two more billed minutes per run than six because of the rounding, but each shard sits near a minute boundary, so the figure is sensitive. Switching to four jobs is a matrix change (`shard: 1/1` and one entry per project). GitHub Free allows about 20 concurrent jobs (check the docs); one run uses up to 10 of them, so a third concurrent run queues.

Cold runs are slower: a plugin-cache miss (only when `quartz.lock.json` changes) adds about 7 to 8 minutes measured on 4-core runners (2026-10-20), more on 2-core; a Playwright cache miss adds about 30 to 50 s per shard (estimated). PR runs read the caches written by `main` and write only their own scope; no cache or artifact written by a PR run is read by a deploy.

Savings from the private-repository change, estimated from the run durations of 2026-10-10 to 2026-10-20 (about 550 CI runs and 125 Deploy stage runs a month at that burst cadence):

| Change                                                      | Per run                          | Per month        |
| ----------------------------------------------------------- | -------------------------------- | ---------------- |
| Attribution check merged into the workflow lint job         | 1 min per CI run                 | about 550        |
| Deploy stage guard is the first build step                  | 1 min per Deploy stage run       | about 125        |
| Playwright browser cache                                    | unmeasured, likely 0 to 0.25 min | not counted      |
| Dependabot version updates monthly                          | fewer PRs (23 to 35 min each)    | about 100 to 150 |
| Repository-level secret and variable, production actor gate | 0                                | 0                |
| Total (without the browser cache)                           |                                  | about 775 to 825 |

Before the shard matrix a merged PR cost about 55 minutes (about 3 PR CI runs at about 11, the push run on `main` at about 11 and Deploy stage at about 11), so 2,000 minutes covered about 35 merged PRs a month; with 8 shards see the table above. Re-measure the browser cache saving (a hit still runs the apt part and restores the cache; a miss also saves it) after 10 runs from the step timings of `gh api repos/greenblacked/Notes/actions/runs/<id>/jobs`.

Levers not taken, both owner decisions:

- A restore-only Quartz plugin cache in the Deploy stage build (about 875 minutes a month): it reverses the no-cache-in-deploy policy above, which exists to keep cache poisoning away from the jobs that feed the deploy.
- Fewer browser projects on push runs (up to about 2,000 minutes a month): it changes a gate. Any variant must keep both Chromium and WebKit before merge.

## Dependency updates

Dependabot (`.github/dependabot.yml`) updates npm (the root and `tools/`), GitHub Actions and the pinned zizmor requirement monthly with a cooldown (to save Actions minutes on the private repository); security updates are not tied to the schedule. Version and security updates target `main`. The vendored Quartz engine is not updated by Dependabot; use `scripts/update-quartz.sh <tag>` (see the README).
