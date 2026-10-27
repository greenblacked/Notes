---
title: AI-assisted Kubernetes API deprecation upgrades
description: Use agents for Kubernetes and GKE minor upgrades, with deterministic detectors first, constrained fixes, target-version validation and staged rollout.
type: pattern
tags:
  - ai
  - kubernetes
  - delivery
  - reliability
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers how to use a coding agent to prepare and run a Kubernetes or GKE minor-version upgrade where the risk is deprecated or removed APIs: finding them in manifests, Helm charts and live clients, proposing mechanical fixes, validating against the target version, and rolling out in stages with a rollback plan. It is for platform and DevOps engineers who own clusters and chart repositories. It does not cover the node and control plane mechanics ([[gke-cluster-upgrade]], [[gke-node-pool-upgrade-strategies]]), the policy for deprecating your own APIs ([[api-deprecation-policy]]), or general dependency bumps ([[agent-assisted-dependency-upgrades]]).

> [!note] Not verified
> The sources below were found through search on 2026-10-27, but the pages could not be fetched. Check before relying on them: which APIs are removed in your target version, the current GKE auto-upgrade pause and resume behaviour, Pluto and kubent flags and output formats, and the kubeconform schema options. Removal lists change with every release, so no list is reproduced here.

## Principle: detectors find, agents propose, gates decide

An agent is a poor detector. It will recall removal lists from training data that may predate your target version, and it will miss APIs that only appear after templating. Reverse the roles:

1. Deterministic tools produce the finding list.
2. The agent works only from that list plus the official migration guide for the target version.
3. Deterministic validators and a human decide whether each change merges.

The agent's value is the tedious part: reading findings, locating the source file or chart template, applying a mechanical migration, and writing the pull request description. This is the same split described in [[validating-ai-generated-infrastructure-code]].

## Step 1: detect with deterministic tools

Run more than one detector, because they see different things.

- **Static scanners on files.** Pluto scans raw YAML and Helm charts and can flag removed versus merely deprecated APIs, which makes it suitable as a CI gate.
- **Scanners on live state.** kubent (kube-no-trouble) reads a cluster or Helm releases. Triage every hit against the target version rather than relying on how the tool categorises it.
- **The cluster itself.** `kubectl api-versions` on the target-version test cluster shows what is actually served, and API server deprecation warnings show what your clients call. Static tools only see what is in the repository.

Render Helm charts before scanning. Templates scanned raw miss APIs chosen by `.Capabilities` conditionals and values files that differ per environment.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Render every release with production values, then scan the output.
# Flags and target-version syntax vary by tool version: check the current docs.
TARGET_KUBE_VERSION="${TARGET_KUBE_VERSION:?set e.g. the next minor}"
TARGET_KUBE_VERSION="${TARGET_KUBE_VERSION#v}"
shopt -s nullglob
mkdir -p rendered findings

for chart in charts/*/; do
  name="$(basename "$chart")"
  helm template "$name" "$chart" \
    --values "$chart/values-prod.yaml" \
    --kube-version "$TARGET_KUBE_VERSION" \
    > "rendered/$name.yaml"
done

# Pluto exits non-zero when it finds deprecated or removed APIs, so record
# the status instead of aborting, but still fail if it produced no report.
status=0
pluto detect-files -d rendered/ --target-versions "k8s=v${TARGET_KUBE_VERSION}" \
  -o json > findings/pluto.json || status=$?
if [[ ! -s findings/pluto.json ]]; then
  echo "pluto produced no report (exit ${status})" >&2
  exit 1
fi
echo "pluto exit status: ${status}" >&2
```

Tolerating the exit status here only lets the agent collect the findings; a tool error with no report still fails. The CI gate in step 3 must still fail the pipeline on removed APIs.

### kubent false positives

kubent's detection depends on the original manifest stored by kubectl or Helm, usually the `kubectl.kubernetes.io/last-applied-configuration` annotation. An object can already be served at a current version while that annotation still records an old one. Before the agent proposes any rewrite for a kubent finding, have it check the live object and the repository source. If the repository is already clean, the finding is a stale annotation, not a manifest change, and the right action is to re-apply or ignore with a recorded reason.

### Find the real offending clients

Manifests in git can be clean while a controller, CI job or older Helm release still calls a removed API. On GKE, deprecation insights and audit logs are based on observed calls, so filter by user agent and by the deprecation audit annotations (upstream Kubernetes uses `k8s.io/deprecated` and `k8s.io/removed-release`; check the current docs for your platform) to find the caller. The fix is then to upgrade that controller or chart, not to edit a manifest. Give the agent the audit log extract as input and ask it to map each caller to an owning repository or Helm release.

## Step 2: give the agent the spec, not its memory

Put the target-version Kubernetes Deprecated API Migration Guide page in the agent's context, or fetch it in a tool call, and require every proposed change to cite the entry it implements. Use the page that matches the target minor version. For GKE, read the version-specific deprecations page as well, because the managed platform adds its own notes.

A task definition that holds up:

```yaml title="agent-task.yaml"
task: migrate-removed-apis
target_version: "<next minor, set per run>"
inputs:
  - findings/pluto.json
  - findings/audit-callers.json
  - docs/deprecation-guide-target.md # copy of the target-version page
allowed_changes:
  - apiVersion bumps listed in the guide
  - field moves the guide documents for that bump
forbidden_changes:
  - selectors, labels, replica counts, defaults, resource limits
  - any field whose semantics change (flag for human)
output:
  - one commit per resource kind
  - for each resource: before/after diff and the guide entry cited
  - a list of findings it could not fix mechanically
stop_when:
  - kubeconform fails twice on the same file
  - more than N files changed
```

Bound the loop as described in [[bounded-agent-loops-and-stop-conditions]], and keep the diff small enough to review ([[agent-pull-request-size-and-reviewability]]).

### What counts as a mechanical change

Allowed: bumping `apiVersion` where the schema is identical, or moving a field exactly as the guide states. Reject and escalate: renamed fields with different meaning (the Event API migration is a known example where a field maps to a differently named one), changed defaults, new required fields, and anything touching selectors, which are immutable on many workload kinds. A diff that "also tidies" unrelated fields fails review.

## Step 3: validate against the target version

Validate with kubeconform using the target version's schemas, not the current cluster's. Run it on rendered Helm output as well as raw manifests, and include CRD schemas for custom resources, since built-in schemas will not cover them.

```yaml title=".gitlab-ci.yml"
k8s-upgrade-validate:
  stage: test
  # Pin the tools image by digest; the image must provide bash for pipefail.
  image: registry.example.com/ci/k8s-tools@sha256:<digest>
  variables:
    TARGET_KUBE_VERSION: "$K8S_TARGET_VERSION"
  script:
    - set -Eeuo pipefail
    - export TARGET_KUBE_VERSION="${TARGET_KUBE_VERSION#v}"
    - mkdir -p rendered
    - helm template app charts/app -f charts/app/values-prod.yaml --kube-version "$TARGET_KUBE_VERSION" > rendered/app.yaml
    # Add -schema-location entries for your CRD schemas; -strict and unknown kinds fail otherwise.
    - kubeconform -strict -summary -kubernetes-version "$TARGET_KUBE_VERSION" rendered/app.yaml
    - pluto detect-files -d rendered/ --target-versions "k8s=v${TARGET_KUBE_VERSION}" --ignore-deprecations
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event" && $K8S_TARGET_VERSION
      changes:
        - charts/**/*
        - manifests/**/*
```

Treat these as two separate gates. kubeconform catches schema errors, not semantic ones, and the scanner catches removed APIs, not malformed fields. Flag syntax above is illustrative; check each tool's current docs.

Add a server-side check where you can: a `kubectl apply --dry-run=server` against a target-version test cluster catches admission and CRD problems no static tool sees. Further CI gates for charts are in [[helm-chart-ci-quality-gates]].

## Step 4: staged rollout

1. **Test cluster on the target version.** Apply the migrated manifests, run smoke tests, and watch API server deprecation warnings for remaining callers.
2. **Staging or canary.** Upgrade a non-production cluster, or a canary node pool or namespace subset, and soak.
3. **Production in a maintenance window.** The upgrade itself follows [[gke-cluster-upgrade]]. A human approves the production apply; the agent prepares, it does not trigger.

On GKE, automatic upgrades may be paused when the platform observes calls to APIs removed in the next minor version, and may resume after a quiet period. This is not a guarantee and the details change, so check the current GKE documentation, and use maintenance exclusions when you need a hard freeze rather than relying on the pause.

Merge the manifest migration before the control plane upgrade, since new API versions are generally served by the older version too. That ordering is what makes rollback possible.

## Rollback plan, written before starting

Control plane minor-version upgrades are generally not rolled back in place, so confirm the options in the current docs for your platform and plan for restoring workloads rather than the control plane. Before the upgrade, record:

- the GitOps commit SHA, or the tag of the manifests, last known good;
- Helm release revisions for every release (`helm history`), so [[helm-release-rollback]] is a known command;
- the old node pool, kept until the new one is verified;
- backup state for stateful workloads.

Rollback depends on which side of the control plane upgrade you are on:

- **Before the control plane upgrade**, reverting the migration commit is a valid rollback: the old cluster still serves the old API versions.
- **After the control plane upgrade**, never revert the API version change. The upgraded cluster no longer serves the removed versions, so a revert restores manifests it rejects (for example `batch/v1beta1` CronJobs after an upgrade to 1.25). Recover by restoring workload configuration (image, replicas, settings) on top of the migrated API versions, as a forward fix.
- **Helm rollback has the same trap.** Rolling back to a release revision whose stored manifest uses a removed API fails on the upgraded cluster. Check the target revision's API versions before you rely on `helm rollback`, and check the current Helm docs for how to handle releases that still reference removed APIs.

The migrated manifests must use API versions that both releases serve, so the same commit works before and after the upgrade. Check that before merging.

Keep detector output, each diff with its cited guide entry, validation results and the production approval as pipeline artifacts, and handle session logs per [[agent-session-transcript-handling]].

## Failure modes

- **Agent trusts its memory of removals.** It rewrites APIs that are still served, or misses ones removed in your target. Fix: target-version spec in context, citations required.
- **Raw template scan misses rendered APIs.** Fix: render with production values and target Capabilities.
- **kubent stale annotation leads to a needless or wrong rewrite.** Fix: check the live object and the repo first.
- **Clean manifests, failing upgrade.** A controller or CI job still calls a removed API. Fix: audit-log caller analysis.
- **Semantic change hidden in a mechanical bump.** Fix: forbidden-change list, per-resource diff review.
- **Validated against the current cluster's schemas.** The check passes and the target rejects. Fix: pin kubeconform to the target version.
- **Missing CRD schemas.** Custom resources are skipped silently. Fix: supply CRD schemas and fail on unknown kinds ([[crd-lifecycle-with-helm-and-argocd]]).
- **Agent loops on a failing fix.** Fix: stop conditions and a file-count cap.
- **Rollback assumed, never rehearsed.** Fix: record revisions and SHAs, rehearse on staging.
- **Post-upgrade revert to removed APIs.** Reverting the migration commit or rolling a Helm release back after the upgrade restores API versions the cluster no longer serves. Fix: post-upgrade recovery keeps the migrated API versions and rolls forward.

## Review checklist

- [ ] Target version is named, and the matching migration guide page is the spec.
- [ ] Pluto (or equivalent) ran on rendered Helm output and raw manifests, with exit status gating the pipeline.
- [ ] kubent findings were checked against live objects and the repository.
- [ ] Audit logs were reviewed for callers of removed APIs, and each is assigned an owner.
- [ ] Every agent change cites a guide entry and is a mechanical migration only.
- [ ] No selector, default or semantic field change slipped in.
- [ ] kubeconform ran against the target version, including CRD schemas.
- [ ] Server-side dry run passed on a target-version test cluster.
- [ ] Staging or canary soaked before production.
- [ ] Rollback inputs (commit SHA, Helm revisions, old node pool) are recorded.
- [ ] A human approved the production step.
- [ ] GKE auto-upgrade and maintenance exclusion settings were checked against the current docs.

## Related

- [[ai-assisted-ci-failure-triage]] for diagnosing pipeline failures during the migration.
- [[team-norms-for-ai-assisted-engineering]] for team expectations on agent-authored changes.

## Sources

- [Kubernetes Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) - per-release removed API versions and replacements, used as the agent's spec.
- [GKE deprecations](https://docs.cloud.google.com/kubernetes-engine/docs/deprecations) - GKE-specific deprecation notes, deprecation insights and the auto-upgrade pause behaviour.
- [CNCF: detecting and dealing with deprecated APIs](https://www.cncf.io/blog/2020/09/01/kubernetes-how-to-automatically-detect-and-deal-with-deprecated-apis-2/) - why to combine static and live detection (2020, tool advice is dated).
- [kube-no-trouble issue 276](https://github.com/doitintl/kube-no-trouble/issues/276) - the last-applied-configuration false positive.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
