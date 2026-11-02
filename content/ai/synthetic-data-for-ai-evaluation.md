---
title: Synthetic data for AI evaluation
description: Generate and govern synthetic test data for LLM and RAG evaluation, covering drift from real traffic, leakage, review, privacy and versioning with golden sets.
type: pattern
tags:
  - ai
  - security
  - reliability
  - team-process
created: 2026-11-01
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note explains when synthetic test items are worth adding to an LLM or RAG evaluation set, and how to generate, label, review, store and version them so the scores stay trustworthy. It is for platform and DevOps engineers who own evaluation pipelines and the people who approve their data. It does not cover sampling real traffic ([[representative-evaluation-set-sampling]]), RAG set design in depth ([[rag-evaluation-dataset-design]]), the golden set lifecycle ([[golden-dataset-management-for-llms]]), the detail of leakage checks ([[eval-data-leakage-and-contamination]]) or annotation procedure ([[human-annotation-guidelines-for-ai-evals]]). Those are linked where they apply.

## When synthetic data helps

Use synthetic items to extend coverage, not to estimate production quality. They help when real traffic is unavailable (a new feature), too sensitive to use, or too thin on rare cases: injection attempts, long-tail phrasing, multi-tenant edge cases, empty or contradictory retrieval results. They do not replace a sample of real traffic, which stays the baseline for any quality claim.

Cost is a weak argument. Generation is cheap, but human review of the labels usually dominates the total, so budget for review before you budget for generation.

## Record the generator

Treat every synthetic set as a versioned artifact. Record the generator (model identifier and version, or the template if it is rule-based), the prompt, the seed, the sampling parameters and the digest of the seed material. Without these a score cannot be reproduced. Changing any of them produces a new set version, never an edit in place.

Label origin on every item with a `provenance` field with values such as `human`, `production-sampled` and `synthetic`. Dashboards that mix origins without labels overstate real-world quality, so report scores per provenance.

## Measure distribution drift

A synthetic set drifts from reality because the generator has its own style and blind spots, and because traffic changes as the product changes. Compare the synthetic set with a recent approved sample of production on query length, topic mix, language, tool-call frequency and retrieval hit rate. Re-run the comparison on a schedule and after major product changes.

Pick a drift statistic and a threshold as a team decision and write it down. Population stability index and divergence measures are common choices, but a cut-off such as 0.2 is a local convention, not a standard. Treat a breach as a reason to regenerate or reweight, and say so in the manifest.

Reduce generator bias by mixing generators or model families where feasible, and keep a small human-written seed set that the generator never sees. Use that set to check that scores on synthetic items track scores on human items.

## Keep tests and answers apart

Contamination runs in two directions. Generated test items can be copied into prompts, few-shot examples, fine-tuning data or retrieval indexes. The generator may also reproduce public benchmark text it has seen. Hash-check eval items against training and prompt corpora, keep expected answers out of any index the system under test can read, and give the generator no access to the production prompt set. Details are in [[eval-data-leakage-and-contamination]].

For RAG, a generated question is only a valid test if its source passage is recorded and the passage is still present in the corpus version under test. Re-validate when the corpus changes ([[knowledge-freshness-and-invalidation]]).

## Privacy: no real customer data without approval

Do not derive synthetic data from real customer records unless the data owner has approved it in writing. "Anonymized" prompts can still carry identifiers or reproduce source text, and a generator prompt is itself a copy of the data. The data classification rules allow Confidential data in non-production only without personal data (otherwise masked or synthetic), and never allow Restricted data there: use synthetic data or irreversibly masked extracts approved by the data owner ([[data-classification-and-handling-standard]]). Route any generator input derived from real text through the redaction gate used for model calls ([[redacting-sensitive-data-before-llm-calls]]).

Apply the same access rules to the generator's inputs as to the eval set: seed documents, schemas and personas. A seed corpus drawn from internal documents can leak confidential content into the output. Dispose of raw seed material on the same schedule as the source data it came from, and keep only the generator config and seed digest needed to reproduce a published score.

## Labelling and review

Expected answers written by a model are not ground truth. Require human review of a stated sample of every set version, record inter-annotator agreement ([[inter-annotator-agreement-and-adjudication]]) and send disagreements to adjudication. If a model judge scores the outputs, validate the judge against human labels first ([[llm-as-judge-validation]]). Items that fail review are marked rejected in the manifest rather than silently removed, so the rejection rate is visible and can be compared between generator versions.

## Version with the golden set

Keep one manifest for the golden set and the synthetic extension, so a score always names exactly which items produced it.

```yaml
# eval-sets/support-rag/manifest.yaml
set_version: 2026.11.1
golden:
  path: golden/support-rag.jsonl
  sha256: REPLACE_WITH_DIGEST # change: digest of the golden file
synthetic:
  path: synthetic/support-rag-2026.11.1.jsonl
  sha256: REPLACE_WITH_DIGEST # change: digest of the synthetic file
  generator:
    id: REPLACE_WITH_GENERATOR_ID # change: pinned model identifier or template name
    prompt_sha256: REPLACE_WITH_DIGEST # change: digest of the generator prompt
    seed: 1234
    params: { temperature: 0.7 }
  seed_corpus_sha256: REPLACE_WITH_DIGEST # change: digest of the seed documents
  data_owner_approval: REPLACE_WITH_TICKET # change: reference, required if any real text was used
  human_review: { sample_size: 100, agreement: REPLACE_WITH_VALUE } # change: record the measured value
splits:
  dev: 0.7
  test: 0.3
```

A small script keeps the digests honest. It fails on a missing file, on a mismatch, and on a path or digest that is missing from the manifest. It assumes the Go `yq` (v4 syntax); the Python `yq` wrapper prints JSON-quoted strings and would fail every comparison.

```bash
#!/usr/bin/env bash
# scripts/check-eval-manifest.sh - verify files match the manifest digests
set -Eeuo pipefail

manifest="${1:?usage: check-eval-manifest.sh MANIFEST}"
dir=$(dirname "$manifest")

# yq output is captured with a plain command substitution so a failure stops the script.
paths=$(yq '.golden.path, .synthetic.path' "$manifest")
digests=$(yq '.golden.sha256, .synthetic.sha256' "$manifest")

# yq prints "null" for a missing key, so reject null and empty lines, not only empty output.
if grep -qxE 'null|' <<<"$paths"$'\n'"$digests"; then
  echo "manifest has a missing path or digest" >&2
  exit 1
fi

paste -d' ' <(printf '%s\n' "$digests") <(printf '%s\n' "$paths") | while read -r want path; do
  got=$(sha256sum "$dir/$path" | cut -d' ' -f1)
  [[ "$got" == "$want" ]] || { echo "digest mismatch: $path" >&2; exit 1; }
done
echo "manifest OK"
```

Run it on merge requests that touch the sets, as below, and again as the first step of the job that publishes scores, so no result is attributed to an unverified set.

```yaml title=".gitlab-ci.yml"
eval-set-manifest:
  stage: test
  image: registry.example.com/ci/toolbox@sha256:REPLACE_WITH_DIGEST # change: an image with bash, yq and coreutils, pinned by digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - eval-sets/**/*
  script:
    - scripts/check-eval-manifest.sh eval-sets/support-rag/manifest.yaml
```

If a scheduled job produces drift reports or regenerates sets inside a cluster, run it with the workload baseline ([[kubernetes-workload-baseline-standard]]) and give it no network path to production data.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: eval-set-drift-report
spec:
  schedule: "17 3 * * 1"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 1800
      template:
        spec:
          restartPolicy: Never
          automountServiceAccountToken: false
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001 # change: the numeric USER of your image
            runAsGroup: 10001
            seccompProfile:
              type: RuntimeDefault
          containers:
            - name: drift
              image: registry.example.com/eval/drift@sha256:REPLACE_WITH_DIGEST # change: your image, pinned by digest
              resources:
                requests: { cpu: 250m, memory: 512Mi }
                limits: { cpu: "1", memory: 1Gi }
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: ["ALL"]
              volumeMounts:
                - name: tmp
                  mountPath: /tmp
          volumes:
            - name: tmp
              emptyDir: { sizeLimit: 1Gi }
```

If you emit evaluation results as telemetry, the OpenTelemetry GenAI conventions define a `gen_ai.evaluation.result` event with `gen_ai.evaluation.name`, `gen_ai.evaluation.score.value`, `gen_ai.evaluation.score.label` and `gen_ai.evaluation.explanation` attributes. They are at development stability, so check the current names before depending on them. The conventions have no attribute for the eval-set version, so add your own (for example the manifest `set_version`) to every run.

## Failure modes

- A synthetic set is used to report production quality, and the score is higher than users experience.
- The generator drifts from traffic and nobody re-measures.
- Generator and system under test share a model family, so the model grades its own style.
- Expected answers come from the generator and are never reviewed.
- Test items or answers enter prompts, fine-tuning data or the retrieval index.
- Real customer text seeds the generator without the data owner's approval.
- The generator config is edited in place and old scores can no longer be reproduced.
- Synthetic and human items are averaged together with no provenance label.
- Rejected items are quietly dropped, hiding a rising reject rate.

## Review checklist

- [ ] The set extends coverage and is not the only basis for a production quality claim.
- [ ] Generator, prompt, seed and parameters are recorded, and changes create a new version.
- [ ] Every item has a provenance label and scores are reported per provenance.
- [ ] Drift against an approved production sample is measured on a schedule, with a team-chosen threshold.
- [ ] A human-written seed set exists that the generator never sees.
- [ ] Items are checked for overlap with training, prompt and retrieval corpora.
- [ ] No real customer data was used, or the data owner's written approval is referenced.
- [ ] Seed material has the same access rules and retention as its source.
- [ ] A stated sample is human-reviewed, with agreement recorded and rejections counted.
- [ ] One manifest ties the golden set, the synthetic set and their digests together.
- [ ] CI verifies the manifest before scores are published.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. The review covered the OpenTelemetry GenAI evaluation event, the Kubernetes and GitLab CI fields used in the samples, the OWASP LLM risks cited, and the internal data classification rules.

### Sources checked

- [Semantic conventions for generative AI events | OpenTelemetry](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-events.md): the `gen_ai.evaluation.result` event; its `gen_ai.evaluation.name` (required), `gen_ai.evaluation.score.value`, `gen_ai.evaluation.score.label` (conditionally required) and `gen_ai.evaluation.explanation` (recommended) attributes; development stability of the event and attributes; no attribute for an eval-set version. Checked 2026-11-02 against semantic-conventions-genai commit 244465e (docs/gen-ai/gen-ai-events.md lines 23-46). The opentelemetry.io page of the same name is built from open-telemetry/semantic-conventions (pinned v1.44.0), not from this repository, so it was not checked.
- [CronJob | Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): `schedule` (cron syntax) and `concurrencyPolicy` with the `Forbid` value. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Jobs | Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/job/): `backoffLimit`, `activeDeadlineSeconds` and `restartPolicy: Never` in a Job pod template. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Pod Security Standards | Kubernetes](https://kubernetes.io/docs/concepts/security/pod-security-standards/): `runAsNonRoot`, `allowPrivilegeEscalation`, `seccompProfile` `RuntimeDefault`, and dropping `ALL` capabilities as baseline or restricted-profile settings. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Configure a Security Context for a Pod or Container | Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): `runAsUser`, `runAsGroup`, `seccompProfile` and `readOnlyRootFilesystem`. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Configure Service Accounts for Pods | Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/): `automountServiceAccountToken: false`. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Volumes | Kubernetes](https://kubernetes.io/docs/concepts/storage/volumes/): `emptyDir` volumes with `sizeLimit`. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Resource Management for Pods and Containers | Kubernetes](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): per-container resource requests and limits. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Job control with rules | GitLab Docs](https://docs.gitlab.com/ci/jobs/job_rules/): `rules:if` with `$CI_PIPELINE_SOURCE == "merge_request_event"` and `rules:changes` given as a list of paths, including recursive `**/*` matching. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [Predefined CI/CD variables | GitLab Docs](https://docs.gitlab.com/ci/variables/predefined_variables/): `CI_PIPELINE_SOURCE`. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM02 Sensitive Information Disclosure (PII and confidential business data can leak through model use; sanitise data) and LLM04 Data and Model Poisoning (training, fine-tuning and embedding data can be manipulated). Checked 2026-11-02 against owasp-llm commit 99f4395.
- Internal note [[data-classification-and-handling-standard]]: Confidential data is allowed in non-production only without personal data, otherwise masked or synthetic; Restricted data is never copied to non-production, and synthetic data or irreversibly masked extracts approved by the data owner are used instead. Checked 2026-11-02 against the repository copy.

### Not verified

- The NIST AI RMF and NIST AI 600-1 pages were not reachable, so what they say about evaluation and data provenance is unchecked.
- The OWASP pages were read only for the two risks above; they do not mention synthetic evaluation data, so applying them to eval sets is this note's reasoning.
- The Go `yq` v4 behaviour the digest script relies on (plain string output, `null` for a missing key) was not checked against the yq documentation, and neither was the claim that the Python `yq` wrapper prints JSON-quoted strings. The script was not run with any `yq`.
- GitLab `rules:changes` glob syntax beyond recursive `**/*` matching, and the YAML keyword reference (`ci/yaml`) were not in the local docs.
- Population stability index, the 0.2 cut-off, review sample sizes and the `provenance` values are engineering guidance or local convention, not standards. The OpenTelemetry attributes are at development stability and may be renamed.
- What your model provider's contract says about retention and reuse of generation prompts ([[model-data-use-contract-review]]) depends on your contract.
- General evaluation-hygiene advice (generator bias, contamination, human review, versioning) is engineering guidance. No cost saving is claimed; measure your own.
- Nothing was run: the manifest, CI job and CronJob were not executed.

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) - governance framing for measurement, documentation and risk owners.
- [NIST AI 600-1, Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) - expectations for evaluation and data provenance in generative AI; check current content.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) - sensitive information disclosure and data poisoning risks for eval and training data; check current numbering.
- [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-events.md) - the evaluation result event and its attributes, at development stability.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
