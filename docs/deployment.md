# Deployment

The site is a static Quartz build served by one Cloudflare Worker, `notes` (`worker/`), with static assets. Production and the dev site are two views of that Worker:

| Environment | What                                    | URL                            | Updated by                                                    |
| ----------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| production  | The deployed Worker (`wrangler deploy`) | https://notes.szolotov.com     | `release.yml` / `deploy-production.yml` on tags               |
| dev         | Worker Preview named `dev`              | https://dev.notes.szolotov.com | `deploy-dev.yml` (`wrangler preview`), on every push to `dev` |

There is no stage environment. The path of a change is: work branch `<type>/<kebab>` from `dev`, pull request into `dev` (`CI OK` required), merge (this deploys dev automatically), pull request `dev` to `main` (merge commit), **Release** with a tag, production (with approval). Feature branches are not previewed in Cloudflare; only work merged to `dev` reaches the dev site.

Both sites are also reachable on the Worker's workers.dev URLs, which CI uses for verification (see [Bot Fight Mode](#cloudflare-blocks-the-smoke-test)). Indexing is decided per request in `worker/indexing.js`: only the production build on the host `notes.szolotov.com` is indexable; the dev Preview, every workers.dev host and localhost send `X-Robots-Tag: noindex, nofollow` and a disallow-all `robots.txt`.

Workflows (all in `.github/workflows/`):

- `ci.yml`: pull requests and pushes for `main` and `dev`: build, type check, link check, build-output check (`scripts/check-artifact.mjs`), script and Worker-policy tests (`npm run test:scripts`), format check, `wrangler deploy --dry-run`, actionlint and zizmor. The aggregate job `CI OK` is the required status check.
- `deploy-dev.yml`: runs on every push to `dev`, plus `workflow_dispatch` (from `dev` only). A `guard` job accepts only the repository, the ref `refs/heads/dev`, the events `push` and `workflow_dispatch`, and the owner as actor and triggering actor. A `build` job (no secrets) builds the exact commit, then an `upload` job (environment `dev`) runs `wrangler preview --name dev` and smoke-tests the Preview's workers.dev URL. The head of `dev` is checked at the start of `build` and again right before the upload; if a newer commit has landed, the run skips with a notice and succeeds. Runs queue and the newest wins.
- `release.yml`: manual. Validates the version, requires a successful CI run for the commit (`.github/scripts/require-ci-success.sh`), creates an annotated tag and a GitHub Release, then calls `deploy-production.yml`.
- `deploy-production.yml`: `guard` (tag check, successful CI run for the commit, commit on `main`), `build`, then `deploy` (environment approval, record the live version, `wrangler deploy`, smoke test on workers.dev, check that the new version serves 100%, automatic rollback on failure).
- `repo-settings.yml`: manual only, from `main`, owner only, in the environment `repo-admin`. Applies the rulesets and environment branch policies listed under [Repository settings](#repository-settings), with a dry run first.

## Dev Preview

The dev site is a [Worker Preview](https://developers.cloudflare.com/workers/previews/) (open beta) named `dev` of the Worker `notes`, not a second Worker. `wrangler preview --name dev` uploads the build as a new deployment of that Preview; it never changes production traffic, has no rollback and is not recorded anywhere but in Cloudflare. It is the pre-production site: what the owner looks at after a merge and before tagging a release.

- Deployed **automatically on every push to `dev`**, which only happens by merging a pull request (the `dev` ruleset requires a pull request and `CI OK`). The run summary and the `dev` environment link to https://dev.notes.szolotov.com once it is deployed (about 15 minutes, the build is cold; the newest push wins). To re-deploy the head of `dev`: Actions, **Deploy dev**, Run workflow, branch `dev`. `/version.txt` on dev shows `dev+<sha>`.
- Only `dev`: the `guard` job fails any run started from another ref ("Deploy dev runs only from dev"), and the `dev` environment allows the branch `dev` only, so a dispatch from another branch fails twice. The jobs that hold the Cloudflare token therefore run only code that went through the `dev` ruleset. Only the owner can deploy: the guard also checks the actor and the triggering actor, so a re-run by another account stops there. Forks cannot push to `dev`, their pull request runs have no secrets, and there is no `pull_request_target` or `workflow_run` anywhere.
- Feature branches are not previewed in Cloudflare; only work merged to `dev` reaches the dev site.
- Deploy dev does not wait for the CI push run on `dev`: its build job runs the type check, build, link check and artifact check itself, and the merged code already passed `CI OK` on its pull request.
- Settings: Preview settings are separate from the top level of `wrangler.jsonc` (not inherited). `previews.vars` sets `ENVIRONMENT=preview`; top-level `vars` sets `production`. The Worker only checks for `production`, so any other value is noindex.
- URL: the route `{ "pattern": "notes.szolotov.com", "custom_domain": true, "previews_enabled": true }` makes the custom domain serve production and Previews. Cloudflare manages a wildcard for `*.notes.szolotov.com`, so the Preview `dev` is served at https://dev.notes.szolotov.com ([Previews on custom domains](https://developers.cloudflare.com/workers/previews/custom-domains/)).
- `wrangler preview` does not apply routes. `previews_enabled` is applied by `wrangler deploy` (the first release) or in the dashboard (Workers & Pages, `notes`, Domains, **Production and Preview**). Until then the Deploy dev run fails with an error that points here: the Preview exists, but only on its workers.dev URL.
- Indexing: Cloudflare adds `X-Robots-Tag: noindex` only on workers.dev Preview URLs, not on custom-domain Previews. The Worker therefore sends noindex itself for everything that is not production on `notes.szolotov.com`. In the smoke test on workers.dev, the `robots.txt` check (`Disallow: /`) is what actually tests the Worker's policy.
- Cloudflare Access: this account protects Worker Previews with Cloudflare Access, so the Preview's workers.dev URL redirects to the Access login. The smoke test recognises that redirect and passes with a notice (`SMOKE_ALLOW_ACCESS` in `deploy-dev.yml`); Wrangler reporting `https://dev.notes.szolotov.com` is then the verification. Production never allows it: a redirect to Access fails the production smoke test.
- Smoke test retries: `/version.txt` is retried until it serves the expected build, then the content, header and indexing checks are retried as a set (`SMOKE_CHECK_ROUNDS`, default 6, every `SMOKE_CHECK_DELAY`, default 10 s), because a new route or custom domain can take a moment to reach every Cloudflare edge.
- Who is trusted with the token: while `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are **repository** secrets, every workflow on every branch can read them, so everyone with write access is trusted with a token that can deploy production. That is fine for a single-owner repository. Before giving anyone else write access, move them into **environment** secrets: `production` (tags `v*` and branch `main`, required reviewers) and `dev` (branch `dev`), and delete the repository secrets. A workflow on another branch then cannot reach the token.
- Remove the Preview: `npx wrangler preview delete --name dev`.

The old `stage` Preview was removed on 2026-10-15. The Repository settings workflow deletes the leftover GitHub environment `staging`.

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
| `dev`        | Deployment branches: `dev` only. No reviewers.                                                                                                                                                                      | `CLOUDFLARE_API_TOKEN` |
| `production` | Required reviewers: `greenblacked` (self-review is allowed if you are the only maintainer; otherwise enable "Prevent self-review"). Deployment branches and tags: add **tag** rule `v*` and **branch** rule `main`. | `CLOUDFLARE_API_TOKEN` |

Why `main` is in the production rules: `release.yml` calls `deploy-production.yml` as a reusable workflow, and that call runs with `github.ref = refs/heads/main`. The `v*` tag rule covers tag pushes and manual re-runs from a tag.

Trade-off of a single Worker: the Preview and production are the same Worker, so the token of the `dev` environment can also deploy production. A separate token per environment does not change that. The controls are the `dev` ruleset (pull request, `CI OK`, no bypass) and the `dev` environment being restricted to the branch `dev`: only reviewed code reaches the job that holds the token. Because the dev token can deploy production, `dev` gets the same ruleset strength as `main`.

The secret passed from `release.yml` (`secrets: CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`) is evaluated in the calling job, which has no environment. The called `deploy` job declares `environment: production`, so the production environment's secret of the same name is what the job sees. This precedence is the intended design but **unverified**: check the first release. If the deploy step reports a missing token, add the same secret at repository level as well.

**Production is tag-only, enforced in the workflow.** The `guard` job in `deploy-production.yml` runs before the environment approval and refuses everything that is not a release tag: for push and manual runs `github.ref` must be `refs/tags/vX.Y.Z`; for the call from `release.yml` the `tag` input must be `vX.Y.Z` and the tag must resolve to exactly `github.sha`. The deploy job then checks out `github.sha`. This does not depend on the `production` environment rules; those additionally allow `main` only so the call from `release.yml` can run.

**The guard only catches mistakes.** On a tag push or a manual run from a tag, GitHub runs the workflow file and the guard script from the tagged commit, so whoever can create a tag controls the code that checks it. The controls that decide who can deploy production are the tag ruleset (who may create `v*` tags) and the required reviewers of the `production` environment (with "Prevent self-review" enabled when more than one person has access), both under [Repository settings](#repository-settings). Without them the guard does not stop a malicious tag.

The guard also requires, for every path (tag push, manual run and the call from `release.yml`), a successful `ci.yml` run for the exact commit (event `push`, branch `main`) and that the commit is on `main` (`compare/main...<sha>` reports `identical` or `behind`), both in `.github/scripts/require-ci-success.sh`, which `release.yml` uses too. A tag on a commit that never passed CI on `main`, or on a branch that was never merged, is therefore not deployed even if someone manages to create it. The guard job has `contents: read` and `actions: read` only; because the call from `release.yml` caps the called job's permissions, `release.yml`'s `deploy` job grants `actions: read` as well. The script is read from the tagged commit, so this protects against mistakes (a tag on the wrong commit), not against someone who can create tags.

Rulesets, the environment branch and tag policies and the optional separate Cloudflare token are listed in [Repository settings](#repository-settings).

### 3. First deploy order

1. Actions, **Release**, Run workflow on `main`, version `0.1.0`. After the tag and release are created the production deploy waits for approval; approve it in the run. The first production deploy creates the `notes` Worker, the Custom Domain `notes.szolotov.com` and, through `previews_enabled`, the Preview wildcard.
2. The first push to `dev` runs `deploy-dev.yml`, which creates the `dev` Preview. Before the first release it fails at the "Require the custom domain Preview URL" step, because the Preview is only on workers.dev ([Dev Preview](#dev-preview)).
3. Validate production and dev (commands below). DNS and the certificate can take a few minutes; the smoke test retries for about 2.5 minutes.

## Production is tag-only

See "Production is tag-only, enforced in the workflow" above. In short: a branch run of `deploy-production.yml` cannot deploy, whatever the environment settings say. On a tag push or tag dispatch the workflow file and the guard script come from the tagged commit, so the guard only catches mistakes. The real controls for who can create a production tag are the `v*` tag ruleset and required reviewers on the `production` environment (see [Repository settings](#repository-settings)).

## Build and deploy are separate jobs

`npm run build` runs `quartz plugin restore`, which at build time clones about 40 third-party Quartz plugins (`github.com/quartz-community/*`) at the commits pinned in `quartz.lock.json`, then runs `npm install` and `npm run build` inside each. That is third-party code, and the plugins' transitive npm dependencies are not pinned by any lockfile of ours. This is a known supply-chain risk. It is mitigated by isolating secrets and by reviewing every change to `quartz.lock.json`.

- The `build` job has no environment, no secrets and `contents: read` only. It builds, checks links, checks the output with `scripts/check-artifact.mjs --public public` and uploads an artifact (`public/` only, retention 1 day). It runs with `NPM_CONFIG_IGNORE_SCRIPTS=true`, in `ci.yml` too: no install script of our dependencies or of the plugins' npm dependencies (`npm install` inside each plugin honours the variable) runs. The build does not need any: the plugins are compiled by their `npm run build`, which is run explicitly and still works.
- The `upload` and `deploy` jobs (the ones with the `dev` or `production` environment and the Cloudflare token) check out the commit fresh and install **only wrangler**, from `tools/` (`npm ci --ignore-scripts --prefix tools`; `tools/package.json` pins wrangler to the same version as the root `package.json`, with its own lockfile). They do not install the root dependencies. No root dependency is a git dependency any more, but the jobs still install only wrangler as defence in depth, because a git dependency's `prepare` script runs even with `--ignore-scripts` and a root install would run third-party code next to the token. The other scripts these jobs run (`check-artifact.mjs`, `build-csp.mjs`, `read-wrangler-output.mjs`, `smoke-test.sh`) use only Node built-ins, and the Worker imports no npm package, so wrangler bundles it from `tools/`. The jobs download the artifact, validate it with `scripts/check-artifact.mjs --root`, regenerate `worker/csp.generated.js` from the checked `public/` with `node scripts/build-csp.mjs`, and only then run wrangler (`tools/node_modules/.bin/wrangler`). The token is set on the individual wrangler steps, never job-wide. Keep `tools/` and the root wrangler version in step (Dependabot has an entry for each).
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
curl -s  https://dev.notes.szolotov.com/version.txt        # dev+<40-char commit sha>
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

Rollback applies to production only. The dev Preview is not part of rollback and has no rollback of its own: merge a fix into `dev` (it redeploys automatically), or remove it with `npx wrangler preview delete --name dev`. You can only roll back to one of the 100 most recent versions, and not if bindings changed ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). A rollback is not recorded in git: the site then serves an older build while `main` has moved on.

Roll forward or back through the pipeline: Actions, **Deploy production**, "Run workflow" with the **tag** selected as the ref (for example `v0.1.0`), approve. This rebuilds that tag and deploys it. If the deploy or smoke test fails, the workflow rolls back to the version that was live before the run and fails the job.

Automatic rollback is skipped when no previous version could be recorded (first deploy) or when a gradual deployment is active (more than one version).

## Troubleshooting

| Symptom                                                                                       | Likely cause and fix                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails: "A DNS record already exists" / custom domain conflict                          | A CNAME/A record for the hostname exists. Delete it in Cloudflare DNS, then redeploy. Custom Domains cannot be created over an existing CNAME.                                                                                                                                                                         |
| `Authentication error [code: 10000]`                                                          | Token missing a permission or scoped to the wrong account or zone. Re-check the table above, the secret in the right environment, and that the zone is in the same account.                                                                                                                                            |
| `Could not route to /accounts/...` or wrong account                                           | `CLOUDFLARE_ACCOUNT_ID` (variable or secret) missing or from another account.                                                                                                                                                                                                                                          |
| Deploy job sits at "Waiting"                                                                  | The `production` environment requires approval; approve in the run. If it is rejected immediately: the branch/tag rules of the environment do not include `main` or `v*`.                                                                                                                                              |
| Deploy dev run finishes in seconds with a notice "no longer the head"                         | Expected: a newer commit reached `dev` while the run was building; the newer run deploys it. Nothing to fix.                                                                                                                                                                                                           |
| Smoke test: `/version.txt` does not match                                                     | Edge propagation or Custom Domain still provisioning (retried for about 2.5 minutes). If it persists, check `npx wrangler deployments status`, and that the build used the right `NOTES_VERSION` and `NOTES_SHA`. Stale caches are bypassed by a random query string.                                                  |
| Smoke test: `GET /` returns 403 without `X-Robots-Tag`, while `/version.txt` passes           | A Cloudflare security feature answered instead of the Worker (the Worker sets its headers on every response, errors included). The smoke test prints `server`, `cf-ray` and `cf-mitigated` for the failing response; see [Cloudflare blocks the smoke test](#cloudflare-blocks-the-smoke-test).                        |
| Deploy dev fails: "The dev Preview is not served at https://dev.notes.szolotov.com"           | `notes.szolotov.com` is not enabled for Production and Preview yet (first release not done, or the toggle is off), or the Preview wildcard is still provisioning. Run the first release or enable it in the dashboard, then re-run the failed run (or run **Deploy dev** from `dev`). See [Dev Preview](#dev-preview). |
| Deploy dev: custom domain preview URL missing, `dev.notes` has a DNS record                   | A manual `dev.notes` DNS record shadows the Preview wildcard. Remove it.                                                                                                                                                                                                                                               |
| Deploy dev fails at "Require dev": "Deploy dev runs only from dev"                            | The run was started from another branch. Run workflow again with branch `dev` selected.                                                                                                                                                                                                                                |
| Deploy dev upload rejected: "Branch dev is not allowed to deploy to dev"                      | The environment `dev` still allows only `main`. Run **Repository settings** (dry run first).                                                                                                                                                                                                                           |
| Deploy dev guard fails: "limited to the repository owner"                                     | The run was started or re-run by an account other than the owner. Only the owner deploys.                                                                                                                                                                                                                              |
| `curl https://notes.szolotov.com` works from your machine but CI sees 403                     | Bot Fight Mode on the zone blocks GitHub-hosted runners on the custom domains. Expected: CI verifies on workers.dev and only logs a notice for the custom domain. See [below](#cloudflare-blocks-the-smoke-test).                                                                                                      |
| Dev smoke test cannot pass (dev behind Cloudflare Access)                                     | Expected when Access protects Previews: the smoke test logs a notice and passes. To skip it entirely, set the variable `DEV_SMOKE_TEST` to `false` (repository or `dev` environment); the Preview is still uploaded.                                                                                                   |
| Deploy production: guard fails with "No successful ci.yml push run found" or "is not on main" | The tagged commit has no successful CI push run on `main`, or is not reachable from `main`. Merge it through a pull request and let CI finish on `main`, then tag a commit from `main`.                                                                                                                                |
| Release: "No successful ci.yml push run found"                                                | CI on `main` for that commit has not finished or failed. Wait or fix, then re-run Release.                                                                                                                                                                                                                             |
| Release: tag step fails with a ruleset error                                                  | The tag ruleset blocks creation by the Actions app. See the tag ruleset notes above.                                                                                                                                                                                                                                   |
| Release: "must be strictly greater than the latest tag"                                       | Pick a higher X.Y.Z. A failed release after the tag step needs a new version number (tags are never reused); re-run only the deploy via Deploy production on that tag.                                                                                                                                                 |

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

## Repository settings

The pipeline assumes these settings: without them anyone with write access can bypass its checks. The **Repository settings** workflow (`repo-settings.yml`, script `.github/scripts/repo-settings.sh`) applies most of them idempotently through the GitHub API.

**How to run it.** Actions, **Repository settings**, Run workflow on `main`, first with **dry run** checked (it prints `PLAN:` lines and changes nothing), then unchecked. Re-run the dry run afterwards: it must report `0 planned change(s)`. It runs only from `main`, only for the owner (actor and triggering actor), only by manual dispatch, in the environment `repo-admin`.

What it applies:

- **Ruleset `dev`** (target branch `dev`): enforcement active, no bypass actors, pull request required (0 approvals; the owner works alone), required status check `CI OK` from the GitHub Actions app only, no force pushes, no deletion. The script owns this ruleset and brings it to exactly this state.
- **Ruleset `main`**: the same rules, with merge commits as the only merge method so that `main` stays a descendant of `dev`. It is only ever made stricter: missing rules and a missing `CI OK` check are added, existing parameters and bypass actors are never changed (a warning is printed). Classic branch protection on `main` is read and reported, never modified.
- **Environment `dev`**: custom deployment branch policy with the branch `dev` only (the policy for `dev` is added before any other policy, such as `main`, is removed). Reviewers and wait timers are kept.
- **Environment `repo-admin`**: custom deployment branch policy with the branch `main` only.
- **Environment `production`**: read only; the workflow warns when the tag policy `v*`, the branch policy `main` or the required reviewers are missing, and never writes.
- **Environment `staging`** (unused since the stage environment was removed): deleted if it exists.
- **Fork pull requests**: workflows from all external contributors need the owner's approval (CI has no secrets anyway; this only limits resource use).

What it does not apply: the tag ruleset for `v*` and the required reviewers of `production` below. Set them by hand.

**Token.** The workflow reads the environment secret `REPO_ADMIN_TOKEN` (Settings, Environments, `repo-admin`, Environment secrets). Create a fine-grained personal access token with resource owner `greenblacked`, repository access **Only select repositories: Notes**, an expiry of 7 days (issue a new one when needed) and these repository permissions:

- **Administration: Read and write** (rulesets, reading branch protection, environments and their deployment branch policies, the fork approval policy).
- **Metadata: Read** (mandatory, added automatically).
- Nothing else. Do not grant **Environments: write**: it would also let the token overwrite environment secrets such as the Cloudflare token.

Not verified: whether some environment read endpoints need more than Administration read. If the dry run reports HTTP 403 on `GET environments/...`, add **Environments: Read** (or **Actions: Read**) and nothing more.

Blast radius: Administration write on this repository can change any setting, remove rulesets, change visibility or delete the repository. It cannot push code or read secrets. Mitigations: the token is limited to this repository and expires quickly; it is held only in `repo-admin`, which the first real run restricts to `main`; the workflow runs only on `main`, only for the owner, only by manual dispatch (no push, pull request or fork trigger), and next to the token runs only first-party code (the pinned checkout and a script from `main`).

Bootstrap: the first run that reaches the `apply` job creates the environment `repo-admin` (unprotected) and fails with "Secret REPO_ADMIN_TOKEN is not set". Add the secret, then run it again; the first real apply restricts the environment to `main`.

**Ruleset for `v*` tags** (target tag, pattern `v*`)

- Restrict creations, updates and deletions. Bypass list: the repository **admin** role and the **GitHub Actions** app, which is the actor that creates the tag in `release.yml` (`GITHUB_TOKEN`).
- Not verified: whether the GitHub Actions app can be added to a ruleset's bypass list. If it is not offered, a creation restriction makes `release.yml` fail at "Create annotated tag" (403 or ruleset error; nothing is deployed). Then restrict only updates and deletions, so a published tag can never be moved or removed, and accept that creations are limited only by the required reviewers on the `production` environment: the `guard` job is not a control for creations, because a tag push runs the workflow and guard script of the tagged commit ([Production is tag-only](#production-is-tag-only)). Use "Prevent self-review" on that environment when more than one person has access.
- With the ruleset in place, the real controls for production are this ruleset (who can create `v*` tags) **and** required reviewers on the `production` environment (with "Prevent self-review" when more than one person has access). The guard only catches mistakes.

**Environments** (Settings, Environments; details in the [table above](#2-github-repository-settings))

- `dev`: deployment branches limited to `dev` (a deployment branch policy, "Selected branches and tags", rule `dev`; applied by the workflow). Only code that went through the `dev` ruleset can reach the job that holds the Cloudflare token.
- `production`: deployment branches and tags limited to the tag rule `v*` and the branch rule `main` (`main` for the call from `release.yml`), plus required reviewers.

**Optional: a separate Cloudflare account or token for dev.** The dev Preview is a Preview of the same Worker, so the dev token can also deploy production. If that matters, deploy dev from a separate Cloudflare account (its own `CLOUDFLARE_ACCOUNT_ID` and token in the `dev` environment, and a Worker named `notes` there) so a compromised dev job cannot touch production. Until then the `dev` ruleset is a production-relevant control. This costs a second zone or hostname for the dev URL; the single-Worker setup in this guide does not do it.

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

Dependabot (`.github/dependabot.yml`) updates npm (the root and `tools/`), GitHub Actions and the pinned zizmor requirement weekly with a cooldown. Version updates target `dev`; GitHub security updates always target `main`. The vendored Quartz engine is not updated by Dependabot; use `scripts/update-quartz.sh <tag>` (see the README).
