---
title: Choosing prompting, RAG, tool use or fine-tuning
description: A decision guide for platform teams on which lever fixes an LLM feature problem, with cost, freshness and ops trade-offs and an eval-set test before committing.
type: guide
tags:
  - ai
  - cost
  - reliability
  - team-process
created: 2026-11-01
modified: 2026-11-01
draft: false
---

This note helps a platform team decide whether a failing LLM feature needs a prompt change, retrieval (RAG), tool use or fine-tuning, and how to test that choice with an eval set before committing. It is for engineers who run or consume LLM features and own their cost, release and operations. It does not cover building the eval set in detail ([[rag-evaluation-dataset-design]]), prompt template mechanics ([[prompt-templates-and-versioning]]), freshness limits ([[knowledge-freshness-and-invalidation]]), tool server hardening ([[tool-calling-contracts-and-schemas]]) or rollout gates ([[llm-change-management-and-release-gates]]); each is linked where it applies. It is not model research and makes no accuracy claims.

> [!note] Not verified
> The external sources below were not fetched in this session; the MCP tools specification, the OpenTelemetry GenAI attribute names and the serving documentation were read from local checkouts only, and the NIST and OWASP pages were not read. Before use, check: the current wording of the tool specification revision you implement, whether the OpenTelemetry GenAI attributes still carry the same names (they were marked Development), the pricing and hosting terms of your own provider or serving stack, and anything specific to managed cloud services, which this note does not verify. No quantitative accuracy or cost figure here comes from a source; measure your own.

## Classify the failure first

Choosing a lever before naming the failure is the most common error. Read a sample of bad outputs and sort each into one class:

| Symptom                                                             | Likely class        | First lever                                         |
| ------------------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| Wrong tone, format, ordering or missing steps                       | Instruction problem | Prompt change, then [[structured-output-contracts]] |
| Answer is wrong because the fact is missing or old                  | Knowledge problem   | Retrieval                                           |
| Answer needs live state or must cause an action                     | Capability problem  | Tool use                                            |
| Behaviour or format drifts across inputs despite clear instructions | Consistency problem | Fine-tuning, last                                   |

Mixed cases exist, so label each sample with one primary class and count them; the counts tell you which lever to try first.

## Start with the cheapest reversible lever

Try levers in this order: prompt, structured output, retrieval or tools, fine-tuning. A prompt change ships in minutes and rolls back with a config revert. Fine-tuning creates a model artifact with its own lineage, evaluation, hosting cost and retirement date. Treat every prompt change as a release: pin the template revision, parameters and model version together ([[prompt-templates-and-versioning]], [[model-version-pinning-and-upgrade-evals]]).

A prompt change can fix one case and regress others, so "it is only a prompt" is not a reason to skip the eval set. This is a process recommendation, not a claim about any model.

## What each lever buys and costs

| Lever       | Fixes                                  | Does not fix                               | What you now operate                               |
| ----------- | -------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Prompt      | Format, tone, task framing             | Missing or stale facts                     | Template versions, regression set                  |
| Retrieval   | Knowledge freshness and coverage       | Weak reasoning, poor instruction following | Ingestion, embeddings, index, ACL filters          |
| Tool use    | Live state, actions, exact computation | Judgement about whether to act             | Tool servers, authorization, rate limits           |
| Fine-tuning | Consistent behaviour and format        | New facts that must change quickly         | Training data, eval split, model artifact, hosting |

### Retrieval

Retrieval fixes freshness, not reasoning. How stale an answer can be is set by the ingestion and invalidation pipeline, so the staleness limit belongs to the source-authority policy, not to the model ([[knowledge-freshness-and-invalidation]], [[retrieval-cache-invalidation]]).

RAG adds failure surfaces: ingestion jobs, embedding model versions, index capacity and access control. Changing the embedding model is a re-index ([[embedding-model-migration]], [[vector-index-capacity-and-lifecycle]]). Retrieved text is untrusted input and a prompt injection path ([[untrusted-content-in-retrieval-pipelines]]), and results must respect the caller's permissions ([[metadata-filtering-and-acl-aware-retrieval]]). Retrieval reduces unsupported answers only when recall is high and the model uses the evidence, so measure groundedness separately ([[groundedness-and-faithfulness-evaluation]]).

### Tool use

A tool gives the model an action, which moves the problem to authorization. The server must validate inputs, enforce access, rate-limit and sanitize outputs whatever the model sends; the MCP tools specification states these as requirements for servers and recommends a human in the loop for sensitive calls. Treat that as a floor, not full coverage of tool risk ([[tool-calling-contracts-and-schemas]], [[agent-tool-authorization-boundaries]]).

### Fine-tuning

Use fine-tuning for behaviour and format consistency, not for facts. A fact trained into weights is slow to correct and hard to audit; keep facts in retrieval or tools so they change without retraining. The vLLM tool calling documentation lists at least one small function-calling model as designed to be fine-tuned for a specific function-calling task; that is an example of tuning for tool behaviour, not for knowledge.

Fine-tuning data is a governance decision: record provenance and licensing, review for personal data, and freeze an eval split that never enters training ([[eval-data-leakage-and-contamination]], [[golden-dataset-management-for-llms]]). A self-hosted or adapter model also needs inventory, supply-chain checks and capacity planning ([[open-weight-model-risk-assessment]], [[model-artifacts-in-artifactory]]).

## Cost and latency

Do not assume fine-tuning is always dearer than RAG, or the reverse. The result depends on traffic, prompt length and whether a smaller tuned model can replace a larger one. Retrieval adds an embedding call, a vector query and more prompt tokens to every request that retrieves. Fine-tuning adds training cost plus hosting for a custom or adapter model. Measure cost and p95 latency per request before and after, on the same traffic mix ([[per-request-cost-estimation]], [[llm-api-cost-control]]).

## Test the decision with an eval set

Do not decide from a demo. Build a versioned set of representative cases with expected outcomes ([[representative-evaluation-set-sampling]], [[rag-evaluation-dataset-design]]), then:

1. Freeze the set, the model version and the scoring rule before trying any lever.
2. Score the baseline. Record quality per slice, schema failures, cost and latency.
3. Score each candidate on the same set and the same model version.
4. For retrieval, report recall and groundedness separately from answer quality ([[retrieval-evaluation-metrics-and-thresholds]]).
5. For tools, score tool choice and arguments ([[tool-call-accuracy-and-argument-evaluation]]).
6. Set a minimum on high-risk slices, not only on the average.
7. Move the winner to a canary or shadow run with rollback thresholds ([[shadow-and-canary-evaluation-for-models]]).

Run the check in CI so a change cannot merge without a result. This sketch assumes your own `scripts/run-evals.sh` prints one JSON line with a numeric `pass_rate` and exits non-zero on error; a missing or non-numeric value fails the gate.

```bash title="scripts/gate-eval.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

CANDIDATE="${1:?usage: gate-eval.sh <candidate-name>}"
MIN_PASS_RATE="0.90" # example threshold; set your own per slice
EVAL_SET="evals/v3.jsonl"

result="$(./scripts/run-evals.sh --set "${EVAL_SET}" --candidate "${CANDIDATE}")"
# -e plus "numbers" fails the gate if pass_rate is missing or not a number
rate="$(jq -er '.pass_rate | numbers' <<<"${result}")"

if awk -v r="${rate}" -v m="${MIN_PASS_RATE}" 'BEGIN { exit !(r < m) }'; then
  echo "candidate ${CANDIDATE} pass_rate ${rate} is below ${MIN_PASS_RATE}" >&2
  exit 1
fi
echo "candidate ${CANDIDATE} pass_rate ${rate}"
```

```yaml title=".gitlab-ci.yml"
eval-gate:
  stage: test
  image: registry.example.com/platform/eval-runner:1.4.0
  script:
    - ./scripts/gate-eval.sh "$CI_COMMIT_SHORT_SHA"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - prompts/**/*
        - evals/**/*
        - retrieval/**/*
```

If the retrieval or tool path runs as a service, give it ordinary workload limits and a restricted security context ([[kubernetes-resource-requests-and-limits]]):

```yaml title="retrieval-api-deployment.yaml (container excerpt)"
containers:
  - name: retrieval-api
    image: registry.example.com/ai/retrieval-api@sha256:0000000000000000000000000000000000000000000000000000000000000000
    resources:
      requests: { cpu: 500m, memory: 1Gi }
      limits: { memory: 1Gi }
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
      seccompProfile:
        type: RuntimeDefault
```

The digest is a placeholder; deploy by real digest as the platform standard requires.

## Instrument the chosen path

Record retrieval and tool steps in traces so you can see which lever misbehaves. The OpenTelemetry GenAI conventions define attributes such as `gen_ai.retrieval.top_k`, `gen_ai.tool.name` and `gen_ai.evaluation.score.value`. They were marked Development in the checked registry, so pin the convention version and expect renames. Keep prompt and retrieved text out of traces unless you have a data-handling decision ([[llm-observability-tracing-and-slos]], [[llm-tracing-with-sensitive-data-controls]]).

## Failure modes

- Choosing fine-tuning to inject facts, then being unable to correct or audit them.
- Adding RAG to fix a format problem, which adds an index to operate and fixes nothing.
- Judging by a demo or a handful of examples, then regressing other slices.
- Tuning on data that includes the eval set, so the comparison is invalid.
- Reporting only answer quality, hiding poor recall or low groundedness.
- Exposing a tool without server-side authorization because "the prompt forbids it".
- Changing the embedding model or index without a re-index and re-evaluation.
- Comparing candidates on different model versions or different eval sets.
- Ignoring per-request cost, so a working fix is unaffordable at real traffic.
- Treating retrieved text as trusted instructions.

## Review checklist

- [ ] Failure samples are labelled by class and counted.
- [ ] The cheapest reversible lever was tried and its result recorded.
- [ ] A versioned eval set, model version and scoring rule are frozen before comparison.
- [ ] Retrieval recall and groundedness are reported apart from answer quality.
- [ ] Tool servers validate input, enforce access and rate-limit independently of the prompt.
- [ ] Fine-tuning data has provenance, licensing and privacy review, and an untouched eval split.
- [ ] Per-request cost and p95 latency are measured before and after.
- [ ] High-risk slices have their own minimum criteria.
- [ ] A canary or shadow run has rollback thresholds set in advance.
- [ ] Owners, freshness limits and retirement plans are recorded for each new component.

## Sources

- [Model Context Protocol, tools specification (revision 2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): servers must validate inputs, rate-limit and sanitize outputs; clients should keep a human in the loop for sensitive calls.
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/): retrieval, tool and evaluation attribute names and their Development stability; URL inferred from the checkout layout.
- [vLLM tool calling documentation](https://docs.vllm.ai/en/latest/features/tool_calling/): one listed function-calling model is designed to be fine-tuned for a specific function-calling task; URL inferred from the checkout layout.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): risk framing for choosing and measuring a system design.
- [NIST AI 600-1, Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence): generative-AI risks such as confabulation and data privacy for the eval plan.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): prompt injection and excessive agency in retrieved content and tool use.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
