---
title: AI-assisted security findings triage
description: Use an LLM to cluster, contextualise and draft decisions on scanner findings while humans own risk acceptance and nothing is suppressed automatically.
type: pattern
tags:
  - ai
  - security
  - supply-chain
  - audit
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers using an LLM to help triage findings from SAST, SonarQube, dependency and container scanners (for example Xray or Trivy) and cloud posture tools: deduplication, reachability context, exploitability reasoning backed by evidence, and VEX statements. It is for platform and security-minded DevOps engineers who own the pipelines that produce these findings. It does not cover choosing scanners (see [[jfrog-xray-vs-trivy-vs-grype]] and [[sonarqube-vs-semgrep-vs-codeql]]), remediation SLAs ([[vulnerability-management-slas]]), or automated upgrade PRs ([[agent-assisted-dependency-upgrades]]). The rule that shapes everything below: the model proposes, a named human decides, and the model never suppresses a finding on its own.

> [!note] Not verified
> The sources below were found via search, but several pages could not be fetched on 2026-10-27 and were not read in full. Before relying on this note, check: the OpenVEX status and justification labels against the current spec, scanner ignore-file syntax and expiry support for the version you run, vendor reachability and VEX features, GitLab vulnerability policy limits and tier requirements, and SonarQube edition-specific behaviour. Products are examples only; check the current docs.

## Division of labour

Keep three layers separate, because mixing them is how thin evidence ends up as a "closed" finding.

| Layer               | Owner                | Examples                                                             |
| ------------------- | -------------------- | -------------------------------------------------------------------- |
| Facts               | Scanner              | CVE or rule ID, package, version, scanner severity, fix availability |
| Hypotheses          | Model                | "likely not reachable", "likely test code", cluster summaries        |
| Gate and acceptance | CI policy and humans | Pipeline pass or fail, risk acceptance, expiry, suppression          |

The same split appears in [[llm-assisted-terraform-plan-review]]: deterministic gates first, advisory model review after, human approval last. Gates stay in CI and admission policy. Triage output may change priority and proposed status, never a gate result.

## Deduplicate before the model sees anything

The same CVE appears per image layer, per package path and per scanner. Collapse these in code, not in the prompt:

- Build a key from scanner, rule or CVE ID, package URL, artifact digest and, for SAST, file and line range.
- Group by key, keep every raw occurrence as a reference, and hand the model one record per cluster.
- Cross-scanner merges (the same CVE from two tools) use CVE ID plus PURL; keep both scanner severities visible and do not average them.

A small deterministic step is enough:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Collapse a normalised findings list into clusters keyed on CVE + package + digest.
jq -S '
  group_by([.id, .purl, .digest])
  | map({
      id: .[0].id, purl: .[0].purl, digest: .[0].digest,
      scanners: (map(.scanner) | unique),
      severity_by_scanner: (map({(.scanner): .severity}) | add),
      fixed_in: (map(.fixed_in // empty) | unique),
      occurrences: length,
      locations: (map(.location) | unique)
    })
' normalised-findings.json > clusters.json
```

Feeding raw scanner dumps to a model wastes context, invites it to double count, and increases the chance of leaking secrets embedded in paths or environment values.

## Add reachability context from tools first

Reachability evidence comes in two grades. Tool-produced evidence (a call-graph analyser from the scanner vendor or language tooling, the final image's package manifest, an SBOM) is deterministic input. A model reading imports and guessing is commentary. Feed the first in as data and ask the model to reason about it, not replace it.

Useful context to attach per cluster, each as a bounded excerpt with its source path:

- Whether the package is present in the final image or only in a build stage.
- Whether the vulnerable function or rule location is imported or called, per the tool's output.
- Exposure: Service type, Ingress or Gateway route, NetworkPolicy, authentication in front of the endpoint.
- For SAST and SonarQube: the rule description, surrounding code, and whether the file is production or test code.
- For cloud posture: the resource's live configuration and IAM bindings, not just the finding title.

## Exploitability reasoning must cite evidence

Require a structured output where every conclusion names the artifact that supports it. A claim without evidence is `under_investigation`, not a suppression.

```json
{
  "cluster_id": "CVE-XXXX-YYYY|pkg:example/lib@1.2.3|sha256:...",
  "proposed_status": "not_affected",
  "justification": "vulnerable_code_not_in_execute_path",
  "evidence": [
    { "type": "reachability_report", "ref": "reports/reach.json#/paths/0" },
    { "type": "image_manifest", "ref": "sbom.json" }
  ],
  "confidence": "medium",
  "open_questions": ["Is the optional plugin loader enabled in production config?"],
  "requires_human": true
}
```

Validate the shape and that each `ref` resolves to a real file in the evidence set before anything is written to a ticket (see [[validating-model-generated-json]]). Reject proposals whose evidence list is empty or points outside the supplied set. Treat the stated confidence as a hint for ordering the review queue, not as a threshold for auto-closing; vendor confidence bands are product behaviour, not a standard.

## Express decisions as VEX

Record outcomes as VEX statements, not as silent scanner ignores. OpenVEX uses four statuses (`not_affected`, `affected`, `fixed`, `under_investigation`) and expects a justification or impact statement for `not_affected`; verify exact labels and the document context version against the spec you target. Store the document next to the artifact (in the repository or the artifact store) so the decision travels with the image and an auditor can read it.

The model may draft a statement; a human commits it. Make that a reviewed merge request:

```yaml title=".gitlab-ci.yml (excerpt)"
vex-draft:
  stage: test
  image: $TRIAGE_IMAGE # pin by digest, not a moving tag
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - security/clusters.json
  script:
    - ./scripts/triage-draft.sh security/clusters.json > security/vex-draft.json
    - ./scripts/validate-vex.sh security/vex-draft.json
  artifacts:
    paths: [security/vex-draft.json]
  allow_failure: true # advisory; the scan gate job is separate and unchanged

security-gate:
  stage: test
  image: $GATE_IMAGE # pinned by digest; no model credentials in this job
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - ./scripts/policy-gate.sh # deterministic thresholds, no model involved
```

A person reviews the draft artifact and commits the accepted statements under `security/vex/`. Scope the CODEOWNERS entry for `security/vex/` and the risk register to the security or service owners, and require code owner approval on the protected branch (check that your GitLab tier supports it), so a statement cannot merge without them. The approval flow maps onto [[human-approval-state-machine]].

## Humans own risk acceptance

A risk acceptance is a human record, not a model output:

- Owner (a named person with authority for the service tier), rationale, evidence links, scope, expiry date and review date.
- Scoped narrowly: one CVE, one artifact or one path. A rule such as "ignore all unfixed" hides future findings.
- Expiring: when the date passes, the finding reopens and goes back through triage.
- Applied to the scanner only after approval. Ignore files, dismissals in a vulnerability report and quality-gate exemptions (see [[sonarqube-quality-gates]]) are changed by a person or by a pipeline running a human-merged change.

The register is read-only to the model: it reads the register to skip re-triaging accepted items, and never writes to it. Check ignore-file syntax and expiry fields against the scanner version you run, because they can differ between tools and releases.

> [!warning] Never auto-suppress
> If a workflow can dismiss, ignore or downgrade a finding with no human approval step, the model's mistakes become silent false negatives. Auto-dismiss features, where used, should be restricted to deterministic criteria a policy owner has approved, not model judgement.

## Protect the inputs

Scanner output and posture findings contain resource IDs, project names, paths and occasionally secrets. Redact before any model call ([[redacting-sensitive-data-before-llm-calls]]), cap input size per cluster, and log the model, prompt version and evidence set for each triage so a decision can be reproduced. Finding descriptions and package metadata are untrusted text and can carry injected instructions ([[indirect-prompt-injection-in-documents]]); give the triage job read-only access to scan results and no permission to call scanner write APIs ([[coding-agent-permission-allowlists]]).

## Measure triage quality

Volume closed is the wrong metric. Track time to triage, the share of findings closed by evidence versus accepted risk, suppressions that reopened at expiry, and false negatives discovered later in incidents ([[ai-assisted-incident-response]]). Sample closed-by-evidence items monthly and have a human re-check them. A tool that shrinks the backlog with thin evidence is a regression. Shared expectations for this kind of work belong in [[team-norms-for-ai-assisted-engineering]], and prompt hygiene in [[effective-prompting-for-operations-work]].

## Failure modes

- The model marks a finding not affected because an import is absent, while the code loads the package dynamically.
- Deduplication on package name alone merges different versions or different images and hides one of them.
- Evidence references that do not exist (hallucinated file paths) pass because nobody validated them.
- A broad suppression without expiry outlives the service that justified it.
- Test-code classification is wrong, so a production SonarQube issue is dismissed.
- Posture triage uses the finding title and misses the actual resource configuration or a compensating control.
- The same finding is re-triaged every run because the register was not consulted, and decisions flip between runs.
- Injected text in a package description changes the verdict.
- The gate quietly begins reading model output, so a hallucination changes a pass/fail.

## Review checklist

- [ ] Findings are deduplicated deterministically before any model call.
- [ ] Scanner facts, tool-produced reachability and model hypotheses are stored separately.
- [ ] Every non-trivial conclusion cites resolvable evidence; otherwise status is under investigation.
- [ ] Decisions are recorded as VEX or register entries beside the artifact, not as silent ignores.
- [ ] No path exists for the model to suppress, dismiss, downgrade or exempt a finding without a human merge.
- [ ] Each acceptance has an owner, scope, rationale, evidence links and an expiry that reopens it.
- [ ] CI and admission gates are deterministic and do not read model output.
- [ ] Inputs are redacted and size-capped; model, prompt version and evidence set are logged.
- [ ] The triage job has read-only scanner access and no write credentials.
- [ ] Ignore syntax and vendor features were checked against the versions in use.
- [ ] Closed-by-evidence items are sampled and re-checked on a schedule.

## Sources

- https://github.com/openvex/spec/blob/main/OPENVEX-SPEC.md - OpenVEX statuses, justification for `not_affected`, and document structure.
- https://docs.gitlab.com/user/application_security/policies/vulnerability_management_policy/ - GitLab vulnerability management policy, auto-dismiss scope and limits (check tier and current limits).
- https://docs.gitlab.com/user/application_security/vulnerabilities/false_positive_detection/ - GitLab false positive detection and dismissal of findings (check availability and tier).
- https://doi.org/10.6028/NIST.SP.800-40r4 - NIST SP 800-40 Rev. 4, enterprise patch management planning and risk-based prioritisation.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
