---
title: "Delivery 03: Environments, releases, approvals and rollbacks"
description: Keep dev, stage and production apart, release with annotated SemVer tags, require approvals, and practise a rollback that redeploys the previous artifact.
type: guide
tags:
  - learning
  - ci-cd
  - gitlab-ci
  - jenkins
  - reliability
created: 2026-10-17
modified: 2026-10-17
verified: 2026-10-17
draft: false
---

> [!info] Level: middle | Time: about 5 h | You need: [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02: Your first pipeline in GitLab CI and Jenkins]] and [[learn/git-merge-rebase-and-undo|Git 02: Merge, rebase, conflicts and undoing mistakes]] | Lab: Option A, the Ubuntu LTS VM (or the container from Option B) from [[learn/lab-setup|Start 01: Set up your lab]], plus the `ci-lab` GitLab.com project from the last lesson

A pipeline that builds and tests is half a delivery process. The other half answers four questions: where does this version go, who may send it there, how do we name what we shipped, and how do we undo it when it is wrong. Teams that cannot answer these calmly are the ones who deploy on Friday afternoon and spend the weekend in a call.

This lesson is about those four answers. You will keep environments apart, release with tags that mean something, require a second person before production, and write and time a rollback.

> [!note] What was run
> The Git exercises (3, 4, 5 and 6) and the rollback exercise (8) were run on Ubuntu with Git 2.43.0 and GNU bash on 2026-10-17, in throwaway directories with a local bare repository as the remote. Commit IDs, dates and paths in the sample output are illustrative: yours will differ. The GitLab and Jenkins parts (exercises 1 and 2) were **not** run for this page and follow the official documentation. Anything marked "not verified" needs checking against the current documentation, and the licence tier of a feature in particular.

## What you will learn

- Why development, stage and production are kept apart in configuration, credentials and access, and what each is for.
- How GitLab environments, manual jobs, protected environments and approvals work, and the Jenkins `input` step and promotion jobs.
- How to build once and promote the same artifact (the same image digest) through the environments.
- How to tag releases with annotated Git tags and SemVer, why a tag never moves, and how tag-triggered pipelines work.
- How to write release notes, cut a hotfix from a tag, and roll back by redeploying the previous artifact.
- How to separate who can deploy from who can change code.

## Why environments are kept apart

An **environment** is a place where a version of your software runs for a purpose, with its own configuration, data, credentials and access. Most teams use at least three:

| Environment  | Purpose                                                       | Data                    | Who can deploy                     |
| ------------ | ------------------------------------------------------------- | ----------------------- | ---------------------------------- |
| `dev`        | Try changes quickly; allowed to break                         | Fake or small test data | Developers, automatically from CI  |
| `stage`      | A close copy of production, used to prove a release candidate | Anonymised or synthetic | CI, often on every merge to `main` |
| `production` | Real users                                                    | Real data               | A small group, after an approval   |

The point of the separation is containment. Each environment has its **own** database, its own secrets and its own cloud project or cluster, so a mistake or a leak in `dev` cannot touch production data. The same code runs in all three. Only the **configuration** differs, and configuration comes from outside the artifact (environment variables, a values file, a secret store), never from rebuilding.

Two ideas keep this honest:

- **Stage must look like production** in the ways that matter (same image, same deployment tool, same major versions of dependencies). A stage that is very different proves nothing.
- **Credentials are per environment.** One credential that works everywhere turns every low-risk environment into a way into production ([[patterns/external-secrets-with-secret-manager]]).

## Build once, promote the same artifact

The most important rule of delivery: **build the artifact once, and promote that same artifact.** If the pipeline rebuilds for production, what runs there is a new build of the same source, which may pull a newer dependency or a different base image. You tested one thing and shipped another.

For a container image, "the same artifact" means the same **digest**. A tag such as `1.4.0` is a movable label. A digest, written `@sha256:<64 hex characters>`, identifies the exact content. Deploy by digest, or at least make sure the tag you deploy is immutable.

```text
europe-docker.pkg.dev/PROJECT_ID/REPOSITORY/app@sha256:DIGEST
```

`PROJECT_ID`, `REPOSITORY` and `DIGEST` are placeholders: use your Artifact Registry path and the digest your build printed. The production pattern, with one repository per stage and promotion by retagging or copying, is in [[patterns/artifact-promotion-artifactory]]. Image signing makes this stronger ([[patterns/image-signing-and-admission-verification]]).

## Environments in GitLab

In `.gitlab-ci.yml` a job that deploys declares an `environment`. GitLab then records each deployment (which commit, which job, who, when) and shows the history under **Operate > Environments** (older versions: **Deployments > Environments**; the menu moves, so search for "Environments").

```yaml title=".gitlab-ci.yml"
stages:
  - build
  - deploy-stage
  - deploy-prod

workflow:
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

build:
  stage: build
  image: docker:27
  services:
    - docker:27-dind
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - echo "Build and push the image tagged with $CI_COMMIT_SHA, record its digest"

deploy-stage:
  stage: deploy-stage
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
  environment:
    name: stage
    url: https://stage.example.com
  script:
    - ./scripts/deploy.sh stage "$CI_COMMIT_SHA"
    - ./scripts/smoke.sh https://stage.example.com

deploy-prod:
  stage: deploy-prod
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
      when: manual
  environment:
    name: production
    url: https://www.example.com
  script:
    - ./scripts/promote.sh "$CI_COMMIT_SHA" "$CI_COMMIT_TAG"
    - ./scripts/deploy.sh production "$CI_COMMIT_TAG"
    - ./scripts/smoke.sh https://www.example.com
```

Read it carefully, because it encodes the whole idea:

- The **image is built once**, on the default branch, and tagged with the commit hash. The tag pipeline does **not** rebuild: it runs `promote.sh`, which gives the existing image a release tag (`v1.4.0`) and deploys it. The release tag points at the same bytes that were tested on stage.
- `deploy-stage` is `when: manual`: it appears as a play button. A person decides when stage gets a version. Many teams make this automatic; manual is shown to teach the mechanism.
- `deploy-prod` exists **only in tag pipelines** (`$CI_COMMIT_TAG` matches a SemVer pattern). Production can only be reached from a tag, and a tag is a deliberate act.
- The `environment` block makes the deployments appear under Environments, with a link to the URL.
- `image: docker:27` and `docker:27-dind` are examples. Change them to versions you have checked, and do not use Docker-in-Docker with privileged runners you do not control; see [[patterns/gitlab-runners-on-gke]] for the safer options.

A manual job leaves the pipeline in a `blocked` or `manual` state until someone starts it. Whether a pending manual job blocks the pipeline from being marked as passed depends on `allow_failure` (a manual job in `rules` defaults differently from a manual job set by `when: manual` at job level). Read your version's documentation, and set `allow_failure: false` explicitly when you want the pipeline to wait.

The retag inside `promote.sh` can be a registry command. In Artifact Registry, for example, `gcloud artifacts docker tags add` adds a tag to an existing image version.

> [!warning] Check before relying on this
> The `gcloud artifacts docker tags add` command and its arguments were not verified for your `gcloud` version. Run `gcloud artifacts docker tags add --help`. Also check your registry's tag immutability setting, so a release tag cannot be overwritten later.

### Protected environments and approvals

Two GitLab features turn "a button anyone could press" into a control:

- **Protected environments** limit who may deploy to an environment. You choose the roles, users or groups that are allowed to run jobs that target `production`. A developer with permission to push code can still be unable to deploy.
- **Deployment approvals** require one or more approvers to approve a deployment before the job can run. The person who triggered the deployment should not be the one who approves it.

Also **protect the tags** (`v*`) so only maintainers can create release tags, otherwise anyone who can push a tag can start a production pipeline.

> [!warning] Check before relying on this
> Protected environments and deployment approvals are tier-dependent in GitLab: some options exist only in paid tiers, and the settings, menus and wording change between versions. Check the current "Protected environments" and "Deployment approvals" pages and your own plan before you design around them. If your tier lacks approvals, a manual job plus a protected environment plus a merge request review of the tag commit is the usual fallback; it is weaker, because it has no separate approver at the moment of deployment.

## The same ideas in Jenkins

Jenkins has no built-in "environment" object, so you build the pattern from a few pieces.

- **Manual approval** with the `input` step. It pauses the build and waits for a person. `submitter` restricts who may answer, by user or group name.

  ```groovy title="Jenkinsfile (fragment)"
  stage('Approve production') {
      steps {
          input message: 'Deploy this version to production?',
                ok: 'Deploy',
                submitter: 'release-managers'      // Change: a Jenkins group or user allowed to approve.
      }
  }
  stage('Deploy production') {
      steps {
          sh './scripts/deploy.sh production "${VERSION}"'
      }
  }
  ```

  Do not run `input` while holding an agent: put it in a stage with `agent none`, so the build does not occupy an executor while it waits for a person.

- **Promotion jobs.** A separate job, `deploy-production`, takes the version as a parameter and **pulls the same artifact** from the repository. It does not build. Access to run this job is restricted with Jenkins roles.
- **Credentials per environment** in the credential store, scoped to folders so the production credential is visible only to the production job.

> [!warning] Check before relying on this
> `input` with `submitter`, folder-scoped credentials and role-based access need the right plugins and configuration in your Jenkins. Check the Pipeline Steps reference and your authorisation setup.

## Tags, releases and SemVer

A **Git tag** is a name for one commit. Tags come in two kinds:

- A **lightweight tag** is only a name pointing at a commit.
- An **annotated tag** is a full Git object with a tagger, a date and a message. Use annotated tags for releases: `git tag -a v1.4.0 -m "Release 1.4.0"`. They can be signed, they show who tagged what, and `git describe` uses them by default.

### Semantic Versioning

SemVer 2.0.0 gives version numbers a meaning. A version is `MAJOR.MINOR.PATCH`:

| Increase | When                                                    | Example change                     |
| -------- | ------------------------------------------------------- | ---------------------------------- |
| PATCH    | You made backward-compatible bug fixes                  | Fix a crash on empty input         |
| MINOR    | You added functionality in a backward-compatible way    | Add a new optional API field       |
| MAJOR    | You made an incompatible change to the public interface | Remove a field, rename an endpoint |

When you increase MAJOR, reset MINOR and PATCH to zero; when you increase MINOR, reset PATCH. A **pre-release** version has a hyphen and identifiers (`1.5.0-rc.1`) and sorts before `1.5.0`. **Build metadata** after a plus sign (`1.5.0+build.7`) is ignored when comparing versions. Versions `0.y.z` are for initial development, where anything may change.

SemVer is only as good as your definition of "public interface". For a service, that is its API, its events and its configuration. Write it down. Automation that derives the version from commit messages is covered in [[patterns/release-versioning-and-changelog-automation]].

### A tag never moves

Once `v1.4.0` is published, it must always mean the same commit. People, caches, scanners and deploy tools have all recorded it. If you move it, the tag now means something different from what was tested, and nobody can tell which one is running. If you find a mistake after tagging, fix it in a **new** version (`v1.4.1`). Git helps you here: by default, a push will not overwrite an existing remote tag (exercise 6).

### Tag-triggered pipelines

In GitLab, a tag push starts a pipeline with `CI_COMMIT_TAG` set (and `CI_COMMIT_BRANCH` unset). You select it with a rule, as in the example above:

```yaml
rules:
  - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
```

The same idea on GitHub Actions is `on: push: tags: ['v*']`; the concept is identical. In Jenkins, a multibranch job can discover tags if you enable that behaviour, and `when { tag 'v*' }` selects them.

### Release notes and the changelog

Release notes answer "what changed for me?". Start from Git:

```bash
git log --oneline v0.1.0..v0.2.0
```

`A..B` means "commits reachable from B but not from A", that is, what is new in the release. If your team writes commit subjects in a consistent style (`feat:`, `fix:`), you can group them. The [Keep a Changelog](https://keepachangelog.com/) format keeps a `CHANGELOG.md` for humans with the sections `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`, newest release first, each with a date. A changelog is written for the user of the software, not a dump of the Git log.

### Hotfix from a tag

Production runs `v1.4.0` and has a serious bug. `main` already holds work for `1.5.0` that is not ready. Branch from the **tag**, fix, tag the fix, and bring the fix back:

```bash
git switch -c hotfix/1.4.1 v1.4.0     # start from exactly what runs in production
# ... fix, commit ...
git tag -a v1.4.1 -m "Release 1.4.1"
git push origin hotfix/1.4.1 v1.4.1   # the tag starts the release pipeline
git switch main
git cherry-pick hotfix/1.4.1          # carry the fix into main, so it is not lost
```

Exercise 5 does this with output.

## Rollback

A **rollback** returns the running system to a previous known-good version. The key rule: **roll back by redeploying the previous artifact, never by rebuilding old code.** A rebuild is a new build; it may pull newer dependencies or fail in a pipeline that has since changed. The previous artifact is already built, already tested and already proven in production. Keep the last few versions available (artifact retention matters here: [[standards/artifact-retention-policy]]).

Two actions get confused:

| Action                  | What it does                                                   | When to use it                                                              |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Deployment rollback** | Runs the previous version again. Code history is unchanged.    | Now, to stop the damage. Takes minutes.                                     |
| **`git revert`**        | Adds a new commit that undoes a change. History moves forward. | Afterwards, so `main` stops containing the bad change. Goes through review. |

Do the rollback first, then the revert. A rollback is not available when the bad release changed data in a way the old version cannot read (a schema migration). Plan for that with backward-compatible migrations ([[patterns/postgres-expand-contract-migrations]]).

Smoke tests close the loop. A **smoke test** is a very short check after a deploy that the basics work: the version endpoint reports the expected version, the health endpoint returns 200, one critical request succeeds. Run it after every deploy, and after every rollback.

For Kubernetes, the rollback command is `kubectl rollout undo` for a plain Deployment, or `helm rollback` for a Helm release. Do not improvise; follow [[runbooks/helm-release-rollback]]. With GitOps, the rollback is a commit that reverts the desired state ([[runbooks/argocd-sync-failure-and-drift]]).

## Separating deploy rights from code rights

The person who writes a change should not be the only person who can put it in production. Separate three powers:

- **Who can change code.** Everyone on the team, through reviewed merge requests ([[standards/code-review]]).
- **Who can create a release tag.** Maintainers (protected tags).
- **Who can approve and run the production deployment.** A named group, never the author of the change being deployed.

This is not distrust. It is how you limit the damage of a mistake, a stolen account or a rushed night, and it is a common audit expectation. Auditors and counsel decide what your obligations are; this lesson only describes a sensible default.

The standing checklist before touching production is [[standards/production-change-checklist]].

## Hands-on exercises

For exercises 3 to 6 and 8 you only need the Ubuntu lab and Git. Exercises 1 and 2 need GitLab.com.

### Exercise 1: A manual stage deployment with an Environments row

1. In `ci-lab`, replace `.gitlab-ci.yml` with a small version of the example above. Keep `deploy-stage` and put `echo` commands in the scripts, so nothing real is deployed:

   ```yaml
   stages: [deploy-stage]

   deploy-stage:
     stage: deploy-stage
     rules:
       - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
         when: manual
         allow_failure: false
     environment:
       name: stage
       url: https://stage.example.com
     script:
       - echo "Deploying $CI_COMMIT_SHORT_SHA to stage"
   ```

2. Push to `main`. Open the pipeline and press the play button on `deploy-stage`.
3. Open the Environments page.

Expected (illustrative): before you press play, the pipeline shows a `manual` job. After it runs, the log shows `Deploying 1a2b3c4d to stage`, and the Environments page has a row named `stage` with the latest deployment and a link to `https://stage.example.com`.

If you see something else: no play button usually means the rule did not match (are you on the default branch?). No Environments row means the job has no `environment:` block or the job did not run.

### Exercise 2: Production waits for approval

1. In **Settings > CI/CD > Protected environments** (name varies by version), protect `production` and allow only a group or role that does **not** include your test author account, if your tier allows.
2. Add a `deploy-prod` job as in the example, triggered by a tag, and push a tag `v0.1.0`.
3. As the author, try to run it.

Expected (not run, tier dependent): the job waits, and you cannot run it as the author until an approver approves. If your tier does not support approvals, the job is blocked for users outside the allowed list.

If you see something else: if you can run it as the author, the environment is not protected or you are in the allowed list. Fix the list, and write down which of the controls your tier lacks. For Jenkins, use the `input` step with `submitter` as the equivalent.

### Exercise 3: An annotated tag

1. Create a repository with a first commit:

   ```bash
   mkdir -p ~/release-lab && cd ~/release-lab
   git init -b main app && cd app
   git config user.name "Lab User" && git config user.email lab@example.com
   echo "print('v1')" > app.py && git add app.py && git commit -m "feat: first release"
   git tag -a v0.1.0 -m "Release 0.1.0"
   git show v0.1.0 | head -12
   ```

Expected (illustrative):

```text
tag v0.1.0
Tagger: Lab User <lab@example.com>
Date:   Sat Oct 17 17:23:02 2026 +0000

Release 0.1.0

commit c2a2356436eea0040bd30a9969003895832fbfb5
Author: Lab User <lab@example.com>
Date:   Sat Oct 17 17:23:02 2026 +0000

    feat: first release
```

An annotated tag has its own header with the **tagger**, date and message, before the commit it points at. A lightweight tag (`git tag v0.0.1`) would show only the commit.

If you see something else: if `git show` shows only a `commit` and no `tag` header, you made a lightweight tag. Delete it (`git tag -d v0.1.0`) and recreate it with `-a`.

### Exercise 4: Release notes from a range

1. Add three commits, then list what is new since the tag:

   ```bash
   echo "x" >> app.py && git commit -qam "feat: add greeting option"
   echo "y" >> app.py && git commit -qam "fix: handle empty name"
   echo "z" >> app.py && git commit -qam "docs: update readme"
   git log --oneline v0.1.0..main
   git log --pretty='- %s (%h)' v0.1.0..main
   ```

Expected (illustrative; hashes differ):

```text
d38b97b docs: update readme
19de1fc fix: handle empty name
e14f368 feat: add greeting option
- docs: update readme (d38b97b)
- fix: handle empty name (19de1fc)
- feat: add greeting option (e14f368)
```

2. Turn it into a `CHANGELOG.md` section by hand: put `feat` under `Added`, `fix` under `Fixed`, and leave out `docs`, because a user does not care.

If you see something else: an empty result means the tag is on the latest commit (nothing new), or you wrote the range backwards (`main..v0.1.0` lists nothing new).

### Exercise 5: A hotfix that does not touch `main`

1. Start from a fresh repository with `main` ahead of the tag. Make the hotfix touch a different file to keep it simple:

   ```bash
   cd ~/release-lab && rm -rf hotfix-demo && git init -q -b main hotfix-demo && cd hotfix-demo
   git config user.name "Lab User" && git config user.email lab@example.com
   echo "print('v1')" > app.py && echo "TIMEOUT=0" > config.py
   git add . && git commit -qm "feat: first release"
   git tag -a v0.1.0 -m "Release 0.1.0"
   echo "x" >> app.py && git commit -qam "feat: add greeting option"
   git switch -q -c hotfix/0.1.1 v0.1.0
   echo "TIMEOUT=30" > config.py && git commit -qam "fix: set a request timeout"
   git tag -a v0.1.1 -m "Release 0.1.1"
   git log --oneline --decorate --graph --all
   ```

2. Carry the fix into `main` and look at the result:

   ```bash
   git switch -q main
   git cherry-pick hotfix/0.1.1
   git log --oneline --decorate -4
   ```

Expected (illustrative):

```text
* c43b545 (hotfix/0.1.1, tag: v0.1.1) fix: set a request timeout
| * 8b88a41 (main) feat: add greeting option
|/
* c6b1174 (tag: v0.1.0) feat: first release
```

After the cherry-pick, `main` has a **new** commit with the same change and a different hash:

```text
7452100 (HEAD -> main) fix: set a request timeout
8b88a41 feat: add greeting option
c6b1174 (tag: v0.1.0) feat: first release
```

The release `v0.1.1` was cut from `v0.1.0` plus the fix, without any of the unreleased work on `main`.

If you see something else: a conflict on cherry-pick means `main` changed the same lines as the fix. Resolve it, `git add`, then `git cherry-pick --continue` ([[learn/git-merge-rebase-and-undo]]). `git merge-base --is-ancestor v0.1.1 main` answers "no" after a cherry-pick, because the commit is a copy, not the same commit; that is expected.

### Exercise 6: A moved tag is rejected

1. Make a bare repository as the remote, push the tag, then try to move it:

   ```bash
   cd ~/release-lab && git init -q --bare -b main origin.git
   cd hotfix-demo && git remote add origin ../origin.git
   git push -q origin main v0.1.0
   git tag -f -a v0.1.0 -m "retag"
   git push origin v0.1.0
   ```

Expected (illustrative):

```text
Updated tag 'v0.1.0' (was adff905)
To ../origin.git
 ! [rejected]        v0.1.0 -> v0.1.0 (already exists)
error: failed to push some refs to '../origin.git'
hint: Updates were rejected because the tag already exists in the remote.
```

Git moved the tag **locally** with `-f`, and the remote refused. Put your local tag back: `git tag -d v0.1.0 && git fetch origin tag v0.1.0`.

> [!danger] Do not force it
> `git push --force origin v0.1.0` would overwrite the remote tag. Everything that recorded the old tag (build caches, scanners, deploy history) would now disagree with Git. Cut a new version instead.

If you see something else: if the push succeeds, someone passed `--force` or `+v0.1.0`, which overwrites the remote tag. Git's default refuses it, but the default is a guard against accidents, not a rule. On a hosted platform, protect the `v*` tags in the project settings so even a forced push is refused.

### Exercise 7: SemVer on paper

For each change, name the next version after `2.3.4`, and say why.

1. The API now accepts an optional `?limit=` parameter.
2. A field `userName` is renamed to `username` in a response.
3. A crash on an empty request body is fixed, with no API change.

Expected: (1) `2.4.0`, MINOR, a backward-compatible addition. (2) `3.0.0`, MAJOR, because clients that read `userName` break. (3) `2.3.5`, PATCH.

If you see something else: if you answered `2.4.0` for the rename, ask who relies on that field. If the answer is "anyone outside the team", it is MAJOR.

### Exercise 8: A rollback you can time

You will deploy two versions into a local "stage" folder, break the newer one, and roll back, with a smoke test, in well under five minutes. The scripts mimic a real deploy: copy an artifact to a release folder and switch the `current` symlink.

1. Create the files:

   ```bash
   mkdir -p ~/rollback-lab/artifacts/1.0.0 ~/rollback-lab/artifacts/1.1.0 && cd ~/rollback-lab
   echo 1.0.0 > artifacts/1.0.0/VERSION
   echo 1.1.0 > artifacts/1.1.0/VERSION
   ```

   ```bash title="deploy.sh"
   #!/usr/bin/env bash
   # Usage: deploy.sh <version>   Deploys a prebuilt artifact by switching a symlink.
   set -euo pipefail
   ENV_DIR="${ENV_DIR:-./stage}"
   version="${1:?usage: deploy.sh <version>}"
   src="./artifacts/${version}"
   [[ -d "$src" ]] || { echo "no such artifact: $version" >&2; exit 1; }
   mkdir -p "$ENV_DIR/releases"
   rm -rf "${ENV_DIR:?}/releases/${version}"
   cp -r "$src" "$ENV_DIR/releases/${version}"
   if [[ -L "$ENV_DIR/current" ]]; then
     basename "$(readlink "$ENV_DIR/current")" > "$ENV_DIR/previous"
   fi
   ln -sfn "releases/${version}" "$ENV_DIR/current"
   echo "deployed ${version} to ${ENV_DIR}"
   ```

   ```bash title="smoke.sh"
   #!/usr/bin/env bash
   # Usage: smoke.sh <expected-version>   Fails if the running version is not the expected one.
   set -euo pipefail
   ENV_DIR="${ENV_DIR:-./stage}"
   expected="${1:?usage: smoke.sh <expected-version>}"
   actual="$(cat "$ENV_DIR/current/VERSION")"
   if [[ "$actual" == "$expected" ]]; then
     echo "smoke OK: running ${actual}"
   else
     echo "smoke FAILED: expected ${expected}, running ${actual}" >&2
     exit 1
   fi
   ```

   ```bash title="rollback.sh"
   #!/usr/bin/env bash
   # Usage: rollback.sh   Redeploys the previous artifact. Never rebuilds.
   set -euo pipefail
   ENV_DIR="${ENV_DIR:-./stage}"
   [[ -f "$ENV_DIR/previous" ]] || { echo "no previous release recorded" >&2; exit 1; }
   prev="$(cat "$ENV_DIR/previous")"
   echo "rolling back to ${prev}"
   ./deploy.sh "$prev"
   ```

2. Make them executable, deploy both versions in order, and check:

   ```bash
   chmod +x deploy.sh smoke.sh rollback.sh
   ./deploy.sh 1.0.0
   ./deploy.sh 1.1.0
   ./smoke.sh 1.1.0
   ```

   Expected: `deployed 1.0.0 to ./stage`, `deployed 1.1.0 to ./stage`, `smoke OK: running 1.1.0`.

3. Pretend `1.1.0` is broken. Time the rollback and verify:

   ```bash
   time ./rollback.sh
   ./smoke.sh 1.0.0
   ./smoke.sh 1.1.0; echo "exit=$?"
   ```

   Expected (illustrative timing):

   ```text
   rolling back to 1.0.0
   deployed 1.0.0 to ./stage

   real	0m0.021s
   smoke OK: running 1.0.0
   smoke FAILED: expected 1.1.0, running 1.0.0
   exit=1
   ```

4. Write a half-page rollback runbook for a real service you know (or the Kubernetes lab from [[learn/kubernetes-pods-and-deployments]]): how to find the previous version, the command, the smoke test, who to tell, and what to do next (revert and a postmortem). Then run the whole thing on a stage environment and time it. The goal is under five minutes with no improvising.

If you see something else: `no previous release recorded` means only one version was deployed. Note that after a rollback `previous` holds `1.1.0`, so running `rollback.sh` again flips back to the broken version. A real tool should refuse a rollback to a version that is marked bad. Clean up with `rm -rf ~/rollback-lab ~/release-lab`.

## Common mistakes

- **Deploying production from a feature branch.** Why it bites: unreviewed code reaches users. Fix: production jobs run only from tags (or a protected default branch) and protected tags limit who creates them.
- **One credential for every environment.** Why it bites: a leak from `dev` is a breach of production. Fix: one credential per environment, scoped to the minimum, protected so only production pipelines see the production one.
- **Self-approval.** Why it bites: the control exists on paper only. Fix: the approver cannot be the author of the change or the person who triggered the deployment.
- **Rebuilding for production.** Why it bites: the artifact in production was never tested. Fix: promote the same digest.
- **Moving or deleting a published tag.** Why it bites: the name no longer identifies one build. Fix: protect tags, and fix forward with a new version.
- **Rolling back by rebuilding old code.** Why it bites: a rebuild is a new build and may fail or differ. Fix: keep the previous artifacts and redeploy one.
- **Reverting in Git instead of rolling back.** Why it bites: a revert needs a review and a full pipeline, so it is slow, and production stays broken meanwhile. Fix: roll back first, revert after.
- **Never practising the rollback.** Why it bites: the first time you try it is during an incident. Fix: run it on stage regularly and time it (exercise 8).
- **A hotfix that is not carried back.** Why it bites: the next release silently loses the fix. Fix: cherry-pick or merge it into `main` straight away (exercise 5).
- **Treating SemVer as decoration.** Why it bites: users cannot judge the risk of an upgrade. Fix: define the public interface and bump by the rules.

## Check your understanding

1. Why is production deployed from a tag and not from a branch?
2. Why must you never move a published tag, and what do you do instead?
3. What is the difference between a rollback and a `git revert`, and which comes first?
4. Why must the approver of a production deployment not be its author?
5. Your build is `v1.4.0`. Production breaks. A teammate suggests "just rebuild `v1.3.2` and deploy it". What is wrong with that?
6. You add a required field to a request. What kind of version bump is that under SemVer, and why?

> [!question]- Answers
>
> 1. A tag is a deliberate, named, immutable point: it records exactly which commit was released and who created it, and it can be protected so only certain people can make one. A branch keeps moving, so "deploy the branch" does not say what was deployed.
> 2. Other systems (registries, caches, scanners, deploy history) have already recorded the tag, so a moved tag means two different builds share one name and nobody knows which one runs. Cut a new version, for example `v1.4.1`, and let the old one stay as it was.
> 3. A rollback redeploys the previous artifact to stop the damage now, and it does not change Git history. A `git revert` adds a commit that undoes the change so the branch no longer contains it, and it goes through review. Roll back first to restore service, then revert.
> 4. The control is there to catch mistakes and misuse by a second pair of eyes. If the author approves their own deployment, no second person looked, so the control does nothing. It is also a common audit expectation.
> 5. Rebuilding is a new build: it can pick up newer dependencies, a different base image, or fail because the pipeline changed. The old artifact is already built and was proven in production, so redeploy that. Keep recent artifacts for this reason.
> 6. MAJOR, because existing clients that do not send the field now fail. An optional field would be MINOR. Making a required field is an incompatible change to the public interface.

## Next steps

Next lesson: [[learn/terraform-basics-on-gcp|Delivery 04: Terraform basics with a first GCP project]]. Previous lesson: [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02: Your first pipeline in GitLab CI and Jenkins]].

To go deeper:

- [[patterns/artifact-promotion-artifactory]] shows promotion of one artifact through repositories.
- [[runbooks/helm-release-rollback]] and [[runbooks/argocd-sync-failure-and-drift]] are the real rollback procedures for Kubernetes.
- [[standards/production-change-checklist]] is the checklist to use before a production change.
- [[patterns/progressive-delivery-argo-rollouts]] and [[tools/argo-rollouts-vs-spinnaker]] cover canaries and automatic rollback.
- [[patterns/release-versioning-and-changelog-automation]] automates versions and changelogs.
- [[patterns/zero-downtime-deployments-kubernetes]] explains how a deploy avoids dropping requests.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

The Git exercises (3, 4, 5, 6) and the rollback exercise (8) were run with Git 2.43.0 on Ubuntu on 2026-10-17. The rest is explanation from the sources below and was not run. Pages change: check them for the version you use.

- GitLab documentation, "Environments" and "Deployments" (https://docs.gitlab.com/ci/environments/). Version not verified.
- GitLab documentation, "Protected environments" and "Deployment approvals" (https://docs.gitlab.com/ci/environments/protected_environments/, https://docs.gitlab.com/ci/environments/deployment_approvals/). Not verified: which licence tier includes which option.
- GitLab documentation, "Releases" and "Protected tags" (https://docs.gitlab.com/user/project/releases/, https://docs.gitlab.com/user/project/protected_tags/).
- GitLab documentation, "Manual jobs" under "Specify when jobs run with `rules`" (https://docs.gitlab.com/ci/jobs/job_control/). Not verified: the default `allow_failure` of manual jobs in your version.
- Jenkins documentation, the `input` step (https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/).
- Semantic Versioning 2.0.0 (https://semver.org/).
- Keep a Changelog (https://keepachangelog.com/).
- Git documentation, `git-tag`, `git-log` (revision ranges) and `git-cherry-pick` (https://git-scm.com/docs). Version checked: 2.43.0.
- Google Cloud documentation, "Artifact Registry: manage tags" (https://cloud.google.com/artifact-registry/docs). Not verified: the `gcloud artifacts docker tags add` arguments.
