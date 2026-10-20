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
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
draft: false
---

This note sets the rules for running AI coding and operations agents inside CI jobs or with cloud credentials. It is written for senior DevOps engineers who own the pipelines and the service accounts the agents will use. It does not cover how to review the code an agent writes ([[ai/ai-generated-code-policy-and-provenance]]) or how to run an advisory review bot ([[ai/ai-code-review-bots]]); it covers what the agent is allowed to touch.

> [!info] Scope and sources
> Written for GitLab CI and GitHub Actions pipelines running on GKE or hosted runners, and for agents that read repositories, issues, logs or cloud APIs. It is based on the general threat guidance in the OWASP Top 10 for LLM Applications, the GitLab CI/CD documentation at https://docs.gitlab.com/ci/ and the GitHub Actions security documentation. No product is named as the agent; the rules apply to any tool that turns text into actions.

> [!note] What was checked
> The OWASP names, the GitLab merge request, fork and variable behaviour and the job token statements were checked against the documentation on 2026-10-20, and the trigger matrix was corrected where it disagreed. The GitHub Actions workflow, the GKE statements and the runtime behaviour of the YAML were not checked. See Evidence for the list.

## Threat model

An agent is a program that reads text and decides what to run. Anything it reads can contain instructions, so the trust level of the text matters more than the trust level of the person who triggered the job.

- **Prompt injection.** An issue, merge request description, code comment, commit message, log line or web page contains text that tells the agent to do something else. The agent cannot reliably tell data from instructions. This is the main threat and the one the other rules are built around.
- **Excessive agency.** The agent holds more permissions than the task needs, for example a write token to review a change, or a cloud admin role to read logs. A successful injection then inherits all of it.
- **Credential theft.** Anything in the job environment (tokens, cloud credentials, SSH keys) can be read by the agent and sent out through a command, a URL, a commit or a comment.
- **Data leakage.** Code, logs and customer data are sent to a model provider that the organisation has not approved for that data class.
- **Cost and loop abuse.** An agent that retries or fans out without a budget turns a bad input into a large bill (OWASP calls this Unbounded Consumption).

In the 2025 edition of the OWASP Top 10 for LLM Applications, these map to LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM05 Improper Output Handling (called Insecure Output Handling in the 2023 list), LLM06 Excessive Agency and LLM10 Unbounded Consumption. Use the list as a vocabulary for discussions with security teams; the numbering changed between editions, so check the current edition before citing an ID.

## Rules

The rules are short on purpose, so a reviewer can check a pipeline against them.

- An agent job gets the smallest token that does the task: read-only by default, scoped to one project, with an expiry.
- Jobs that process untrusted content (fork merge requests, issues, comments, external logs, web pages) get no secrets and no write token. They write their output to an artifact; a separate poster job, with no agent and no repository code, holds the narrow write scope and posts that text, optionally after a human gate.
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

| Trigger                                 | Content trust               | Allowed token scope                                        | Allowed actions                                                          |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| MR from a branch in the same project    | Medium (team member's code) | Read-only project token, no protected variables            | Read diff, write findings to an artifact; a separate poster job comments |
| MR from a fork                          | Untrusted                   | None                                                       | Nothing automatic. Never run an agent job in the parent project for it   |
| Issue or comment text                   | Untrusted                   | None, or read-only to the same project                     | Summarise to a human; no tool calls with side effects                    |
| Push to a protected branch              | High (reviewed code)        | Read-only; write only through a separate approval step     | Analyse, open an MR as a draft                                           |
| Scheduled job on logs or alerts         | Untrusted (logs hold input) | Read-only cloud role, short-lived, one project             | Summarise and propose; a human runs the fix                              |
| Manual job started by an on-call person | Medium                      | Read-only by default; write role only with a second person | Diagnose; changes follow [[standards/production-change-checklist]]       |

The common point: the more untrusted the text, the fewer credentials the job may hold.

On GitLab, a merge request from a fork normally gets a pipeline that is created and runs in the fork, with the fork's own configuration and variables, not the parent project's. A member of the parent project can start a pipeline for that merge request in the parent project; that pipeline uses the fork branch's `.gitlab-ci.yml` but the parent project's variables and runners, and GitLab warns that the fork's code could try to steal them. So "a maintainer triggers a run" is not a safe default for an agent job: it hands the parent's variables to untrusted code. Review the change first, and keep agent jobs out of that pipeline (the rule in the next section does this). Admins can disable parent-project pipelines for forks per project through the `ci_allow_fork_pipelines_to_run_in_parent_project` setting; check the current API reference.

## Isolating the job

Run agent jobs on an ephemeral runner that is thrown away after each job. On GKE this means a pod per job with no persistent volume, no host mounts, a dedicated namespace and a dedicated Kubernetes service account that has no workload identity binding by default (see [[patterns/gke-workload-identity]]). Apply the usual hardening from [[patterns/pod-security-admission]] and [[patterns/kubernetes-network-policies]].

### GitLab: same-project merge requests only

The job runs only for merge request pipelines whose source project is the target project. By default a fork merge request pipeline runs in the fork's own project, where the source project ID equals that project's ID, so the rule mainly blocks the dangerous case: a pipeline in this (parent) project for a fork merge request, which a parent member can start by hand.

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
    # read_api cannot create notes, so the agent only writes a file.
    - ./scripts/run-agent.sh --mode comment-only --mr "$CI_MERGE_REQUEST_IID" --out review.md
  artifacts:
    paths:
      - review.md
    expire_in: 1 day

ai-agent-post:
  stage: .post
  image: registry.example.com/ci/poster:1.0.0 # change: a small image with curl and jq, no agent, no repository code
  needs:
    - job: ai-agent-review
      artifacts: true
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_PROJECT_ID == $CI_PROJECT_ID'
  timeout: 2 minutes
  allow_failure: true
  environment:
    name: ai-comment-poster # change: scope POSTER_TOKEN to this environment only
    action: access # check the action name for your GitLab version
  variables:
    GIT_STRATEGY: none # no repository checkout in this job
  script:
    # POSTER_TOKEN: masked project access token with the api scope and the Reporter role
    # (a bot that can comment but not push or merge), scoped to the ai-comment-poster
    # environment so the agent job does not receive it.
    - |
      jq -Rs '{body: .}' review.md | curl --fail --silent --show-error \
        --header "PRIVATE-TOKEN: $POSTER_TOKEN" --header "Content-Type: application/json" \
        --data @- "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes"
```

Pitfalls to check against your GitLab version: protected variables are only exposed to pipelines on protected branches and tags. Merge request pipelines were treated differently across versions: the 17.9 documentation says they do not get protected variables, while the current documentation says they can when both the source and target branches are protected, and never for pipelines from forks. Do not rely on one behaviour; keep deploy secrets out of any project where an agent job runs, and check the page for your version. Masking only hides a value in job logs and is not a guarantee against a malicious job reading it; hidden variables cannot be revealed in the UI after saving but can still be used by jobs. Neither replaces keeping the secret away from the job. The agent token is an unprotected, masked variable that any pipeline in the project can read, which is acceptable only because it is read-only. Keep the poster token out of the agent job: scope `POSTER_TOKEN` to the `ai-comment-poster` environment only, so the agent job does not receive it. Environment scoping is not a hard boundary, because a branch author in the same project can still change `.gitlab-ci.yml`, so the token must stay limited to commenting (Reporter role, `api` scope). `CI_MERGE_REQUEST_SOURCE_PROJECT_ID` is a documented predefined variable for merge request pipelines; still test the rule with a real fork on your instance. The job token (`CI_JOB_TOKEN`) is a separate credential: by default a project's job token allowlist contains only the project itself, and adding a project or group to the allowlist lets that project's jobs reach yours, so keep the allowlist short and do not disable it.

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
        run: ./scripts/run-agent.sh --mode comment-only --out review.md
        env:
          AGENT_MAX_TOOL_CALLS: "30"
      - name: Keep the findings as an artifact
        uses: actions/upload-artifact@FULL_COMMIT_SHA # change: full 40-character SHA of a release you reviewed
        with:
          name: review
          path: review.md

  post:
    # No agent and no repository code in this job: it only posts text.
    needs: review
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    timeout-minutes: 2
    permissions:
      pull-requests: write
    steps:
      - name: Download the findings
        uses: actions/download-artifact@FULL_COMMIT_SHA # change: full 40-character SHA of a release you reviewed
        with:
          name: review
      - name: Post one comment
        run: gh pr comment "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --body-file review.md
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
```

The agent job holds only `contents: read`. The write permission sits in a second job that never runs the agent, because GitHub Actions permissions are set per workflow or per job, not per step.

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

## Evidence

### Sources checked

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): 2025 IDs and names LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM10 Unbounded Consumption, checked 2026-10-20 (IDs from search results, including the OWASP pages for LLM05 and LLM10; the list page itself could not be fetched).
- [Merge request pipelines](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/): fork merge request pipelines run in the fork by default; a parent member can run one in the parent with the parent's variables; the security warning; the `ci_allow_fork_pipelines_to_run_in_parent_project` setting; `merge_request_event` as the pipeline source, checked 2026-10-20 (search excerpts).
- [Predefined variables](https://docs.gitlab.com/ci/variables/predefined_variables/): `CI_MERGE_REQUEST_SOURCE_PROJECT_ID`, `CI_MERGE_REQUEST_IID` and the `CI_PIPELINE_SOURCE` values, checked 2026-10-20 (search excerpt).
- [CI/CD variables](https://docs.gitlab.com/ci/variables/): protected variables only on protected branches and tags, the version difference for merge request pipelines, masking limits and hidden variables, checked 2026-10-20 (search excerpt; the 17.9 and current pages disagree, as stated in the note).
- [CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/): the default allowlist contains only the project itself, checked 2026-10-20 (search excerpt).

Corrections made on 2026-10-20: OWASP names and IDs updated to the 2025 edition; the fork row of the trigger matrix no longer says a maintainer triggers a manual run, because that run exposes the parent's variables; the protected-variable statement was corrected to say the behaviour differs between GitLab versions; the masking limits and the job token allowlist were added; the GitLab documentation link now uses the current `/ci/` path.

### Not verified

- The GitHub Actions workflow (triggers, per-job permissions, `gh pr comment --body-file`, the runner label) was not checked.
- The GKE statements (ephemeral pod per job, no workload identity binding by default) and the Kubernetes hardening links were not checked against Kubernetes or GKE documentation.
- The project access token roles and scopes used in the YAML (Reporter with `read_api` or `api`) and the `environment: action: access` setting were not checked; the note already tells readers to check them for their version.
- The YAML was never run in GitLab. The documentation pages were reached through search excerpts only, because the lab's network policy blocked fetching them.
- The Model Context Protocol is not cited in this note.
- Nothing was verified against a real environment.

### Lab run

A helper check, not part of the evidence level. Host: Ubuntu 24.04.5 LTS, `python3 --version` printed `Python 3.13.16`, run 2026-10-20 with `python3 -I`. It models the egress allowlist decision as exact `host:port` matching against the list above.

```bash
python3 -I egress_check.py
```

```text
llm-gateway.example.com:443                        ALLOW
llm-gateway.example.com:80                         DENY
api.example.com:443                                DENY
llm-gateway.example.com.attacker.example:443       DENY
attacker.example:443                               DENY
LLM-GATEWAY.EXAMPLE.COM:443                        ALLOW
```

This shows only that exact matching rejects a subdomain trick and an unlisted host. A real firewall or proxy was not tested, and it must also do case-insensitive matching and DNS handling that the model leaves out.

## Related

- [[runbooks/leaked-credential-rotation]]: what to do when an agent job may have exposed a token.
- [[patterns/secret-scanning-pre-commit-and-ci]]: keep secrets out of prompts and repositories.
- [[architecture/iam-groups-and-ci-workload-identity-federation]]: short-lived cloud access for CI instead of key files.
- [[ai/ai-code-review-bots]]: the advisory review pattern that follows these rules.
- [[ai/ai-generated-code-policy-and-provenance]]: the review and audit side of AI-written code.
- [The owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
