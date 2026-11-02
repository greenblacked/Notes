---
title: Postmortems for AI-involved incidents
description: Run blameless postmortems when an AI assistant or agent contributed to an incident, with evidence capture, control-focused actions and regression cases.
type: pattern
tags:
  - ai
  - incident-management
  - reliability
  - team-process
created: 2026-11-01
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note covers how to run a blameless postmortem when an AI assistant, agent or model contributed to an incident: what evidence to preserve, how to separate model behaviour from missing controls, which action items are acceptable, and how to turn the failure into a regression case. It is for platform engineers, on-call leads and reviewers who own postmortems. It extends the base process in [[blameless-postmortems]] and does not replace it. It does not cover live response or using an assistant to draft the postmortem ([[ai-assisted-incident-response]], [[runaway-or-compromised-ai-agent-response]]), forensic chain of custody ([[ai-agent-security-incident-evidence]]) or the upgrade process itself ([[regression-testing-for-model-upgrades]]).

> [!note] Scope of review
> No procedure here was run. See the Evidence section for what was checked against primary sources and what was not.

## Treat the AI as a contributing factor

Use the same framing as any blameless review: the question is what the surrounding system allowed, not who or what to blame. A model that produced a wrong command is a contributing factor. The root of the incident is usually the path that let the command run: a credential that was too broad, no dry run, no approval step, no rollback. Write the timeline so that each model action sits next to the control that did or did not intercept it.

Keep two columns in the findings table.

| Model behaviour                         | Missing or weak control                                |
| --------------------------------------- | ------------------------------------------------------ |
| Invented a flag or a package name       | No allowlist or dry run before execution               |
| Ignored an instruction in the prompt    | Instruction was the only barrier; no permission rule   |
| Followed text from a retrieved document | Untrusted content could reach a tool with write access |
| Acted on stale context                  | No freshness check before a destructive step           |

Model behaviour is probabilistic, so every row in the left column still needs a control on the right. A finding that ends at "the model was wrong" is incomplete.

## Preserve the evidence first

Start collection before the next rotation, deploy or session cleanup removes it. For each incident, capture:

- System instructions and the full prompt as sent, plus the prompt template revision ([[prompt-templates-and-versioning]]).
- Retrieved context with the source document versions or index revision.
- The requested model identifier and the identifier the response reports. A difference is a lead to investigate a provider-side routing or version change; it does not prove one. The in-development OpenTelemetry GenAI conventions keep these as separate attributes (`gen_ai.request.model`, `gen_ai.response.model`).
- Sampling settings and tool definitions as they were at the time.
- Every tool call with arguments, result, call identifier and the identity it ran under.
- The human approval, edit or denial, with timestamp.
- The change records for the three things that can alter behaviour without a code change: model version, prompt template and retrieval index. Show all three on the timeline, not only the latest.

Prompt and completion capture is opt-in in those conventions, and may be left off because the content can be sensitive. If content was not captured, say so in the postmortem and rely on the application's audit store. Do not reconstruct a transcript from memory. See [[llm-tracing-with-sensitive-data-controls]] for what to capture and redact.

Store the evidence in a restricted location with its own access control and retention period. The postmortem links to it and quotes only what a reader needs. A minimal snapshot script for the collecting engineer:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

incident="${1:?usage: snapshot.sh INC-1234 /path/to/export}"
export_dir="${2:?missing export directory}"
dest="/secure/evidence/${incident}"

mkdir -p "${dest}"
chmod 700 "${dest}"

# Copy exported traces and the agent audit log; do not edit them.
cp -p -- "${export_dir}"/*.jsonl "${dest}/"

# Record hashes so later readers can detect changes.
( cd "${dest}" && sha256sum -- *.jsonl > SHA256SUMS )
```

Adapt the paths to your evidence store and check that the destination is access-controlled and retention-limited before using it.

## Check the authorization path

For each tool call that mattered, answer three questions. Whose authority did it run under: the user's delegated authority or a shared service account? Was authorization checked per call, or only once against what the model said it intended? Was a human able to deny the call, and was that path visible and used? The MCP tools specification says there SHOULD always be a human in the loop with the ability to deny tool invocations; that is a recommendation for MCP applications, not a rule that covers every agent product. See [[agent-tool-authorization-boundaries]] and [[human-approval-state-machine]].

## Write action items that change controls

Every action item names the control it changes, an owner and a due date. Accepted control types are a gate, a scope reduction, a rate or size limit, an alert, a rollback path, or a dry-run requirement. A prompt edit on its own is not accepted. If a prompt change is proposed, pair it with a control and a test that would fail without it.

For example, if an agent ran with broad rights in a cluster, the action item is a narrower runtime, not a firmer sentence in the prompt:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: agent-runner
  namespace: agents
spec:
  serviceAccountName: agent-readonly
  automountServiceAccountToken: true
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: agent
      image: registry.example.com/agents/runner@sha256:REPLACE_WITH_DIGEST
      resources:
        requests:
          cpu: 250m
          memory: 256Mi
        limits:
          cpu: "1"
          memory: 512Mi
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
```

Pair it with RBAC that grants only read verbs ([[kubernetes-rbac-for-ai-agents]]), and keep write actions behind an approval state. The manifest is an illustration; the image, namespace and service account names are placeholders.

Also decide, and record, whether the tool stays approved for that workflow, with the criteria used. The postmortem should not silently ban or silently widen tool use. Route changes to models, templates or retrieval through [[llm-change-management-and-release-gates]].

## Turn the failure into a regression case

Before closing the postmortem, add the failure to the evaluation set. A useful case has the exact input (redacted as needed), the expected safe behaviour, the tool calls that must not occur, and the pinned model version it was observed on, so that later upgrades are tested against it ([[model-version-pinning-and-upgrade-evals]]). Link the case identifier in the postmortem.

Run the cases in CI on changes to a prompt template, model pin or retrieval index. A GitLab job using `rules:` with `changes:compare_to`, so a multi-commit push is diffed against the default branch instead of only the previous commit:

```yaml
agent-regression:
  stage: test
  image: python:3.12-slim
  script:
    - pip install -r evals/requirements.txt
    - python evals/run.py --suite incident-regressions --fail-on-forbidden-tool-call
  rules:
    - if: $CI_COMMIT_BRANCH
      changes:
        compare_to: "refs/heads/main"
        paths:
          - prompts/**/*
          - config/model-pins.yaml
          - retrieval-index/**/*
          - evals/incident-regressions/**/*
```

The job name, paths (including the `retrieval-index/` path) and flags above are examples for a harness you own. Without `compare_to`, `changes:` on a branch pipeline diffs only against the previous commit, and it always matches on a new branch or in a scheduled pipeline. The point is that the incident cases run automatically and a forbidden tool call fails the pipeline.

## Failure modes

- **Prompt-only fix.** The action item reads "tell the agent not to do this". The same failure returns on a model or template change.
- **Blaming the model.** The report stops at the wrong output and never asks why nothing stopped it.
- **Blaming the person.** The engineer who approved the action is named as the cause. Review why the approval screen made the risk hard to see.
- **Missing evidence.** Content capture was off, logs rotated, or the model identifier was recorded only as an alias, so the timeline cannot be rebuilt.
- **Evidence in the document.** Full prompts with secrets or personal data are pasted into a widely readable postmortem.
- **Unexamined change records.** A model, template or index change is not on the timeline, so the real trigger is missed.
- **No regression case.** The incident is closed with no test, so the next upgrade repeats it.
- **Silent policy change.** The tool is banned or widened without a recorded decision.

## Review checklist

- [ ] The postmortem follows [[blameless-postmortems]] and names no individual as the cause.
- [ ] Prompt, context, template revision, tool definitions and sampling settings were preserved.
- [ ] Requested and served model identifiers are both recorded, and any difference is explained or flagged.
- [ ] Every relevant tool call lists arguments, result and the identity it ran under.
- [ ] Missing capture is stated explicitly, with no reconstructed transcript.
- [ ] Evidence is stored with access control and retention limits, not pasted into the document.
- [ ] Findings are split into model behaviour and missing controls, and each behaviour has a control.
- [ ] The timeline includes model, prompt-template and retrieval-index changes.
- [ ] Each action item names a control, an owner and a date, and none is a prompt edit alone.
- [ ] A regression case with a pinned model version was added and runs in CI.
- [ ] The decision on whether the tool stays approved is recorded with criteria.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the MCP, OpenTelemetry GenAI, OWASP, Kubernetes and GitLab statements and snippets in this note.

### Sources checked

- [MCP specification: tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): the sentence that there SHOULD always be a human in the loop with the ability to deny tool invocations, present in the 2025-06-18, 2025-11-25 and 2026-07-28 revisions. Checked 2026-11-02 against modelcontextprotocol/modelcontextprotocol commit d0e246e.
- [OpenTelemetry GenAI client inference conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/client-inference.md): `gen_ai.request.model` and `gen_ai.response.model` are separate attributes; the attributes are in Development status; `gen_ai.output.messages`, `gen_ai.system_instructions` and `gen_ai.tool.definitions` are Opt-In and flagged as possibly sensitive. Checked 2026-11-02 against open-telemetry/semantic-conventions-genai commit 244465e.
- [OpenTelemetry GenAI span conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md): content capture (instructions, prompts, completions) is gated by an explicit user opt-in. Checked 2026-11-02 against open-telemetry/semantic-conventions-genai commit 244465e.
- [OWASP Top 10 for LLM Applications 2025: LLM06 Excessive Agency](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/99f4395/2_0_vulns/LLM06_ExcessiveAgency.md): excessive agency as the risk of damaging actions from unexpected or manipulated model output, and human approval of high-impact actions as a mitigation. Checked 2026-11-02 against OWASP/www-project-top-10-for-large-language-model-applications commit 99f4395.
- [Pod Security Standards | Kubernetes](https://kubernetes.io/docs/concepts/security/pod-security-standards/): `runAsNonRoot`, `allowPrivilegeEscalation` and dropping `ALL` capabilities as restricted-profile controls. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Configure a Security Context for a Pod or Container | Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): `seccompProfile` field and `readOnlyRootFilesystem`. Checked 2026-11-02, commit 491f14e.
- [Configure Service Accounts for Pods | Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/): `serviceAccountName` and `automountServiceAccountToken` fields. Checked 2026-11-02, commit 491f14e.
- [Using RBAC Authorization | Kubernetes](https://kubernetes.io/docs/reference/access-authn-authz/rbac/): least-privilege and read-only roles. Checked 2026-11-02, commit 491f14e.
- [CI/CD job rules | GitLab](https://docs.gitlab.com/ci/jobs/job_rules/): `rules:` with `if:` on `$CI_PIPELINE_SOURCE == "schedule"` and `changes:` path lists and `changes:compare_to`. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [Troubleshooting CI/CD jobs | GitLab](https://docs.gitlab.com/ci/jobs/job_troubleshooting/): without merge request pipelines, `changes` diffs against the previous commit, and always evaluates true for a new branch and in scheduled pipelines. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.

### Not verified

- The blameless postmortem framing (SRE book) and the NIST AI Risk Management Framework: not reachable, so the Sources entries are general references only.
- Whether a provider-side model routing change explains a request/response model mismatch: engineering guidance.
- The action-item rules, evidence list, regression-case advice, the snapshot script and the checklist are engineering guidance, not documented claims.
- The pod manifest uses placeholder names and a placeholder digest; the GitLab job and eval harness flags are examples and were not run.
- Current wording of newer MCP revisions and the OpenTelemetry attribute status may differ from the local copies.
- Nothing was run.

## Sources

- [Site Reliability Engineering book: postmortem culture](https://sre.google/sre-book/postmortem-culture/) for the blameless framing. Not read; see Not verified.
- [MCP specification: tools (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) for the human-in-the-loop SHOULD on tool invocation.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) for the governance, measurement and monitoring framing. Not read; see Not verified.
- [OWASP Top 10 for LLM Applications 2025: LLM06 Excessive Agency](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/99f4395/2_0_vulns/LLM06_ExcessiveAgency.md) for the excessive-agency framing behind the authorization checks.
- [OpenTelemetry GenAI client inference conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/client-inference.md) and [span conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md) for the request and response model attributes and opt-in content capture (Development status).

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
