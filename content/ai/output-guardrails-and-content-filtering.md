---
title: Output guardrails and content filtering
description: Design input and output guardrail layers for LLM applications, from deterministic validators to classifiers, with failure policy, latency budgets and safe logging.
type: pattern
tags:
  - ai
  - security
  - reliability
  - observability
created: 2026-11-01
modified: 2026-11-02
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
draft: false
---

This note covers how to layer guardrails around an LLM application: deterministic validators first, classifier filters second, PII and secret scanning at egress, a refusal taxonomy, a fail-open or fail-closed decision per check, a latency budget, logging that does not leak content, and an adversarial test set. It is for platform and application engineers who run an LLM feature in production. It does not cover input-side redaction ([[redacting-sensitive-data-before-llm-calls]]), injection through retrieved content ([[indirect-prompt-injection-in-documents]]), JSON schema enforcement in depth ([[validating-model-generated-json]], [[structured-output-contracts]]) or tool permissions ([[agent-tool-authorization-boundaries]]). Where a shared gateway enforces caller and model policy, these checks usually sit in or next to it ([[ai-gateway-architecture-and-policy]]).

## Layer from cheap to expensive

Order checks by cost and by how well you can explain a verdict:

1. **Deterministic validators.** Length limits, character-set and encoding checks, schema validation, allowlists for tool names and arguments, regexes for known secret formats. They are cheap, testable and auditable.
2. **Classifier filters.** Small models or hosted moderation endpoints for topics, abuse and policy categories. Run them only on traffic that survived step 1.
3. **Model-based judges.** The slowest and least predictable layer. Use for narrow questions on high-risk routes, and validate the judge itself ([[llm-as-judge-validation]]).

Treat model output as untrusted input to the next system. Validate it before any tool call, write or render, because improper output handling (LLM05:2025) is a named risk class in the OWASP list.[^owasp] A schema contract is the first output guardrail, not a nicety.

## Scan output for PII and secrets at egress

Redacting the prompt does not stop the model emitting a secret it saw in context or in a tool result. Scan responses at the point where they leave your boundary:

- Known key formats and private-key headers.
- High-entropy strings above a length threshold, with an allowlist for hashes and IDs you expect.
- Checksum-validated identifiers (payment card numbers, national IDs where applicable) rather than bare digit patterns.
- Classifier-based PII detection only after the deterministic detectors, for names and addresses they cannot see.

Redact or block at egress, and record which detector fired, not the matched text. Expect false positives from entropy checks and tune them against benign traffic.

## Separate three kinds of refusal

Give each outcome its own status, metric and user message:

| Outcome                  | Source                     | Typical handling                             |
| ------------------------ | -------------------------- | -------------------------------------------- |
| Provider refusal or stop | The model service declined | Surface a neutral message; do not auto-retry |
| Guardrail block          | Your own policy layer      | Return a policy error; never retry unchanged |
| Validator failure        | Schema or format check     | May retry once within a bounded budget       |

A policy block is not a transient error, so it must not enter the retry path in [[llm-retry-timeout-and-circuit-breaker-policy]]. Whether a client should rephrase and resend after a provider refusal is provider-specific; decide it per provider and test it.

## Choose fail-open or fail-closed per guardrail

Decide per check, not per service, and write it in the runbook:

- **Fail closed**, typically, for write actions, tool execution, and secret or PII egress. A timeout returns an explicit error, not an unscanned answer.
- **Fail open with logging and a degraded-mode metric** only for low-risk advisory filters, such as a tone check.

This is a recommended default tied to your risk assessment, not a standard ([[ai-system-risk-classification]]). Give on-call a documented bypass that is itself logged and time-limited, and rehearse it. Guardrail outages will happen.

## Budget latency

Give every guardrail a p95 budget and a hard timeout inside the request deadline, and run independent checks in parallel ([[timeouts-retries-load-shedding]]). Cheap validators should cost little compared with the model call; classifiers are where the budget goes. Measure rather than assume.

Streaming complicates output scanning. Pick one and document it: buffer the full response then scan; scan incrementally in windows and cut the stream on a hit; or scan after emit and accept that a violation may already have been shown. Secret egress usually justifies buffering ([[streaming-inference-latency-budgets]]).

A guardrail service on Kubernetes needs requests, so the scheduler reserves capacity for it, and a memory limit, so a leak cannot exhaust the node ([[kubernetes-resource-requests-and-limits]]). The values are placeholders to replace after load testing:

```yaml title="guardrail-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: output-guardrail
  namespace: ai-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: output-guardrail
  template:
    metadata:
      labels:
        app: output-guardrail
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: scanner
          image: registry.example.com/ai/output-guardrail:1.4.2
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
```

The memory limit is set and the CPU limit is left off deliberately, to avoid throttling latency-sensitive scans; Kubernetes enforces CPU limits by throttling, and a namespace LimitRange can apply a default limit when none is set. Adjust to your own policy. With a read-only root filesystem, mount an `emptyDir` for any scratch path the scanner writes to.

## Log decisions, not content

Emit the guardrail name and version, verdict, score bucket, latency, and a hash or length of the input and output, following your field conventions ([[structured-logging-conventions]]). Full prompt and response capture should be opt-in and gated; the OpenTelemetry GenAI conventions describe prompt, response and system-instruction content as sensitive, say instrumentations should not capture it by default, and give the content attributes an opt-in requirement level.[^otel] See [[llm-tracing-with-sensitive-data-controls]]. Never put the matched secret, the user ID or free text in a metric label.

Version policies and thresholds like code. A threshold change is a release with its own evaluation run and rollback path ([[llm-change-management-and-release-gates]]).

Monitor the guardrails as a service: block rate, fail-open rate, timeout rate, classifier version and per-tenant drift. A sudden drop in block rate is as alarming as a spike.

## Gate side-effecting tools

Treat tool annotations and descriptions from third-party servers as untrusted. The MCP specification says clients must consider tool annotations untrusted unless they come from trusted servers,[^mcp] that there should always be a human in the loop able to deny tool invocations, and that clients should prompt for confirmation on sensitive operations. The MUST covers annotations only; distrusting descriptions too is this note's advice, not the specification's wording. Approval gates for side-effecting tools belong in the stack ([[human-approval-state-machine]], [[third-party-mcp-server-vetting]]).

## Test with an adversarial set

Keep a versioned set in the repository and run it in CI ([[adversarial-robustness-evaluation]], [[prompt-injection-test-harness-for-ci-agents]]):

- Jailbreak templates, encoding tricks and language switches.
- Indirect injection in retrieved documents and tool outputs.
- PII in several formats, and secret-shaped strings that are not secrets.
- Benign traffic samples, so false positives are measured too.

Track bypass rate and false-positive rate separately. The runner below fails on any unexpected verdict:

```bash title="run-guardrail-cases.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

GUARDRAIL_URL="${GUARDRAIL_URL:?set GUARDRAIL_URL}"
CASES_FILE="${CASES_FILE:-tests/guardrails/cases.jsonl}"
failures=0

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  id=$(jq -r '.id' <<<"$line")
  want=$(jq -r '.expect' <<<"$line")
  got=$(jq -c '{text: .text}' <<<"$line" |
    curl -fsS --max-time 5 -H 'Content-Type: application/json' \
      -d @- "$GUARDRAIL_URL/check" | jq -r '.verdict')
  if [[ "$got" != "$want" ]]; then
    echo "FAIL ${id}: expected ${want}, got ${got}" >&2
    failures=$((failures + 1))
  fi
done <"$CASES_FILE"

echo "failures: ${failures}"
[[ "$failures" -eq 0 ]]
```

With `set -e`, a guardrail that is unreachable or returns an HTTP error stops the run with a non-zero exit, which also fails the job. The cases hold synthetic strings only; never copy real customer data or live credentials into the set. Run it on policy changes, not on every commit, with `GUARDRAIL_URL` set as a CI/CD variable pointing at a non-production instance:

```yaml title=".gitlab-ci.yml"
guardrail-adversarial:
  stage: test
  image: registry.example.com/ci/tools:2.1.0
  script:
    - ./run-guardrail-cases.sh
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - policies/guardrails/**/*
        - tests/guardrails/**/*
    - if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH"
      changes:
        - policies/guardrails/**/*
        - tests/guardrails/**/*
```

## Failure modes

- Only a model-based filter, so a prompt that fools the model also fools the guard.
- Prompt-side redaction with no egress scan.
- Policy blocks retried like timeouts, multiplying cost and exposure.
- Fail-open applied to the whole service after one noisy classifier.
- Scanning after emit on a route that can leak secrets.
- Logging the blocked content "for debugging", creating a store of the very data you filtered.
- A silent threshold change that halves the block rate and nobody notices.
- Test set that only holds attacks, so a filter that blocks everything looks perfect.
- Bypass left enabled after an incident.

## Review checklist

- [ ] Deterministic validators run before any classifier or judge.
- [ ] Model output is schema-validated before tool calls, writes and rendering.
- [ ] Egress scanning covers secrets and PII, with detectors named in the log.
- [ ] Provider refusal, guardrail block and validator failure have separate codes and metrics.
- [ ] Each guardrail has a documented fail-open or fail-closed choice.
- [ ] Each guardrail has a p95 budget and a hard timeout inside the request deadline.
- [ ] Streaming scan strategy is chosen and documented.
- [ ] Logs hold verdicts, versions and hashes, not content.
- [ ] Policies and thresholds are versioned with an evaluation run and rollback.
- [ ] The adversarial set runs in CI and reports bypass and false-positive rates.
- [ ] Block rate, fail-open rate and timeout rate are alerting.
- [ ] The on-call bypass is logged, time-limited and rehearsed.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the OWASP, MCP, OpenTelemetry GenAI, Kubernetes and GitLab statements in this note were checked against local copies of those sources.

### Sources checked

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): LLM05:2025 Improper Output Handling is about insufficient validation and sanitization of model output before it reaches downstream components; LLM02:2025 Sensitive Information Disclosure covers PII, financial data and credentials, and says system-prompt restrictions can be bypassed. Checked 2026-11-02 against the OWASP LLM repository commit 99f4395.
- [MCP specification, Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): clients MUST consider tool annotations untrusted unless they come from trusted servers; there SHOULD always be a human in the loop able to deny tool invocations; clients SHOULD prompt for confirmation on sensitive operations. The MUST applies to annotations only. Checked 2026-11-02 against the modelcontextprotocol repository commit d0e246e.
- [OpenTelemetry GenAI spans conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md): input, output and system-instruction content is sensitive; instrumentations SHOULD NOT capture it by default but SHOULD offer an opt-in; the content attributes carry the Opt-In requirement level and are in development status. Checked 2026-11-02 against the open-telemetry/semantic-conventions-genai repository commit 244465e. The published page at https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ is built from a different repository (open-telemetry/semantic-conventions) and was not checked.
- [Resource Management for Pods and Containers | Kubernetes](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): the scheduler checks the sum of requests against node capacity; CPU limits are enforced by throttling; a missing memory limit means no upper bound on memory use. Checked 2026-11-02 against the Kubernetes website repository commit 491f14e.
- [Limit Ranges | Kubernetes](https://kubernetes.io/docs/concepts/policy/limit-range/): a LimitRange admission controller applies default request and limit values. Checked 2026-11-02 against the kubernetes/website repository commit 491f14e.
- [Configure Service Accounts for Pods | Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/): `automountServiceAccountToken: false` disables token mounting, and the Pod spec takes precedence. Checked 2026-11-02 against the kubernetes/website repository commit 491f14e.
- [Configure a Security Context for a Pod or Container | Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): `readOnlyRootFilesystem` mounts the root filesystem read-only. Checked 2026-11-02 against the kubernetes/website repository commit 491f14e.
- [Pod Security Standards | Kubernetes](https://kubernetes.io/docs/concepts/security/pod-security-standards/): `runAsNonRoot`, `allowPrivilegeEscalation` and the `RuntimeDefault` seccomp profile are fields the standards address. Checked 2026-11-02 against the kubernetes/website repository commit 491f14e.
- [Volumes | Kubernetes](https://kubernetes.io/docs/concepts/storage/volumes/): an `emptyDir` volume starts empty and is shared by containers in the Pod. Checked 2026-11-02 against the kubernetes/website repository commit 491f14e.
- [CI/CD job rules | GitLab](https://docs.gitlab.com/ci/jobs/job_rules/) and [Predefined CI/CD variables | GitLab](https://docs.gitlab.com/ci/variables/predefined_variables/): `CI_PIPELINE_SOURCE == "merge_request_event"`, `CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` and `rules:changes` are documented rule forms. Checked 2026-11-02 against the GitLab docs commit d7b9a61.
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/): variables can be defined in the UI for a project, group or instance. Checked 2026-11-02 against the gitlabhq/gitlabhq docs commit d7b9a61.

### Not verified

- NIST AI 600-1 (listed in Sources) could not be read; no claim in the note depends on it beyond general framing.
- Latency budgets, thresholds and Kubernetes values in the examples are placeholders to measure, not documented figures.
- Layering order, fail-open and fail-closed defaults, egress scanning, refusal taxonomy, streaming scan options and the adversarial test set are engineering guidance, not documented claims.
- Shell and curl behaviour in the test runner script and the container image names in the examples were not checked.
- Nothing was run.

## Sources

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): risk taxonomy covering prompt injection, improper output handling and sensitive information disclosure.
- [NIST AI 600-1, Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence): risk-management framing for generative AI controls, testing and monitoring. Not read; see Evidence.
- [MCP specification, Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): tool annotations are untrusted unless from trusted servers; a human should be able to deny tool invocations; clients should confirm sensitive operations.
- [OpenTelemetry GenAI spans conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md): sensitive content attributes are opt-in and not captured by default. The published version at https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ was not checked.

[^owasp]: OWASP Top 10 for LLM Applications 2025, LLM05 Improper Output Handling; see the OWASP page in Sources.

[^otel]: Attribute names and stability vary by version; check the registry for the version you pin.

[^mcp]: The MUST covers annotations; the two SHOULDs cover tool invocations generally.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
