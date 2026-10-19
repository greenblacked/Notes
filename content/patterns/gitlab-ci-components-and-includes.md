---
title: Reusable GitLab CI components and includes with versioned inputs
description: Share pipeline logic across projects with include, CI/CD components and the catalog, using typed inputs and pinned semver versions.
type: pattern
tags:
  - patterns
  - gitlab-ci
  - ci-cd
  - delivery
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Copying `.gitlab-ci.yml` fragments between repositories works until the first security fix has to land in forty places. GitLab offers two sharing mechanisms: `include` (merge YAML from somewhere else) and **CI/CD components** (versioned, parameterised units published from a project, optionally listed in a catalog). This note covers how to choose, how to build a component, and how to consume it safely. For how a single pipeline is laid out, see [[gitlab-ci-pipeline-structure]]; this note is about sharing logic across projects.

> [!info] Not checked against live docs
> The GitLab version that introduced each feature (components, `spec:inputs`, input types, the catalog, version syntax such as `~latest`) was not checked against the live docs and is not stated here on purpose. Check the current GitLab documentation for what your instance and edition support, and for current include and input limits. All YAML below is illustrative until validated with the CI Lint tool on your instance.

## Include types and what they trust

| Type        | Syntax                                             | Trust implication                                                              |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `local`     | `include: - local: /ci/build.yml`                  | Same repository, same review. Safe.                                            |
| `project`   | `include: - project: platform/ci` with `ref:`      | Another project on the same instance. Pin `ref` to a tag or SHA.               |
| `component` | `include: - component: host/path/name@version`     | Versioned, typed inputs. Preferred for shared logic.                           |
| `template`  | `include: - template: Security/SAST.gitlab-ci.yml` | Templates shipped with GitLab; content changes when GitLab is upgraded.        |
| `remote`    | `include: - remote: https://example.com/ci.yml`    | Fetches arbitrary URL content on every pipeline. Avoid; no version, no review. |

Whoever controls the included file controls what runs in your pipeline, with your project's variables and runners. Treat included content as code you execute: pin to immutable refs, and protect the source project (merge requests, approvals, protected tags). The decision to share central templates in a versioned way is recorded in [[0013-versioned-central-ci-templates]].

## Components and typed inputs

A component is a project containing templates in a `templates/` directory. Each template starts with a `spec` header declaring inputs, then `---`, then the jobs.

```text title="platform/ci-components layout"
templates/
  docker-build.yml
  helm-lint.yml
  terraform-plan.yml
.gitlab-ci.yml        # the component project's own test pipeline
README.md
CHANGELOG.md
```

```yaml title="templates/docker-build.yml"
spec:
  inputs:
    stage:
      default: build
    image_name:
      type: string
      regex: "^[a-z][a-z0-9-]*$"
    dockerfile:
      default: Dockerfile
    context:
      default: .
    push:
      type: boolean
      default: false
---
docker-build-$[[ inputs.image_name ]]:
  stage: $[[ inputs.stage ]]
  image: docker:cli
  script:
    - |
      if [ "$[[ inputs.push ]]" = "true" ]; then OUTPUT="--push"; else OUTPUT="--load"; fi
      docker buildx build "$OUTPUT" -f "$[[ inputs.dockerfile ]]" -t "$CI_REGISTRY_IMAGE/$[[ inputs.image_name ]]:$CI_COMMIT_SHORT_SHA" "$[[ inputs.context ]]"
  rules:
    - if: "$CI_COMMIT_BRANCH"
```

The job needs a BuildKit or Docker daemon to talk to (a rootless BuildKit service, not privileged Docker-in-Docker); see [[buildkit-registry-cache-in-ci]]. The `push` input switches between `--push` and `--load`.

Input features to use deliberately (check the docs for your version):

- `type`: string, number, boolean or array. Without a type it defaults to string.
- `default`: makes the input optional. An input with no default is required and fails the pipeline when missing, which is what you want for names that must be explicit.
- `options`: restricts to an enumeration.
- `regex`: validates string values.
- Interpolation uses `$[[ inputs.name ]]` and is resolved when the pipeline is created, before `rules` and variables, so it cannot read runtime CI variables.

Keep inputs few and meaningful. A component with twenty inputs is a pipeline written in a different syntax. Prefer opinionated defaults, and expose only what teams legitimately differ on.

## Consuming a component

```yaml title=".gitlab-ci.yml"
include:
  - component: $CI_SERVER_FQDN/platform/ci-components/docker-build@1.4.2
    inputs:
      image_name: payments-api
      push: true

stages: [build, test, deploy]
```

**Pin a full version for production pipelines.** `@1.4.2` is reproducible (only if tags are protected; pin a full commit SHA for strict immutability); moving references such as `~latest` or a branch name give you whatever was published last, which turns a component release into an unreviewed change to every consumer at once. Use moving references only in sandbox projects, to try upcoming versions.

## Publishing to the catalog

1. Keep the component project public to its audience (instance, group or project visibility as needed) and give it a description and README with an inputs table.
2. Mark the project as a catalog resource in project settings, then publish by pushing a **release** with a semver tag from CI. Do not publish from a developer laptop.
3. Make the component's own `.gitlab-ci.yml` test it: run a lint job, include each template with sample inputs in a test project, and run those pipelines on merge requests.

```yaml title="component project .gitlab-ci.yml (sketch)"
stages: [test, release]

lint-components:
  stage: test
  script:
    - ./scripts/lint-templates.sh # your wrapper around the CI Lint API

release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  rules:
    - if: '$CI_COMMIT_TAG =~ /^\d+\.\d+\.\d+$/'
  script: echo "Releasing $CI_COMMIT_TAG"
  release:
    tag_name: $CI_COMMIT_TAG
    description: "See CHANGELOG.md"
```

Pin that `release-cli` image by version in a real pipeline, not `latest`. Version and changelog automation is covered in [[release-versioning-and-changelog-automation]].

## Versioning, breaking changes and deprecation

Follow semver for components and say what counts as breaking:

- **Major:** removing or renaming an input, changing an input's type or making an optional input required, renaming a job (consumers may `needs:` or override it), changing the default stage, changing which runners or images are required.
- **Minor:** a new optional input, a new job behind an input defaulting to off, a stricter default that does not fail existing pipelines.
- **Patch:** bug and security fixes with identical interface.

Deprecation flow: announce in the changelog, keep the old input working for one major version while printing a warning job output, then remove in the next major. Maintain at least the previous major with security fixes for a stated period.

Consumers keep pinned versions current with Renovate or similar, so each upgrade is a reviewed merge request with a pipeline run. See [[automated-dependency-updates]]. Check which version syntaxes your Renovate manager recognises for GitLab components.

## Pitfalls

- **`rules` and `needs` on included jobs.** Rules written inside the component apply as given; a consumer cannot easily append to them. If a project needs to change behaviour, expose an input (for example `run_on_tags`) rather than documenting "override the job".
- **Overriding jobs.** Defining a job with the same name in the consumer merges keys with the included one. That is powerful and fragile: renaming a key in the component breaks overrides silently. Prefer inputs.
- **Variable precedence.** Pipeline, project and group variables can override variables a template sets in `variables:`. Do not rely on a variable you set in a component staying unchanged; validate it inside the job.
- **Stages.** Components that hard-code stage names fail when the consumer does not define them. Make stage an input with a default, and document required stages.
- **Include depth and total size.** There are limits on nesting and on the number of includes. Check the current docs for the numbers rather than assuming; design flat.
- **`remote` includes from untrusted hosts.** A remote file can change between two pipelines with no review. Replace with `project` plus a pinned `ref`, or with a component.
- **Secrets.** A component runs with the consumer's CI/CD variables. Review components as you would a dependency with access to your credentials. See [[artifactory-access-tokens-and-oidc-for-ci]] for keeping credentials narrow.

## Verify

```bash title="verify an include or component change"
# 1. Lint the merged configuration for the project (needs a token with API read)
curl -fsS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  "https://gitlab.example.com/api/v4/projects/${PROJECT_ID}/ci/lint?include_merged_yaml=true" | jq '.valid, .errors'

# 2. Read the merged YAML (the "Full configuration" tab in the pipeline editor)
curl -fsS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  "https://gitlab.example.com/api/v4/projects/${PROJECT_ID}/ci/lint?include_merged_yaml=true" | jq -r '.merged_yaml' | less
```

The endpoint parameters can differ between versions; check the CI Lint API docs. In the pipeline editor, use "Full configuration" to see the result of includes and input interpolation, and run a pipeline on a merge request branch before merging a version bump.

## Rollback

- Consumer side: change `@1.4.2` back to `@1.4.1` and re-run. This is the whole rollback, and it is why version pins are mandatory.
- Producer side: do not delete or move a published tag; publish a fixed patch version, and mark the bad release in the changelog. Deleting releases breaks every consumer pinned to them.
- If a component compromise is suspected, rotate the credentials that its jobs could access and review recent pipeline logs; see [[leaked-credential-rotation]].

## Related

- [[gitlab-ci-pipeline-structure]]
- [[gitlab-ci-vs-jenkins]]
- [[jenkins-shared-libraries]]
- [[release-versioning-and-changelog-automation]]
- [[automated-dependency-updates]]
- [[inner-source-platform]]
- [[0013-versioned-central-ci-templates]]

## Sources

- [docs.gitlab.com/ci/components](https://docs.gitlab.com/ci/components/)
- [docs.gitlab.com/ci/yaml/#include](https://docs.gitlab.com/ci/yaml/#include)
- [docs.gitlab.com/ci/inputs](https://docs.gitlab.com/ci/inputs/)
