---
title: Code review for infrastructure code
description: Review standard for Terraform, Helm, CI YAML and Dockerfiles covering checks, MR size, turnaround, approvals, tone and automation.
type: standard
tags:
  - standards
  - delivery
  - ci-cd
  - security
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Infrastructure code changes production directly, so review is a control as well as a learning tool. This standard covers Terraform, Helm charts and Kubernetes manifests, CI YAML and Dockerfiles. It complements the [[production-change-checklist]].

## Principles

- The author is responsible for the change; the reviewer shares responsibility for what they approved.
- Automate everything a machine can check so humans review design and risk.
- Review the effect, not just the diff: for infrastructure the plan or rendered output is the real change.
- Be kind, specific and fast.

## What reviewers check

**All changes**

- The description explains what and why, and links the ticket.
- The change is the smallest that solves the problem and does one thing.
- Rollback is possible, or the risk is stated (see [[production-change-checklist]]).
- No secrets, tokens or internal hostnames committed. Secrets come from a secret manager ([[external-secrets-with-secret-manager]]).

**Terraform** (conventions in [[terraform-module-and-state-layout]])

- The plan is attached and read. Look for destroy or replace actions, especially on databases, disks, clusters and IAM.
- Provider and module versions are pinned.
- IAM follows least privilege; no `roles/owner`, `roles/editor` or broad `allUsers` bindings without justification.
- State and blast radius: the change is in the right state file or workspace.
- Variables have types and descriptions; sensitive values are marked `sensitive`.
- `lifecycle { prevent_destroy = true }` stays on critical resources.

**Helm and Kubernetes** (see [[helm-chart-conventions]])

- Resource requests and limits are set ([[kubernetes-resource-requests-and-limits]]).
- Probes, security context (non-root, read-only root filesystem where possible), PodDisruptionBudget and replicas are sensible.
- Rendered manifests (`helm template`) are reviewed for risky changes, not only `values.yaml`.
- Image tags are pinned, ideally by digest; no `latest`.
- NetworkPolicy and ServiceAccount permissions are considered ([[kubernetes-network-policies]]).

**CI YAML** (see [[gitlab-ci-pipeline-structure]])

- Jobs run only on intended branches and rules; deploy jobs are protected.
- Secrets are not echoed; variables are masked and protected.
- Included templates and images are pinned to a version or digest.
- Caching and artefacts are scoped and expire.

**Dockerfiles** (see [[dockerfile-hardening]])

- Minimal, pinned base image; multi-stage build.
- Runs as a non-root user; no secrets in layers; no unnecessary packages.
- `COPY` is specific and `.dockerignore` is present.

## Plan output in the MR

For Terraform, CI posts the `terraform plan` (or `tofu plan`) summary on the MR and stores the full plan as a job artefact. Approvers confirm they read the plan for the exact commit being merged. Apply the saved plan, not a new one, so what was reviewed is what runs.

```bash
PLAN=plan.tfplan
terraform plan -input=false -out="$PLAN"
terraform show -no-color "$PLAN" > plan.txt
terraform show -json "$PLAN" > plan.json
```

If the plan is too large to read, the change is too large: split it.

## Size limits

- Aim for under about 400 changed lines of hand-written code per MR; generated or lock files do not count.
- One logical change per MR. Refactors and behaviour changes go in separate MRs.
- A reviewer may ask to split any MR they cannot review properly. That is not a rejection.

## Turnaround expectations

- First response within one working day; small MRs the same day.
- Authors respond to comments within one working day.
- Urgent fixes are flagged in the team channel, and a reviewer picks them up within a few hours.
- Stale MRs (no activity for a week) are closed or rebased with a comment.
- Review time is part of planning, not an interruption; see [[planning-and-prioritization]].

## Approval rules

- At least one approval from a code owner for the path (`CODEOWNERS`); authors cannot approve their own MR.
- Two approvals for High-risk changes (IAM, networking, production data stores, pipeline definitions that affect all projects).
- New commits after approval reset approvals for protected branches.
- Merge only with the pipeline green. No bypass except documented emergencies with later review.
- The author merges or triggers the deploy, so someone is present when it lands.

## Tone

- Comment on the code, not the person. Ask questions: "What happens if this bucket already exists?"
- Mark intent: `nit:` for optional, `question:` for understanding, `blocking:` for must-fix.
- Explain why and offer an alternative. Praise good work.
- Resolve disagreement by call or chat within a day; escalate to the code owner or manager if still stuck (see [[managing-conflict]]).
- Authors: do not take comments personally; reviewers: do not rewrite the MR in comments.

## Automation

Automate on every MR, failing the pipeline on errors:

| Area        | Tools                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| Terraform   | `terraform fmt -check`, `terraform validate`, `tflint`, `checkov` or `trivy config` |
| Kubernetes  | `kubeconform` against rendered manifests, `kube-linter` or `polaris`                |
| Helm        | `helm lint`, `helm template` piped to `kubeconform`                                 |
| CI YAML     | GitLab CI Lint, `yamllint`                                                          |
| Dockerfiles | `hadolint`, image scan (Trivy or Artifact Registry scanning)                        |
| Secrets     | `gitleaks` or equivalent pre-commit and CI scan                                     |
| Pre-commit  | Run the fast checks locally via `pre-commit`                                        |

```bash
CHART=./charts/api
VALUES=values/prod.yaml
helm lint "$CHART" -f "$VALUES"
helm template api "$CHART" -f "$VALUES" | kubeconform -strict -summary -ignore-missing-schemas
tflint --recursive
checkov -d . --quiet
```

Treat linter findings as the author's job. Suppressions need a comment explaining why.

## Review checklist

```markdown title="review-checklist.md"
- [ ] Description explains what, why; ticket linked
- [ ] One logical change; size reviewable
- [ ] CI green; linters and scanners clean (suppressions justified)
- [ ] Plan or rendered output attached and read
- [ ] No destroy/replace of critical resources without justification
- [ ] No secrets or credentials in the diff
- [ ] Versions pinned (providers, modules, images, templates)
- [ ] IAM and network changes are least privilege
- [ ] Resources have requests, limits, probes and security context
- [ ] Rollback plan exists for Medium/High changes
- [ ] Docs and runbooks updated if behaviour changed
- [ ] Comments marked nit / question / blocking
```
