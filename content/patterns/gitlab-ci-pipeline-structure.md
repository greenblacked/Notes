---
title: GitLab CI pipeline structure
description: A production GitLab CI layout using rules, needs, shared includes, caching, protected environments and a manual production gate, with a full working example.
type: pattern
tags:
  - patterns
  - gitlab-ci
  - ci-cd
  - kubernetes
  - gke
  - helm
  - docker
created: 2026-10-16
modified: 2026-10-16
draft: false
---

This is the pipeline shape I use for a containerised service that deploys to GKE with Helm. It favours a small number of stages, a DAG via `needs`, shared templates pulled in with `include`, and one manual gate in front of production. The syntax is documented in the GitLab CI/CD YAML reference at docs.gitlab.com; check it for anything version-specific on your instance, because keyword support differs between GitLab releases.

For the Jenkins equivalent see [[jenkins-shared-libraries]]. For the trade-offs between the two tools see [[gitlab-ci-vs-jenkins]].

## Design principles

- **Stages are coarse, `needs` is precise.** Stages give humans a readable graph (build, test, scan, package, deploy). `needs` lets a job start as soon as its real dependencies finish instead of waiting for the whole previous stage.
- **One definition of "when does this run".** Put the pipeline-level decision in `workflow:rules` and the job-level decision in `rules`. Do not mix `only/except` with `rules`; `only/except` is legacy.
- **Build once, promote the same image.** The image built on the commit is the image that reaches production. Never rebuild per environment. See [[artifact-promotion-artifactory]] for the same idea with an artifact repository.
- **Cache is an optimisation, artifacts are data flow.** If a later job needs the output, use `artifacts`. If it only needs to be faster, use `cache`.
- **Deploy jobs are boring.** They call `helm upgrade --install` with the image tag and nothing else. Logic lives in the chart ([[helm-chart-conventions]]).

## Merge request pipelines vs branch pipelines

A push to a branch with an open merge request can create two pipelines: a branch pipeline and a merge request pipeline. Duplicated pipelines waste runners and confuse reviewers. Fix it once with `workflow:rules`:

```yaml title=".gitlab-ci.yml"
workflow:
  rules:
    # Merge request pipeline: the one reviewers see.
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    # Skip the branch pipeline when an MR is already open for this branch.
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    # Default branch, other branches without an MR, and tags.
    - if: $CI_COMMIT_BRANCH
    - if: $CI_COMMIT_TAG
```

Consequences to be aware of:

- Merge request pipelines run against the source branch by default. If you need the result of merging into the target branch, enable merged results pipelines in the project settings (a paid-tier feature at the time of writing; check the docs for your tier).
- Variables that are only defined for protected branches or tags (protected variables) are not available in merge request pipelines from unprotected branches. Do not deploy from an MR pipeline.
- `CI_COMMIT_BRANCH` is not set in MR pipelines; use `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` or `CI_COMMIT_REF_NAME` where you need a name.

## Repository layout

```text
.gitlab-ci.yml            # pipeline entry point, small
ci/
  build.yml               # local includes, optional split
  deploy.yml
helm/<chart>/             # the chart for the service
```

Shared templates live in a separate project (for example `platform/ci-templates`) and are pulled in with `include:project`. Pin them to a tag or commit with `ref`, not to `main`, so a change to the shared template cannot break every pipeline at once:

```yaml title=".gitlab-ci.yml (include section)"
include:
  - project: platform/ci-templates
    ref: v3.2.0
    file:
      - /templates/docker-build.yml
      - /templates/helm-deploy.yml
  - template: Security/SAST.gitlab-ci.yml
```

Template jobs start with a dot (`.docker-build`) so they never run on their own, and your pipeline adopts them with `extends`.[^extends] CI/CD components (`include:component`) are the newer, versioned alternative to file includes; evaluate them if your GitLab version supports them.

[^extends]: `extends` merges maps deeply but replaces arrays such as `script`. Check the merge behaviour before overriding.

## Caching vs artifacts

|                 | `cache`                                            | `artifacts`                                    |
| --------------- | -------------------------------------------------- | ---------------------------------------------- |
| Purpose         | Speed: reuse downloaded dependencies               | Pass job output to later jobs and keep reports |
| Guarantee       | Best effort, may be missing                        | Reliable within the pipeline                   |
| Scope           | Per runner/cache config, shared across pipelines   | Per pipeline, uploaded to GitLab               |
| Typical content | `.npm/`, `.m2/`, `~/.cache/go-build`               | build output, JUnit XML, coverage, plan files  |
| Key setting     | `key:files` so the cache changes with the lockfile | `expire_in` to bound storage                   |

Rules of thumb: key the cache on the lockfile (`key: files: [package-lock.json]`), make cache `policy: pull` in jobs that only read it, and never rely on the cache for correctness. Set `expire_in` on every artifact; the default retention is an instance setting and can be long.

## Environments and protected deploys

- Declare an `environment` on every deploy job (`name`, `url`, and `action: stop` for review apps). GitLab then tracks deployments, shows what is live, and lets you roll back from the UI.
- Define protected environments (Settings, CI/CD, Protected environments) so only a named group can run the production deploy job. Protected environments are a Premium feature; on Free tiers use protected branches and protected CI variables instead.
- Add `resource_group` to deploy jobs so two pipelines never deploy the same environment at once.
- Production is `when: manual` with `allow_failure: false`, so the pipeline stops at the gate and a blocked pipeline is not reported as green.

> [!warning] Be explicit about `allow_failure` on the gate
> Outside `rules`, a `when: manual` job defaults to `allow_failure: true`, so a pipeline can show as passed while production was never deployed. Inside `rules` the default is false, but set `allow_failure: false` explicitly so the intent is visible and survives refactoring.

## Complete example

The example builds and tests a Node.js service, runs SAST and an image scan, builds and pushes a Docker image to the project's GitLab container registry, deploys to staging automatically from the default branch, and gates production behind a manual job. Kubernetes access uses the GitLab agent for Kubernetes through the context `kubectl config use-context`; replace the agent path and the chart values with yours.

```yaml title=".gitlab-ci.yml"
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH
    - if: $CI_COMMIT_TAG

include:
  - template: Security/SAST.gitlab-ci.yml

stages:
  - build
  - test
  - package
  - scan
  - deploy

variables:
  NODE_IMAGE: node:22-alpine
  IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA
  # Pin these by tag and digest to versions you have tested, in the form
  # <image>:<tested-version>@sha256:<digest>. Kept current by Renovate, see the note below.
  # renovate: datasource=docker depName=aquasec/trivy
  TRIVY_IMAGE: aquasec/trivy:<tested-version>@sha256:<digest>
  # renovate: datasource=docker depName=dtzar/helm-kubectl
  HELM_IMAGE: dtzar/helm-kubectl:<tested-version>@sha256:<digest>
  AGENT_CONTEXT: platform/cluster-agents:gke-prod
  CHART: helm/my-service
  NPM_CONFIG_CACHE: $CI_PROJECT_DIR/.npm

default:
  interruptible: true

.node:
  image: $NODE_IMAGE
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
    policy: pull

build:
  extends: .node
  stage: build
  cache:
    policy: pull-push
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 day

unit-test:
  extends: .node
  stage: test
  needs: [build]
  script:
    - npm ci
    - npm test -- --reporters=default --reporters=jest-junit
  artifacts:
    when: always
    reports:
      junit: junit.xml
    expire_in: 1 week

lint:
  extends: .node
  stage: test
  needs: []
  script:
    - npm ci
    - npm run lint

# The SAST template adds its own jobs to the test stage. Nothing else to do here.

docker-build:
  stage: package
  image: docker:cli
  services:
    - docker:dind
  needs: [build, unit-test]
  variables:
    DOCKER_TLS_CERTDIR: /certs
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - docker build --pull -t "$IMAGE" .
    - docker push "$IMAGE"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: never
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG

image-scan:
  stage: scan
  image:
    name: $TRIVY_IMAGE
    entrypoint: [""]
  needs: [docker-build]
  variables:
    TRIVY_USERNAME: $CI_REGISTRY_USER
    TRIVY_PASSWORD: $CI_REGISTRY_PASSWORD
  script:
    - trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed "$IMAGE"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: never
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG

.helm-deploy:
  image:
    name: $HELM_IMAGE
    entrypoint: [""]
  interruptible: false
  script:
    - kubectl config use-context "$AGENT_CONTEXT"
    - helm lint "$CHART" -f "$CHART/values-$ENV_NAME.yaml"
    - >
      helm upgrade --install my-service "$CHART"
      --namespace "$NAMESPACE" --create-namespace
      -f "$CHART/values-$ENV_NAME.yaml"
      --set image.repository="$CI_REGISTRY_IMAGE"
      --set image.tag="$CI_COMMIT_SHORT_SHA"
      --atomic --wait --timeout 5m
    - kubectl rollout status deployment/my-service --namespace "$NAMESPACE" --timeout=300s

# No `needs`: the deploy waits for every job in the earlier stages, so lint, unit tests,
# SAST and the image scan all have to pass before anything reaches staging.
deploy-staging:
  extends: .helm-deploy
  stage: deploy
  variables:
    ENV_NAME: staging
    NAMESPACE: my-service-staging
  environment:
    name: staging
    url: https://staging.example.com
  resource_group: staging
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy-production:
  extends: .helm-deploy
  stage: deploy
  needs: [deploy-staging]
  variables:
    ENV_NAME: production
    NAMESPACE: my-service
  environment:
    name: production
    url: https://www.example.com
  resource_group: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
      allow_failure: false
```

Notes on the example:

- `lint` has `needs: []`, so it starts immediately and does not wait for `build`.
- `deploy-staging` has no `needs` on purpose. A `needs` list replaces the stage barrier, so `needs: [image-scan]` would let a commit that fails `lint` or SAST (which run in parallel) reach staging, and production after it. Without `needs` the deploy waits for every earlier stage. If you add `needs` for speed, list every gating job, including the SAST jobs the template creates.
- The `package` stage comes before `scan` because `image-scan` needs `docker-build`, and a job can only need jobs in the same or an earlier stage.
- The Docker build, scan and deploy jobs are excluded from merge request pipelines. MRs get build, test, lint and SAST; the image only exists for commits on the default branch or tags.
- `--atomic` rolls the release back if the upgrade fails, and `--wait` makes Helm wait for the workload to become ready. See [[helm-release-rollback]] for the manual path.
- `docker:dind` needs a runner with privileged mode. If your runners are not privileged, use a rootless builder; check the maintenance status of any tool you pick, because some popular builders have been archived.
- Production deploys use the same image tag as staging. Nothing is rebuilt.
- `deploy-production` lists only `deploy-staging` in `needs`. That is safe because deploy-staging has no needs and therefore waited for every earlier stage; if you ever add needs to deploy-staging, list the same gates here too.
- Deploying by tag is shown for brevity. To deploy exactly what was scanned and promoted, capture the digest after push (for example `docker inspect --format "{{index .RepoDigests 0}}" "$IMAGE"`), pass it to later jobs as a dotenv artifact, and deploy by digest if your chart supports it.

## Pitfalls

- **Duplicate pipelines.** Forgetting `workflow:rules` gives two pipelines per push to an MR branch.
- **`needs` and artifacts.** A job with `needs` downloads artifacts only from the jobs it lists. If you list `needs: [build]` and also need artifacts from an earlier stage, list that job too.
- **`needs` points backwards only.** A job can need jobs in its own or an earlier stage; a job in a later stage makes the pipeline invalid when it is created. Across pipelines, use `trigger` or `needs:pipeline`.
- **`needs` bypasses checks that are not listed.** Gate jobs (deploys, releases) should either list every job that must pass or have no `needs` at all.
- **Floating image tags.** This is the site-wide rule: pin tool images by tag and digest, let [[automated-dependency-updates]] open merge requests to bump them, and never use `latest`. Other notes link here for it.
- **Secrets in `variables:`.** Anything in the YAML is visible to everyone with repo access. Use masked, protected CI/CD variables, or better, short-lived credentials from OIDC (`id_tokens`) and an external secret manager.
- **Unbounded artifacts and caches.** Missing `expire_in` fills storage; a cache key that never changes serves stale dependencies.
- **Shared template on `main`.** A breaking change to a template then hits every project. Pin `ref` and release templates like software.
- **Manual gate without an explicit `allow_failure: false`.** See the warning above.
- **`rules` with `changes` on new branches.** On the first push of a branch there is no previous commit to compare to, so `changes` can match everything. Use `compare_to` where available and test the behaviour.

## Verify

- The pipeline graph shows the gate: staging deploys only after the earlier stages pass.
- The staging URL is healthy after `deploy-staging`.
- The production job stays blocked until someone runs it manually.

## Rollback

Re-run the production deploy job of the last good pipeline, or see [[helm-release-rollback]] for the manual path.

## Related

- [[terraform-module-and-state-layout]]: the same plan-then-manual-apply gate for infrastructure.
- [[sonarqube-quality-gates]]: add a quality gate to the test stage.
- [[production-change-checklist]]: what to confirm before pressing the production button.
