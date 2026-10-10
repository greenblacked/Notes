# Deployment

The site is a static Quartz build served by one Cloudflare Worker, `notes` (`worker/`), with static assets. Production and staging are two views of that Worker:

| Environment | What                                    | URL                              | Updated by                                             |
| ----------- | --------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| production  | The deployed Worker (`wrangler deploy`) | https://notes.szolotov.com       | `release.yml` / `deploy-production.yml` on tags        |
| staging     | Worker Preview named `stage`            | https://stage.notes.szolotov.com | `deploy-stage.yml` (`wrangler preview`) on every merge |

Both are also reachable on the Worker's workers.dev URLs, which CI uses for verification (see [Bot Fight Mode](#cloudflare-blocks-the-smoke-test)). Indexing is decided per request in `worker/indexing.js`: only the production build on the host `notes.szolotov.com` is indexable; the stage Preview, every workers.dev host and localhost send `X-Robots-Tag: noindex, nofollow` and a disallow-all `robots.txt`.

Workflows (all in `.github/workflows/`):

- `ci.yml`: build, type check, link check, script and Worker-policy tests (`npm run test:scripts`), format check, `wrangler deploy --dry-run`, actionlint and zizmor. The aggregate job `CI OK` is the required status check.
- `deploy-stage.yml`: a `build` job builds the exact commit, then an `upload` job (environment `staging`) runs `wrangler preview --name stage` and smoke-tests the Preview's workers.dev URL. If the commit is no longer the head of `main` (a newer push landed), checked at the start of `build` and again right before the upload, the run skips with a notice and succeeds.
- `release.yml`: manual. Validates the version, requires a successful CI run for the commit, creates an annotated tag and a GitHub Release, then calls `deploy-production.yml`.
- `deploy-production.yml`: `guard` (tag check), `build`, then `deploy` (environment approval, record the live version, `wrangler deploy`, smoke test on workers.dev, check that the new version serves 100%, automatic rollback on failure).

## Stage Preview

Stage is a [Worker Preview](https://developers.cloudflare.com/workers/previews/) (open beta) named `stage` of the Worker `notes`, not a second Worker. `wrangler preview --name stage` uploads the build as a new deployment of that Preview; it never changes production traffic, has no rollback and is not recorded anywhere but in Cloudflare.

- Settings: Preview settings are separate from the top level of `wrangler.jsonc` (not inherited). `previews.vars` sets `ENVIRONMENT=stage`; top-level `vars` sets `production`.
- URL: the route `{ "pattern": "notes.szolotov.com", "custom_domain": true, "previews_enabled": true }` makes the custom domain serve production and Previews. Cloudflare manages a wildcard for `*.notes.szolotov.com`, so the Preview `stage` is served at https://stage.notes.szolotov.com ([Previews on custom domains](https://developers.cloudflare.com/workers/previews/custom-domains/)).
- `wrangler preview` does not apply routes. `previews_enabled` is applied by `wrangler deploy` (the first release) or in the dashboard (Workers & Pages, `notes`, Domains, **Production and Preview**). Until then the deploy-stage run fails with an error that points here: the Preview exists, but only on its workers.dev URL.
- Indexing: Cloudflare adds `X-Robots-Tag: noindex` only on workers.dev Preview URLs, not on custom-domain Previews. The Worker therefore sends noindex itself for everything that is not production on `notes.szolotov.com`.
- Cloudflare adds `X-Robots-Tag: noindex` itself on workers.dev Preview URLs, so in the stage smoke test the `robots.txt` check (`Disallow: /`) is what actually tests the Worker's policy.
- Remove the Preview: `npx wrangler preview delete --name stage`.
- Smoke test switch: set the repository or `staging` environment variable `STAGE_SMOKE_TEST` to `false` to skip the smoke test in `deploy-stage.yml`, for example when stage is later put behind Cloudflare Access (the runner could not pass it). The default is to run it.

### Migration from the separate `notes-stage` Worker (one time)

Stage used to be its own Worker, `notes-stage`, with a Custom Domain `stage.notes.szolotov.com`. That domain must be gone before the first Preview, and between step 1 and step 3 stage is down. Production is not affected.

1. **Delete the old Worker** (already done by the owner; keep for anyone who still has it):

   ```sh
   npx wrangler delete notes-stage
   ```

   Then check that nothing is left:
   - Dashboard, Workers & Pages: no `notes-stage` Worker.
   - `npx wrangler deployments list --name notes-stage` fails with a "not found" error.
   - The Custom Domain `stage.notes.szolotov.com` is gone (Worker `notes-stage` Domains, or Workers & Pages overview).
   - DNS, `szolotov.com`: delete any manual `stage.notes` record. It would shadow the Preview wildcard.

2. **First release** (Actions, **Release**) runs `wrangler deploy`, which applies the routes including `previews_enabled`. Alternatively enable **Production and Preview** for `notes.szolotov.com` in the dashboard (Workers & Pages, `notes`, Domains).
3. **Next merge to `main`**, or a re-run of **Deploy stage**, creates the `stage` Preview. Validate it with the commands below.

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

Sources: [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/) and [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token). Validate the grants with a real deploy (the first release); tighten or add permissions from the error it reports.

Scope account resources to the one account and the zone resource to `szolotov.com` only.

What is **not verified** (confirm with the first release):

- Which of the Account Settings, Workers Tail and Memberships read permissions are needed when `CLOUDFLARE_ACCOUNT_ID` is set. They come from Cloudflare's own Workers Builds token.
- Whether `wrangler preview` needs anything beyond Workers Scripts: Edit. Worker Previews are in open beta.

### 2. GitHub repository settings

**Actions, General**

- Workflow permissions: **Read repository contents and packages permissions** (default read-only). Every workflow declares its own permissions; `release.yml` requests `contents: write` and `actions: read` on its job only. "Allow GitHub Actions to create and approve pull requests" is not needed.
- Allowed actions: optionally restrict to actions from this repository plus `actions/checkout` and `actions/setup-node`, and enable "Require actions to be pinned to a full-length commit SHA".

**Variables and secrets**

- Variable (Settings, Secrets and variables, Actions, Variables): `CLOUDFLARE_ACCOUNT_ID` at repository level.
- Secret `CLOUDFLARE_API_TOKEN` in **each environment** (below), not at repository level.

**Environments** (Settings, Environments)

| Environment  | Protection                                                                                                                                                                                                          | Secret                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `staging`    | Deployment branches: `main` only. No reviewers.                                                                                                                                                                     | `CLOUDFLARE_API_TOKEN` |
| `production` | Required reviewers: `greenblacked` (self-review is allowed if you are the only maintainer; otherwise enable "Prevent self-review"). Deployment branches and tags: add **tag** rule `v*` and **branch** rule `main`. | `CLOUDFLARE_API_TOKEN` |

Why `main` is in the production rules: `release.yml` calls `deploy-production.yml` as a reusable workflow, and that call runs with `github.ref = refs/heads/main`. The `v*` tag rule covers tag pushes and manual re-runs from a tag.

Trade-off of a single Worker: the Preview and production are the same Worker, so the token of the `staging` environment can also deploy production. A separate token per environment does not change that. The controls are the `main` branch ruleset (pull request and `CI OK` required) and the `staging` environment being restricted to `main`: only reviewed code reaches the job that holds the token.

The secret passed from `release.yml` (`secrets: CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`) is evaluated in the calling job, which has no environment. The called `deploy` job declares `environment: production`, so the production environment's secret of the same name is what the job sees. This precedence is the intended design but **unverified**: check the first release. If the deploy step reports a missing token, add the same secret at repository level as well.

**Production is tag-only, enforced in the workflow.** The `guard` job in `deploy-production.yml` runs before the environment approval and refuses everything that is not a release tag: for push and manual runs `github.ref` must be `refs/tags/vX.Y.Z`; for the call from `release.yml` the `tag` input must be `vX.Y.Z` and the tag must resolve to exactly `github.sha`. The deploy job then checks out `github.sha`. This does not depend on the `production` environment rules; those additionally allow `main` only so the call from `release.yml` can run.

**Branch ruleset for `main`** (Settings, Rules, Rulesets)

- Require a pull request before merging.
- Require status checks to pass: `CI OK` (the aggregate job name), branch up to date optional.
- Block force pushes. Restrict deletions.
- Require linear history (optional; works with squash or rebase merges).

**Tag ruleset for `v*`**

- Restrict updates and deletions of `v*` tags (tags are immutable releases).
- Restricting **creation** is the part to be careful with: `release.yml` creates the tag with `GITHUB_TOKEN` (the GitHub Actions app). I could not verify whether the GitHub Actions app can be added as a bypass actor in a ruleset. If it cannot, a creation restriction would make every release fail. Safe options: do not restrict creation, or restrict it with the repository admin role as a bypass actor and test one release (a failure is clear: the `Create annotated tag` step fails with a 403 or ruleset error, nothing is deployed).

### 3. First deploy order

1. Actions, **Release**, Run workflow on `main`, version `0.1.0`. After the tag and release are created the production deploy waits for approval; approve it in the run. The first production deploy creates the `notes` Worker, the Custom Domain `notes.szolotov.com` and, through `previews_enabled`, the Preview wildcard.
2. Merge to `main` (or re-run **Deploy stage**). `deploy-stage.yml` creates the `stage` Preview. Before the first release it fails at the "Require the custom domain Preview URL" step, because the Preview is only on workers.dev ([Stage Preview](#stage-preview)).
3. Validate production and stage (commands below). DNS and the certificate can take a few minutes; the smoke test retries for about 2.5 minutes.

Existing setups: follow the [migration](#migration-from-the-separate-notes-stage-worker-one-time) instead.

## Production is tag-only

See "Production is tag-only, enforced in the workflow" above. In short: a branch run of `deploy-production.yml` cannot deploy, whatever the environment settings say.

## Build and deploy are separate jobs

`npm run build` runs `quartz plugin restore`, which at build time clones about 40 third-party Quartz plugins (`github.com/quartz-community/*`) at the commits pinned in `quartz.lock.json`, then runs `npm install` and `npm run build` inside each. That is third-party code, and the plugins' transitive npm dependencies are not pinned by any lockfile of ours. This is a known supply-chain risk. It is mitigated by isolating secrets and by reviewing every change to `quartz.lock.json`.

- The `build` job has no environment, no secrets and `contents: read` only. It builds, checks links and uploads an artifact (`public/` and the generated `worker/csp.generated.js`, retention 1 day).
- The `upload` and `deploy` jobs (the ones with the `staging` or `production` environment and the Cloudflare token) checks out the commit fresh, runs `npm ci --ignore-scripts` (tested: wrangler dry-runs work without lifecycle scripts), downloads the artifact, and only then runs wrangler. The token is set on the individual wrangler steps, never job-wide, so no plugin code ever runs next to it.
- Build jobs need network access to github.com and the npm registry.
- No dependency cache is used in the deploy and release workflows (cache-poisoning risk), so every deploy build restores plugins cold: expect about 15 minutes (the build job timeout is 45 minutes). CI caches `.quartz/plugins` keyed on `quartz.lock.json`, so a warm CI build takes seconds.
- Production approval happens at the `deploy` job, after the build has finished.

## Validation commands

```sh
curl -sI https://notes.szolotov.com
curl -s  https://notes.szolotov.com/version.txt        # <X.Y.Z>+<40-char commit sha>
curl -s  https://notes.szolotov.com/robots.txt         # allows crawling, lists the sitemap
curl -sI https://notes.szolotov.com | grep -i x-robots-tag   # no output expected

curl -sI https://stage.notes.szolotov.com | grep -i x-robots-tag   # noindex, nofollow
curl -s  https://stage.notes.szolotov.com/version.txt        # main+<40-char commit sha>
curl -s  https://stage.notes.szolotov.com/robots.txt         # Disallow: /
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

Rollback applies to production only. Stage is a Preview and has no rollback: merge a fix or re-run **Deploy stage**, or remove it with `npx wrangler preview delete --name stage`. You can only roll back to one of the 100 most recent versions, and not if bindings changed ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). A rollback is not recorded in git: the site then serves an older build while `main` has moved on.

Roll forward or back through the pipeline: Actions, **Deploy production**, "Run workflow" with the **tag** selected as the ref (for example `v0.1.0`), approve. This rebuilds that tag and deploys it. If the deploy or smoke test fails, the workflow rolls back to the version that was live before the run and fails the job.

Automatic rollback is skipped when no previous version could be recorded (first deploy) or when a gradual deployment is active (more than one version).

## Troubleshooting

| Symptom                                                                                   | Likely cause and fix                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails: "A DNS record already exists" / custom domain conflict                      | A CNAME/A record for the hostname exists. Delete it in Cloudflare DNS, then redeploy. Custom Domains cannot be created over an existing CNAME.                                                                                                                                                  |
| `Authentication error [code: 10000]`                                                      | Token missing a permission or scoped to the wrong account or zone. Re-check the table above, the secret in the right environment, and that the zone is in the same account.                                                                                                                     |
| `Could not route to /accounts/...` or wrong account                                       | `CLOUDFLARE_ACCOUNT_ID` variable missing or from another account.                                                                                                                                                                                                                               |
| Deploy job sits at "Waiting"                                                              | The `production` environment requires approval; approve in the run. If it is rejected immediately: the branch/tag rules of the environment do not include `main` or `v*`.                                                                                                                       |
| Stage run finishes in seconds with a notice "no longer the head"                          | Expected: a newer commit reached `main`; its own run deploys. Nothing to fix.                                                                                                                                                                                                                   |
| Smoke test: `/version.txt` does not match                                                 | Edge propagation or Custom Domain still provisioning (retried for about 2.5 minutes). If it persists, check `npx wrangler deployments status`, and that the build used the right `NOTES_VERSION` and `NOTES_SHA`. Stale caches are bypassed by a random query string.                           |
| Smoke test: `GET /` returns 403 without `X-Robots-Tag`, while `/version.txt` passes       | A Cloudflare security feature answered instead of the Worker (the Worker sets its headers on every response, errors included). The smoke test prints `server`, `cf-ray` and `cf-mitigated` for the failing response; see [Cloudflare blocks the smoke test](#cloudflare-blocks-the-smoke-test). |
| Deploy stage fails: "The stage Preview is not served at https://stage.notes.szolotov.com" | `notes.szolotov.com` is not enabled for Production and Preview yet (first release not done, or the toggle is off), or the Preview wildcard is still provisioning. Run the first release or enable it in the dashboard, then re-run **Deploy stage**. See [Stage Preview](#stage-preview).       |
| Deploy stage: custom domain preview URL missing, `stage.notes` has a DNS record           | A manual `stage.notes` DNS record or the old `notes-stage` Custom Domain shadows the Preview wildcard. Remove it ([migration](#migration-from-the-separate-notes-stage-worker-one-time)).                                                                                                       |
| `curl https://notes.szolotov.com` works from your machine but CI sees 403                 | Bot Fight Mode on the zone blocks GitHub-hosted runners on the custom domains. Expected: CI verifies on workers.dev and only logs a notice for the custom domain. See [below](#cloudflare-blocks-the-smoke-test).                                                                               |
| Stage smoke test cannot pass (stage behind Cloudflare Access)                             | Set the variable `STAGE_SMOKE_TEST` to `false` (repository or `staging` environment) to skip the smoke test; the Preview is still uploaded.                                                                                                                                                     |
| Release: "No successful ci.yml push run found"                                            | CI on `main` for that commit has not finished or failed. Wait or fix, then re-run Release.                                                                                                                                                                                                      |
| Release: tag step fails with a ruleset error                                              | The tag ruleset blocks creation by the Actions app. See the tag ruleset notes above.                                                                                                                                                                                                            |
| Release: "must be strictly greater than the latest tag"                                   | Pick a higher X.Y.Z. A failed release after the tag step needs a new version number (tags are never reused); re-run only the deploy via Deploy production on that tag.                                                                                                                          |

### Cloudflare blocks the smoke test

Bot Fight Mode on the `szolotov.com` zone answers GitHub-hosted runners with HTTP 403 (`cf-mitigated`) on the custom-domain hosts (observed on https://stage.notes.szolotov.com). That is why the Worker keeps `workers_dev` and `preview_urls` enabled and the deploy workflows smoke-test the workers.dev URLs and check `wrangler deployments status`, and fetch the custom domains once only to log a notice. The rest of this section is for when you want the custom domains checked too (zone WAF rules do not apply to workers.dev).

Symptom: `/version.txt` and `/robots.txt` pass, but `GET /` (HTML) fails with 403 and no `X-Robots-Tag`. The Worker adds its headers to every response, errors included, so the 403 was produced in front of it. GitHub-hosted runners come from cloud provider IP ranges, which Cloudflare's bot protections may challenge while ordinary visitors get through. The smoke test reports it as `blocked by Cloudflare (cf-mitigated: <value>)` and prints the `cf-ray` value.

1. **Find what acted.** In the Cloudflare dashboard open **Security, Events**, filter on the hostname, and look up the Ray ID from the smoke-test log. The event names the product (Bot Fight Mode, Super Bot Fight Mode, a managed rule, Security Level).
2. **Bot Fight Mode (Free plan):** to my knowledge it cannot be bypassed with a WAF custom rule (Skip action) or any other exception; the only control is turning it off for the whole zone (**Security, Bots**). Confirm this against the current [Bot Fight Mode documentation](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/) before deciding; I could not re-check it from the build environment. CI is unaffected by it: the deploy workflows verify on the workers.dev URLs, so only CI's fetches of the custom domains are blocked (logged as notices).
3. **Super Bot Fight Mode or other WAF features (Pro and above):** add a WAF custom rule with the action **Skip** for the products that fired (see [Skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)), matching both hostnames and a shared secret header rather than the User-Agent, which anyone can spoof:

   ```text
   (http.host in {"notes.szolotov.com" "stage.notes.szolotov.com"}
    and any(http.request.headers["x-notes-smoke-test"][*] eq "<value of SMOKE_TEST_TOKEN>"))
   ```

   Then add the same random value as the GitHub secret `SMOKE_TEST_TOKEN` (repository level, or in both `staging` and `production`), for example from `openssl rand -hex 32`. The deploy workflows pass it to `scripts/smoke-test.sh`, which sends it as the `X-Notes-Smoke-Test` request header; without the secret the header is not sent. Rotate it by updating the rule and the secret together.

The smoke test also sends the User-Agent `notes-smoke-test/1 (+https://github.com/greenblacked/Notes)` (override with `SMOKE_USER_AGENT`), which makes its requests easy to find in Security Events.

## Dependency updates

Dependabot (`.github/dependabot.yml`) updates npm, GitHub Actions and the pinned zizmor requirement weekly with a cooldown. The vendored Quartz engine is not updated by Dependabot; use `scripts/update-quartz.sh <tag>` (see the README).
