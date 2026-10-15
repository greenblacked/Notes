# Deployment

The site is a static Quartz build served by one Cloudflare Worker, `notes` (`worker/`), with static assets. Production and the dev site are two views of that Worker:

| Environment | What                                    | URL                            | Updated by                                                   |
| ----------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| production  | The deployed Worker (`wrangler deploy`) | https://notes.szolotov.com     | `release.yml` / `deploy-production.yml` on tags              |
| dev         | Worker Preview named `dev`              | https://dev.notes.szolotov.com | `deploy-dev.yml` (`wrangler preview`), manually, from `main` |

There is no stage environment. The path of a change is: feature branch, preview shown by the maintainer (screenshots or video, outside Cloudflare), pull request, merge to `main`, **Deploy dev** when the owner asks for it, **Release** with a tag, production (with approval).

Both sites are also reachable on the Worker's workers.dev URLs, which CI uses for verification (see [Bot Fight Mode](#cloudflare-blocks-the-smoke-test)). Indexing is decided per request in `worker/indexing.js`: only the production build on the host `notes.szolotov.com` is indexable; the dev Preview, every workers.dev host and localhost send `X-Robots-Tag: noindex, nofollow` and a disallow-all `robots.txt`.

Workflows (all in `.github/workflows/`):

- `ci.yml`: build, type check, link check, build-output check (`scripts/check-artifact.mjs`), script and Worker-policy tests (`npm run test:scripts`), format check, `wrangler deploy --dry-run`, actionlint and zizmor. The aggregate job `CI OK` is the required status check.
- `deploy-dev.yml`: manual only (`workflow_dispatch`, input `action`), no push trigger. A `guard` job fails every run that was not started from `main`. With `action` = `deploy`, a `build` job builds the exact commit, then an `upload` job (environment `dev`) runs `wrangler preview --name dev` and smoke-tests the Preview's workers.dev URL. If the commit is no longer the head of `main` (a newer push landed), checked at the start of `build` and again right before the upload, the run skips with a notice and succeeds. With `action` = `remove-stage`, one job deletes the old `stage` Preview ([below](#dev-preview)).
- `release.yml`: manual. Validates the version, requires a successful CI run for the commit (`.github/scripts/require-ci-success.sh`), creates an annotated tag and a GitHub Release, then calls `deploy-production.yml`.
- `deploy-production.yml`: `guard` (tag check, successful CI run for the commit, commit on `main`), `build`, then `deploy` (environment approval, record the live version, `wrangler deploy`, smoke test on workers.dev, check that the new version serves 100%, automatic rollback on failure).

## Dev Preview

The dev site is a [Worker Preview](https://developers.cloudflare.com/workers/previews/) (open beta) named `dev` of the Worker `notes`, not a second Worker. `wrangler preview --name dev` uploads the build as a new deployment of that Preview; it never changes production traffic, has no rollback and is not recorded anywhere but in Cloudflare. It is the pre-production site: what the owner looks at after a merge and before tagging a release.

- Deployed **manually, from `main`, when the owner asks**: Actions, **Deploy dev**, Run workflow, branch `main`, action `deploy`. The run summary and the `dev` environment link to https://dev.notes.szolotov.com once it is deployed (about 15 minutes, the build is cold). There is no push trigger, so dev may lag behind `main` by design; `/version.txt` on dev shows which commit it serves.
- Only `main`: the `guard` job fails any run started from another branch ("Deploy dev runs only from main; select main in Run workflow"), and the `dev` environment allows `main` only. The jobs that hold the Cloudflare token therefore run only code that went through the `main` ruleset. The `dev` branch is not used.
- Feature previews are not done in Cloudflare. The maintainer shows a feature branch with screenshots or a video; only merged work reaches dev.
- Settings: Preview settings are separate from the top level of `wrangler.jsonc` (not inherited). `previews.vars` sets `ENVIRONMENT=preview`; top-level `vars` sets `production`. The Worker only checks for `production`, so any other value is noindex.
- URL: the route `{ "pattern": "notes.szolotov.com", "custom_domain": true, "previews_enabled": true }` makes the custom domain serve production and Previews. Cloudflare manages a wildcard for `*.notes.szolotov.com`, so the Preview `dev` is served at https://dev.notes.szolotov.com ([Previews on custom domains](https://developers.cloudflare.com/workers/previews/custom-domains/)).
- `wrangler preview` does not apply routes. `previews_enabled` is applied by `wrangler deploy` (the first release) or in the dashboard (Workers & Pages, `notes`, Domains, **Production and Preview**). Until then the Deploy dev run fails with an error that points here: the Preview exists, but only on its workers.dev URL.
- Indexing: Cloudflare adds `X-Robots-Tag: noindex` only on workers.dev Preview URLs, not on custom-domain Previews. The Worker therefore sends noindex itself for everything that is not production on `notes.szolotov.com`. In the smoke test on workers.dev, the `robots.txt` check (`Disallow: /`) is what actually tests the Worker's policy.
- Cloudflare Access: this account protects Worker Previews with Cloudflare Access, so the Preview's workers.dev URL redirects to the Access login. The smoke test recognises that redirect and passes with a notice (`SMOKE_ALLOW_ACCESS` in `deploy-dev.yml`); Wrangler reporting `https://dev.notes.szolotov.com` is then the verification. Production never allows it: a redirect to Access fails the production smoke test.
- Smoke test retries: `/version.txt` is retried until it serves the expected build, then the content, header and indexing checks are retried as a set (`SMOKE_CHECK_ROUNDS`, default 6, every `SMOKE_CHECK_DELAY`, default 10 s), because a new route or custom domain can take a moment to reach every Cloudflare edge.
- Who is trusted with the token: while `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are **repository** secrets, every workflow on every branch can read them, so everyone with write access is trusted with a token that can deploy production. That is fine for a single-owner repository. Before giving anyone else write access, move them into **environment** secrets: `production` (tags `v*` and branch `main`, required reviewers) and `dev` (branch `main`), and delete the repository secrets. A workflow on another branch then cannot reach the token.
- Remove the Preview: `npx wrangler preview delete --name dev`.

### Removing the old `stage` Preview (one time)

The earlier setup had a second Preview, `stage`, updated on every merge to `main`. It is gone from the workflows, but the Preview itself still exists in Cloudflare until it is deleted. Do this once, after this change is on `main`:

1. Actions, **Deploy dev**, Run workflow, branch `main`, action `remove-stage`. The job (environment `dev`) runs `wrangler preview delete --name stage --skip-confirmation` and writes a summary.
2. Re-running is harmless: if Cloudflare reports that the Preview does not exist, the step passes with a notice. Any other error (for example a rejected token) fails the step.
3. Check that nothing is left: `curl -sI https://stage.notes.szolotov.com` no longer serves the site, and DNS for `szolotov.com` has no manual `stage.notes` record.
4. Delete the GitHub environment `staging` (Settings, Environments) and the `stage`-related variable `STAGE_SMOKE_TEST` if you set one (it is now `DEV_SMOKE_TEST`). Also delete the `dev` branch on GitHub; nothing uses it.

## One-time setup checklist

### 1. Cloudflare

1. The zone `szolotov.com` must be an **active zone in the same Cloudflare account** that the token and account id belong to. Custom Domains need an active zone and cannot be created on a hostname that already has a CNAME record ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
2. Make sure no DNS record already exists for `notes.szolotov.com` or `dev.notes.szolotov.com` (the latter would shadow the Preview wildcard). Wrangler creates the DNS records and certificates for the Custom Domain itself on the first deploy.
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

Sources: [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/) and [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token). Validate the grants with a real deploy (the first release); tighten or add permissions from the error it reports.

Scope account resources to the one account and the zone resource to `szolotov.com` only.

What is **not verified** (confirm with the first release):

- Which of the Account Settings, Workers Tail and Memberships read permissions are needed when `CLOUDFLARE_ACCOUNT_ID` is set. They come from Cloudflare's own Workers Builds token.
- Whether `wrangler preview` needs anything beyond Workers Scripts: Edit. Worker Previews are in open beta.

### 2. GitHub repository settings

**Actions, General**

- Workflow permissions: **Read repository contents and packages permissions** (default read-only). Every workflow declares its own permissions; `release.yml` requests `contents: write` and `actions: read` on its job only. "Allow GitHub Actions to create and approve pull requests" is not needed.
- Allowed actions: optionally restrict to actions from this repository plus `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact` and `actions/download-artifact`, and enable "Require actions to be pinned to a full-length commit SHA".

**Variables and secrets**

- `CLOUDFLARE_ACCOUNT_ID` at repository level, as a variable (Settings, Secrets and variables, Actions, Variables) or as a secret. The workflows use the variable when it is set and fall back to the secret.
- Secret `CLOUDFLARE_API_TOKEN`: preferably in **each environment** (below), so only jobs that passed the environment's rules can read it. A repository-level secret also works; an environment secret with the same name takes precedence over it.

**Environments** (Settings, Environments)

| Environment  | Protection                                                                                                                                                                                                          | Secret                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `dev`        | Deployment branches: `main` only. No reviewers. (The old `staging` environment can be deleted.)                                                                                                                     | `CLOUDFLARE_API_TOKEN` |
| `production` | Required reviewers: `greenblacked` (self-review is allowed if you are the only maintainer; otherwise enable "Prevent self-review"). Deployment branches and tags: add **tag** rule `v*` and **branch** rule `main`. | `CLOUDFLARE_API_TOKEN` |

Why `main` is in the production rules: `release.yml` calls `deploy-production.yml` as a reusable workflow, and that call runs with `github.ref = refs/heads/main`. The `v*` tag rule covers tag pushes and manual re-runs from a tag.

Trade-off of a single Worker: the Preview and production are the same Worker, so the token of the `dev` environment can also deploy production. A separate token per environment does not change that. The controls are the `main` branch ruleset (pull request and `CI OK` required) and the `dev` environment being restricted to `main`: only reviewed code reaches the job that holds the token.

The secret passed from `release.yml` (`secrets: CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`) is evaluated in the calling job, which has no environment. The called `deploy` job declares `environment: production`, so the production environment's secret of the same name is what the job sees. This precedence is the intended design but **unverified**: check the first release. If the deploy step reports a missing token, add the same secret at repository level as well.

**Production is tag-only, enforced in the workflow.** The `guard` job in `deploy-production.yml` runs before the environment approval and refuses everything that is not a release tag: for push and manual runs `github.ref` must be `refs/tags/vX.Y.Z`; for the call from `release.yml` the `tag` input must be `vX.Y.Z` and the tag must resolve to exactly `github.sha`. The deploy job then checks out `github.sha`. This does not depend on the `production` environment rules; those additionally allow `main` only so the call from `release.yml` can run.

**The guard only catches mistakes.** On a tag push or a manual run from a tag, GitHub runs the workflow file and the guard script from the tagged commit, so whoever can create a tag controls the code that checks it. The controls that decide who can deploy production are the tag ruleset (who may create `v*` tags) and the required reviewers of the `production` environment (with "Prevent self-review" enabled when more than one person has access), both under [Repository settings you must apply](#repository-settings-you-must-apply). Without them the guard does not stop a malicious tag.

The guard also requires, for every path (tag push, manual run and the call from `release.yml`), a successful `ci.yml` run for the exact commit (event `push`, branch `main`) and that the commit is on `main` (`compare/main...<sha>` reports `identical` or `behind`), both in `.github/scripts/require-ci-success.sh`, which `release.yml` uses too. A tag on a commit that never passed CI on `main`, or on a branch that was never merged, is therefore not deployed even if someone manages to create it. The guard job has `contents: read` and `actions: read` only; because the call from `release.yml` caps the called job's permissions, `release.yml`'s `deploy` job grants `actions: read` as well. The script is read from the tagged commit, so this protects against mistakes (a tag on the wrong commit), not against someone who can create tags.

Rulesets, the environment branch and tag policies and the optional separate Cloudflare token are listed in [Repository settings you must apply](#repository-settings-you-must-apply).

### 3. First deploy order

1. Actions, **Release**, Run workflow on `main`, version `0.1.0`. After the tag and release are created the production deploy waits for approval; approve it in the run. The first production deploy creates the `notes` Worker, the Custom Domain `notes.szolotov.com` and, through `previews_enabled`, the Preview wildcard.
2. Actions, **Deploy dev**, Run workflow on `main`, action `deploy`. `deploy-dev.yml` creates the `dev` Preview. Before the first release it fails at the "Require the custom domain Preview URL" step, because the Preview is only on workers.dev ([Dev Preview](#dev-preview)).
3. Validate production and dev (commands below). DNS and the certificate can take a few minutes; the smoke test retries for about 2.5 minutes.

If an old `stage` Preview exists, remove it once with the `remove-stage` action ([Dev Preview](#removing-the-old-stage-preview-one-time)).

## Production is tag-only

See "Production is tag-only, enforced in the workflow" above. In short: a branch run of `deploy-production.yml` cannot deploy, whatever the environment settings say. On a tag push or tag dispatch the workflow file and the guard script come from the tagged commit, so the guard only catches mistakes. The real controls for who can create a production tag are the `v*` tag ruleset and required reviewers on the `production` environment (see [Repository settings you must apply](#repository-settings-you-must-apply)).

## Build and deploy are separate jobs

`npm run build` runs `quartz plugin restore`, which at build time clones about 40 third-party Quartz plugins (`github.com/quartz-community/*`) at the commits pinned in `quartz.lock.json`, then runs `npm install` and `npm run build` inside each. That is third-party code, and the plugins' transitive npm dependencies are not pinned by any lockfile of ours. This is a known supply-chain risk. It is mitigated by isolating secrets and by reviewing every change to `quartz.lock.json`.

- The `build` job has no environment, no secrets and `contents: read` only. It builds, checks links, checks the output with `scripts/check-artifact.mjs --public public` and uploads an artifact (`public/` only, retention 1 day). It runs with `NPM_CONFIG_IGNORE_SCRIPTS=true`, in `ci.yml` too: no install script of our dependencies or of the plugins' npm dependencies (`npm install` inside each plugin honours the variable) runs. The build does not need any: the plugins are compiled by their `npm run build`, which is run explicitly and still works.
- The `upload` and `deploy` jobs (the ones with the `dev` or `production` environment and the Cloudflare token) check out the commit fresh and install **only wrangler**, from `tools/` (`npm ci --ignore-scripts --prefix tools`; `tools/package.json` pins wrangler to the same version as the root `package.json`, with its own lockfile). They do not install the root dependencies: `@quartz-community/types` and `@quartz-community/utils` are git dependencies with a `prepare` script, which npm runs even with `--ignore-scripts`, so a root install would run third-party code next to the token. The other scripts these jobs run (`check-artifact.mjs`, `build-csp.mjs`, `read-wrangler-output.mjs`, `smoke-test.sh`) use only Node built-ins, and the Worker imports no npm package, so wrangler bundles it from `tools/`. The jobs download the artifact, validate it with `scripts/check-artifact.mjs --root`, regenerate `worker/csp.generated.js` from the checked `public/` with `node scripts/build-csp.mjs`, and only then run wrangler (`tools/node_modules/.bin/wrangler`). The token is set on the individual wrangler steps, never job-wide. Keep `tools/` and the root wrangler version in step (Dependabot has an entry for each).
- The artifact check accepts only `public/` (a `worker/` directory fails it: no Worker code comes from the build, the CSP hashes are recomputed from the checked `public/`), and in `public/` only regular files whose extension is in the allowlist of `scripts/check-artifact.mjs` (`.css .html .ico .js .json .map .mjs .png .txt .woff2 .xml`, the set a build produces) and never `_redirects` or `_headers` (Cloudflare would apply them to the site; routing and headers belong to the Worker). A new kind of file in the site fails the build until the allowlist is extended on purpose.
- Build jobs need network access to github.com and the npm registry.
- No dependency cache is used in the deploy and release workflows (cache-poisoning risk), so every deploy build restores plugins cold: expect about 15 minutes (the build job timeout is 45 minutes). CI caches `.quartz/plugins` keyed on `quartz.lock.json`, so a warm CI build takes seconds.
- Production approval happens at the `deploy` job, after the build has finished.

## Validation commands

```sh
curl -sI https://notes.szolotov.com
curl -s  https://notes.szolotov.com/version.txt        # <X.Y.Z>+<40-char commit sha>
curl -s  https://notes.szolotov.com/robots.txt         # allows crawling, lists the sitemap
curl -sI https://notes.szolotov.com | grep -i x-robots-tag   # no output expected

curl -sI https://dev.notes.szolotov.com | grep -i x-robots-tag   # noindex, nofollow
curl -s  https://dev.notes.szolotov.com/version.txt        # main+<40-char commit sha>
curl -s  https://dev.notes.szolotov.com/robots.txt         # Disallow: /
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

Rollback applies to production only. The dev Preview is not part of rollback and has no rollback of its own: merge a fix and run **Deploy dev** again, or remove it with `npx wrangler preview delete --name dev`. You can only roll back to one of the 100 most recent versions, and not if bindings changed ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). A rollback is not recorded in git: the site then serves an older build while `main` has moved on.

Roll forward or back through the pipeline: Actions, **Deploy production**, "Run workflow" with the **tag** selected as the ref (for example `v0.1.0`), approve. This rebuilds that tag and deploys it. If the deploy or smoke test fails, the workflow rolls back to the version that was live before the run and fails the job.

Automatic rollback is skipped when no previous version could be recorded (first deploy) or when a gradual deployment is active (more than one version).

## Troubleshooting

| Symptom                                                                                       | Likely cause and fix                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails: "A DNS record already exists" / custom domain conflict                          | A CNAME/A record for the hostname exists. Delete it in Cloudflare DNS, then redeploy. Custom Domains cannot be created over an existing CNAME.                                                                                                                                                  |
| `Authentication error [code: 10000]`                                                          | Token missing a permission or scoped to the wrong account or zone. Re-check the table above, the secret in the right environment, and that the zone is in the same account.                                                                                                                     |
| `Could not route to /accounts/...` or wrong account                                           | `CLOUDFLARE_ACCOUNT_ID` (variable or secret) missing or from another account.                                                                                                                                                                                                                   |
| Deploy job sits at "Waiting"                                                                  | The `production` environment requires approval; approve in the run. If it is rejected immediately: the branch/tag rules of the environment do not include `main` or `v*`.                                                                                                                       |
| Deploy dev run finishes in seconds with a notice "no longer the head"                         | Expected: a newer commit reached `main` while the run was building; run **Deploy dev** again if dev should have it. Nothing to fix.                                                                                                                                                             |
| Smoke test: `/version.txt` does not match                                                     | Edge propagation or Custom Domain still provisioning (retried for about 2.5 minutes). If it persists, check `npx wrangler deployments status`, and that the build used the right `NOTES_VERSION` and `NOTES_SHA`. Stale caches are bypassed by a random query string.                           |
| Smoke test: `GET /` returns 403 without `X-Robots-Tag`, while `/version.txt` passes           | A Cloudflare security feature answered instead of the Worker (the Worker sets its headers on every response, errors included). The smoke test prints `server`, `cf-ray` and `cf-mitigated` for the failing response; see [Cloudflare blocks the smoke test](#cloudflare-blocks-the-smoke-test). |
| Deploy dev fails: "The dev Preview is not served at https://dev.notes.szolotov.com"           | `notes.szolotov.com` is not enabled for Production and Preview yet (first release not done, or the toggle is off), or the Preview wildcard is still provisioning. Run the first release or enable it in the dashboard, then run **Deploy dev** again. See [Dev Preview](#dev-preview).          |
| Deploy dev: custom domain preview URL missing, `dev.notes` has a DNS record                   | A manual `dev.notes` DNS record shadows the Preview wildcard. Remove it.                                                                                                                                                                                                                        |
| Deploy dev fails at "Require main": "Deploy dev runs only from main"                          | The run was started from another branch. Run workflow again with branch `main` selected.                                                                                                                                                                                                        |
| `curl https://notes.szolotov.com` works from your machine but CI sees 403                     | Bot Fight Mode on the zone blocks GitHub-hosted runners on the custom domains. Expected: CI verifies on workers.dev and only logs a notice for the custom domain. See [below](#cloudflare-blocks-the-smoke-test).                                                                               |
| Dev smoke test cannot pass (dev behind Cloudflare Access)                                     | Expected when Access protects Previews: the smoke test logs a notice and passes. To skip it entirely, set the variable `DEV_SMOKE_TEST` to `false` (repository or `dev` environment); the Preview is still uploaded.                                                                            |
| Deploy production: guard fails with "No successful ci.yml push run found" or "is not on main" | The tagged commit has no successful CI push run on `main`, or is not reachable from `main`. Merge it through a pull request and let CI finish on `main`, then tag a commit from `main`.                                                                                                         |
| Release: "No successful ci.yml push run found"                                                | CI on `main` for that commit has not finished or failed. Wait or fix, then re-run Release.                                                                                                                                                                                                      |
| Release: tag step fails with a ruleset error                                                  | The tag ruleset blocks creation by the Actions app. See the tag ruleset notes above.                                                                                                                                                                                                            |
| Release: "must be strictly greater than the latest tag"                                       | Pick a higher X.Y.Z. A failed release after the tag step needs a new version number (tags are never reused); re-run only the deploy via Deploy production on that tag.                                                                                                                          |

### Cloudflare blocks the smoke test

Bot Fight Mode on the `szolotov.com` zone answers GitHub-hosted runners with HTTP 403 (`cf-mitigated`) on the custom-domain hosts (observed on https://dev.notes.szolotov.com). That is why the Worker keeps `workers_dev` and `preview_urls` enabled and the deploy workflows smoke-test the workers.dev URLs and check `wrangler deployments status`, and fetch the custom domains once only to log a notice. The rest of this section is for when you want the custom domains checked too (zone WAF rules do not apply to workers.dev).

Symptom: `/version.txt` and `/robots.txt` pass, but `GET /` (HTML) fails with 403 and no `X-Robots-Tag`. The Worker adds its headers to every response, errors included, so the 403 was produced in front of it. GitHub-hosted runners come from cloud provider IP ranges, which Cloudflare's bot protections may challenge while ordinary visitors get through. The smoke test reports it as `blocked by Cloudflare (cf-mitigated: <value>)` and prints the `cf-ray` value.

1. **Find what acted.** In the Cloudflare dashboard open **Security, Events**, filter on the hostname, and look up the Ray ID from the smoke-test log. The event names the product (Bot Fight Mode, Super Bot Fight Mode, a managed rule, Security Level).
2. **Bot Fight Mode (Free plan):** to my knowledge it cannot be bypassed with a WAF custom rule (Skip action) or any other exception; the only control is turning it off for the whole zone (**Security, Bots**). Confirm this against the current [Bot Fight Mode documentation](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/) before deciding; I could not re-check it from the build environment. CI is unaffected by it: the deploy workflows verify on the workers.dev URLs, so only CI's fetches of the custom domains are blocked (logged as notices).
3. **Super Bot Fight Mode or other WAF features (Pro and above):** add a WAF custom rule with the action **Skip** for the products that fired (see [Skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)), matching both hostnames and a shared secret header rather than the User-Agent, which anyone can spoof:

   ```text
   (http.host in {"notes.szolotov.com" "dev.notes.szolotov.com"}
    and any(http.request.headers["x-notes-smoke-test"][*] eq "<value of SMOKE_TEST_TOKEN>"))
   ```

   Then add the same random value as the GitHub secret `SMOKE_TEST_TOKEN` (repository level, or in both `dev` and `production`), for example from `openssl rand -hex 32`. The deploy workflows pass it to `scripts/smoke-test.sh`, which sends it as the `X-Notes-Smoke-Test` request header; without the secret the header is not sent. Rotate it by updating the rule and the secret together.

The smoke test also sends the User-Agent `notes-smoke-test/1 (+https://github.com/greenblacked/Notes)` (override with `SMOKE_USER_AGENT`), which makes its requests easy to find in Security Events.

## Repository settings you must apply

These cannot be set from the repository. The pipeline assumes them: without them anyone with write access can bypass its checks.

**Ruleset for `main`** (Settings, Rules, Rulesets, target branch `main`)

- Enforcement: Active. Bypass list: empty (no bypass for admins, apps or roles).
- Require a pull request before merging.
- Require status checks to pass: `CI OK` (the aggregate job of `ci.yml`).
- Block force pushes. Restrict deletions.
- Optional: require linear history, require branches to be up to date.

**Ruleset for `v*` tags** (target tag, pattern `v*`)

- Restrict creations, updates and deletions. Bypass list: the repository **admin** role and the **GitHub Actions** app, which is the actor that creates the tag in `release.yml` (`GITHUB_TOKEN`).
- Not verified: whether the GitHub Actions app can be added to a ruleset's bypass list. If it is not offered, a creation restriction makes `release.yml` fail at "Create annotated tag" (403 or ruleset error; nothing is deployed). Then restrict only updates and deletions, so a published tag can never be moved or removed, and accept that creations are limited only by the required reviewers on the `production` environment: the `guard` job is not a control for creations, because a tag push runs the workflow and guard script of the tagged commit ([Production is tag-only](#production-is-tag-only)). Use "Prevent self-review" on that environment when more than one person has access.
- With the ruleset in place, the real controls for production are this ruleset (who can create `v*` tags) **and** required reviewers on the `production` environment (with "Prevent self-review" when more than one person has access). The guard only catches mistakes.

**Environments** (Settings, Environments; details in the [table above](#2-github-repository-settings))

- `dev`: deployment branches limited to `main` (a deployment branch policy, "Selected branches and tags", rule `main`). Only code that went through the `main` ruleset can reach the job that holds the Cloudflare token. The old `staging` environment can be deleted.
- `production`: deployment branches and tags limited to the tag rule `v*` and the branch rule `main` (`main` for the call from `release.yml`), plus required reviewers.

**Optional: a separate Cloudflare account or token for dev.** The dev Preview is a Preview of the same Worker, so the dev token can also deploy production. If that matters, deploy dev from a separate Cloudflare account (its own `CLOUDFLARE_ACCOUNT_ID` and token in the `dev` environment, and a Worker named `notes` there) so a compromised dev job cannot touch production. This costs a second zone or hostname for the dev URL; the single-Worker setup in this guide does not do it.

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

5. Roll forward through the pipeline (never leave a manual rollback in place): Actions, **Deploy production**, Run workflow, select the **tag** of the newest release as the ref (for example `v0.3.0`), approve the `production` environment. For a tag created after this change the guard re-checks the tag, CI and `main`; tags created before it (for example `v0.1.0` to `v0.3.0`) run their own workflow file, which has no CI check, so only their own checks apply. The deploy smoke-tests workers.dev. Redeploying a very old tag also needs the `ci.yml` run record for its commit to still exist; run records expire with the retention period. If it is gone, the guard of a newer tag fails closed ("No successful ci.yml push run found") and the manual `wrangler rollback` from step 3 is the path.

6. Validate again: `curl -s https://notes.szolotov.com/version.txt` shows `0.3.0+<sha>` again and `npx wrangler deployments status` lists the new version at 100%.

Record the date of the drill and any surprise (for example a missing token permission) in the pull request or release notes.

## Dependency updates

Dependabot (`.github/dependabot.yml`) updates npm (the root and `tools/`), GitHub Actions and the pinned zizmor requirement weekly with a cooldown. The vendored Quartz engine is not updated by Dependabot; use `scripts/update-quartz.sh <tag>` (see the README).
