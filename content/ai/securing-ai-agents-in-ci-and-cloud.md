---
title: Securing AI agents that have repository or cloud access
description: Rules for running coding and operations agents in CI or with cloud credentials, covering tokens, triggers, isolation, egress, human gates and data handling.
type: standard
tags:
  - ai
  - security
  - ci-cd
  - gitlab-ci
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This note sets the rules for running AI coding and operations agents inside CI jobs or with cloud credentials. It is written for senior DevOps engineers who own the pipelines and the service accounts the agents will use. It does not cover how to review the code an agent writes ([[ai/ai-generated-code-policy-and-provenance]]) or how to run an advisory review bot ([[ai/ai-code-review-bots]]); it covers what the agent is allowed to touch.

> [!info] Scope and sources
> Written for GitLab CI and GitHub Actions pipelines running on GKE or hosted runners, and for agents that read repositories, issues, logs or cloud APIs. It is based on the general threat guidance in the OWASP Top 10 for LLM Applications, the GitLab CI/CD documentation at https://docs.gitlab.com/ee/ci/ and the GitHub Actions security documentation. No product is named as the agent; the rules apply to any tool that turns text into actions.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the item numbering and names of the current OWASP Top 10 for LLM Applications edition, the exact behaviour of GitLab predefined variables for merge request pipelines, and which variables a given runner exposes to pipelines from forks. Check them before relying on them.

## Threat model

An agent is a program that reads text and decides what to run. Anything it reads can contain instructions, so the trust level of the text matters more than the trust level of the person who triggered the job.

- **Prompt injection.** An issue, merge request description, code comment, commit message, log line or web page contains text that tells the agent to do something else. The agent cannot reliably tell data from instructions. This is the main threat and the one the other rules are built around.
- **Excessive agency.** The agent holds more permissions than the task needs, for example a write token to review a change, or a cloud admin role to read logs. A successful injection then inherits all of it.
- **Credential theft.** Anything in the job environment (tokens, cloud credentials, SSH keys) can be read by the agent and sent out through a command, a URL, a commit or a comment.
- **Data leakage.** Code, logs and customer data are sent to a model provider that the organisation has not approved for that data class.
- **Cost and loop abuse.** An agent that retries or fans out without a budget turns a bad input into a large bill.

OWASP's list for LLM applications names prompt injection, insecure output handling, excessive agency and sensitive information disclosure among its main risks. Use it as a vocabulary for discussions with security teams, and check the current edition for numbering.

## Rules

The rules are short on purpose, so a reviewer can check a pipeline against them.

- An agent job gets the smallest token that does the task: read-only by default, scoped to one project, with an expiry.
- Jobs that process untrusted content (fork merge requests, issues, comments, external logs, web pages) get no secrets and no write token. They may produce a comment through a separate, human-gated step.
- Never use `pull_request_target` or the GitLab equivalent of running fork code with project secrets for an agent job.
- Cloud credentials are not present by default. When an agent needs cloud read access, use short-lived workload identity federation bound to a narrow service account, as in [[architecture/iam-groups-and-ci-workload-identity-federation]], never a long-lived key file.
- Agent output is untrusted input to the next step. Do not pipe it into `bash`, `kubectl apply` or `terraform apply`.
- Writes (commits, merges, deployments, infrastructure changes) need a human approval that the agent cannot give itself.
- The runner is ephemeral and has an egress allowlist.
- Every run logs who triggered it, which inputs it read, which tools it called and what it changed.
- Data classes sent to a model provider are written down, and secrets, personal data and customer data are excluded unless an approved agreement says otherwise.
- Each job has a time limit, a token or request budget and a cap on tool calls.

Reusable agent prompts and workflows, with the guardrails above written into them, are easier to keep safe when they live in one place. [The owner's AI skills catalogue](https://ai.szolotov.com) is one such collection.

## Trigger and token matrix

Decide per trigger what the agent may read and what it may hold. Treat the matrix as the default and write down every exception.

| Trigger                                 | Content trust               | Allowed token scope                                        | Allowed actions                                                    |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| MR from a branch in the same project    | Medium (team member's code) | Read-only project token, no protected variables            | Read diff, post one advisory comment                               |
| MR from a fork                          | Untrusted                   | None                                                       | Nothing automatic; a maintainer triggers a manual run              |
| Issue or comment text                   | Untrusted                   | None, or read-only to the same project                     | Summarise to a human; no tool calls with side effects              |
| Push to a protected branch              | High (reviewed code)        | Read-only; write only through a separate approval step     | Analyse, open an MR as a draft                                     |
| Scheduled job on logs or alerts         | Untrusted (logs hold input) | Read-only cloud role, short-lived, one project             | Summarise and propose; a human runs the fix                        |
| Manual job started by an on-call person | Medium                      | Read-only by default; write role only with a second person | Diagnose; changes follow [[standards/production-change-checklist]] |

The common point: the more untrusted the text, the fewer credentials the job may hold.

## Isolating the job

Run agent jobs on an ephemeral runner that is thrown away after each job. On GKE this means a pod per job with no persistent volume, no host mounts, a dedicated namespace and a dedicated Kubernetes service account that has no workload identity binding by default (see [[patterns/gke-workload-identity]]). Apply the usual hardening from [[patterns/pod-security-admission]] and [[patterns/kubernetes-network-policies]].

### GitLab: same-project merge requests only

The job runs only for merge request pipelines whose source project is the target project, so a fork never starts it.

```yaml title=".gitlab-ci.yml"
ai-agent-review:
  stage: test
  image: registry.example.com/ci/agent-runner:1.4.2 # change: your own image, pinned by tag or digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_PROJECT_ID == $CI_PROJECT_ID'
  timeout: 10 minutes
  allow_failure: true
  tags:
    - ephemeral-agent # change: runner tag of the isolated, egress-limited runner pool
  variables:
    GIT_DEPTH: "50"
    AGENT_MAX_TOOL_CALLS: "30"
  script:
    # AGENT_READ_TOKEN is a masked, NOT protected, project access token with the
    # read_api scope and the Reporter role. No cloud credentials, no deploy keys.
    - ./scripts/run-agent.sh --mode comment-only --mr "$CI_MERGE_REQUEST_IID"
```

Pitfalls to check against your GitLab version: protected variables are only exposed to pipelines on protected branches and tags, which is why the agent token must not be one; if it were protected, a branch protected by mistake would hand it to untrusted input. Confirm that `CI_MERGE_REQUEST_SOURCE_PROJECT_ID` is set in merge request pipelines on your instance and test with a real fork.

### GitHub Actions: read-only, `pull_request` trigger

```yaml title=".github/workflows/ai-review.yml"
name: ai-review

on:
  pull_request:
    types:
      - opened
      - synchronize
      - reopened

permissions:
  contents: read

jobs:
  review:
    # Skip forks entirely: they get no secrets with this trigger anyway.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - name: Check out the merge ref without keeping credentials
        uses: actions/checkout@FULL_COMMIT_SHA # change: full 40-character SHA of a release you reviewed
        with:
          persist-credentials: false
      - name: Run the agent in comment-only mode
        run: ./scripts/run-agent.sh --mode comment-only
        env:
          AGENT_MAX_TOOL_CALLS: "30"
```

Use `pull_request`, not `pull_request_target`: the second one runs with the base repository's secrets and write token in the context of an untrusted change. Pin every third-party action by full commit SHA and let [[patterns/automated-dependency-updates]] raise the bumps.

### Egress allowlist

The runner reaches only what the job needs. Everything else is denied at the network layer (egress firewall or proxy), not by the agent's own configuration.

```text title="egress-allowlist.txt"
# Model provider endpoint approved for this data class (change: your provider)
llm-gateway.example.com:443
# Source host for the repository being reviewed
gitlab.example.com:443
# Internal package mirror (Artifactory); no direct internet package registries
artifactory.example.com:443
# Everything else: deny
```

Route model traffic through an internal gateway where you can log requests, enforce budgets and strip secrets. Allowing the open internet lets an injected instruction send data anywhere with a single `curl`.

## Human gates

- **Read-only by default.** Agents propose; people apply. A merge request opened by an agent is reviewed by a person who did not trigger it.
- **No self-approval.** The identity that wrote the change cannot approve or merge it. Enforce it with branch protection and approval rules, not with a prompt.
- **Separate the plan from the apply.** For infrastructure, the agent may run `terraform plan` with a read-only role and attach the output; apply runs in a separate protected pipeline after a human approval.
- **Two-person rule for production writes.** An on-call engineer starting an agent with a write role needs a second approver, as in [[standards/production-change-checklist]].

## Data handling and cost limits

- Classify data: public, internal, confidential, regulated (personal data, payment data, customer data). Write which classes each approved provider and model may receive.
- Run [[patterns/secret-scanning-pre-commit-and-ci]] on the content before it goes into a prompt, and block the job on a hit.
- Prefer a provider contract that excludes your data from training and sets a retention period. Legal and security teams decide this; engineers only enforce the technical gate.
- Set a per-job and per-day budget at the gateway (requests or tokens), and alert when it is near. A runaway loop should stop on a budget error, not on the invoice.
- Cap prompt size. Truncating a huge diff is safer than sending everything.

## Logging and review

- Log for every run: trigger, actor, project, commit SHA, the list of tools the agent called with their arguments, files read, outputs posted and the model gateway request IDs. Store logs where the agent cannot edit them.
- Review a sample of agent runs each month, especially runs on untrusted inputs, and look for tool calls that do not match the task.
- Alert on unusual egress, on tokens used from unexpected addresses and on writes outside the agent's project.
- If a credential may have been exposed to an agent job, rotate it with [[runbooks/leaked-credential-rotation]].

## Checklist

```text
[ ] Every agent job has a written trigger, content-trust level and token scope
[ ] Jobs that read untrusted text hold no secrets and no write token
[ ] Fork merge requests never start an agent job automatically
[ ] pull_request_target (or equivalent) is not used for agent jobs
[ ] No long-lived cloud keys; federation with a narrow service account if cloud access is needed
[ ] Runner is ephemeral, in its own namespace, with an egress allowlist
[ ] Agent output is never executed without a human step
[ ] Writes need an approval the agent cannot give itself
[ ] Allowed data classes per provider are documented; secrets are scanned before prompting
[ ] Job timeout, tool-call cap and spend budget are set
[ ] Run logs are stored outside the agent's reach and sampled monthly
[ ] Rotation runbook exists and has been tried once
```

## Related

- [[runbooks/leaked-credential-rotation]]: what to do when an agent job may have exposed a token.
- [[patterns/secret-scanning-pre-commit-and-ci]]: keep secrets out of prompts and repositories.
- [[architecture/iam-groups-and-ci-workload-identity-federation]]: short-lived cloud access for CI instead of key files.
- [[ai/ai-code-review-bots]]: the advisory review pattern that follows these rules.
- [[ai/ai-generated-code-policy-and-provenance]]: the review and audit side of AI-written code.
- [The owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
