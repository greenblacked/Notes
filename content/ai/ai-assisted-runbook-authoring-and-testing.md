---
title: AI-assisted runbook authoring and testing
description: Use AI to draft and maintain runbooks with evidence-grounded steps, lab-verified commands, destructive-step markers, freshness reviews and game days.
type: pattern
tags:
  - ai
  - reliability
  - incident-management
  - on-call
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers using AI to draft and maintain operational runbooks: grounding drafts in real incidents and command output, verifying every command in a lab, marking destructive steps, reviewing freshness on a schedule and testing runbooks in game days so that a model does not leave confident but wrong steps in front of a tired on-call engineer. It is for senior DevOps and platform engineers who own runbooks. It does not cover using AI live during an incident ([[ai-assisted-incident-response]]), retrieval over runbooks ([[rag-over-runbooks-for-on-call]]) or the house runbook format ([[alert-and-runbook-standard]]).

> [!note] Not verified
> Sources were found through search on 2026-10-27, but the pages could not be fetched, so nothing here was checked against them. Check before relying on it: the NIST SP 800-61 Rev. 3 status and contents, the OWASP LLM Top 10 edition and the excessive agency wording, the chapters of the Google SRE Workbook, the Chaos Engineering chapter on Google DiRT, and every tool flag in the examples against the version in your lab. The claim that AI drafting shortens incidents is a hypothesis to test in game days, not a finding.

## The core rule

A model is good at turning messy material into a consistent runbook and bad at knowing whether a command is true for your system. Draft with it, but treat each generated step as untrusted until it has run in a lab and the output is recorded next to it. A runbook is read under stress by someone with no time to doubt it, so a plausible but wrong step costs more than a missing one.

## Ground the draft in evidence

Give the model real artifacts and forbid it from filling gaps from general knowledge:

- Past incident timelines and postmortem action items ([[blameless-postmortems]]).
- Shell history and terminal output captured during real incidents, after secrets are removed ([[redacting-sensitive-data-before-llm-calls]]).
- `--help` or `explain` output for the exact tool versions you run.
- Existing alerts, dashboards and the owning service's tier ([[service-tiering-standard]]).

Instruct the model to tag every step with its evidence and to write `NOT VERIFIED` where there is none. A step with no source is a question for a human, not a step. The prompting patterns behind this (stated versions, evidence over summaries, fixed output formats) are in [[effective-prompting-for-operations-work]].

```markdown
### 3. Check whether the node is cordoned

- Evidence: INC-1234 timeline 14:07; lab run 2026-10-20 (transcript: labs/gke-node-notready/run-02.txt)
- Command: `kubectl get node "$NODE" -o jsonpath='{.spec.unschedulable}'`
- Expected: `true` when cordoned, empty otherwise
- If not as expected: stop and page the platform secondary
```

Do not let the model state root causes or "this usually fixes it" without a link to an incident or a lab run. Hold the text to the same bar as a postmortem ([[citation-grounding-and-source-provenance]]).

## Verify every command in a lab

Run each command in an environment that matches production on the parts that change behaviour: Kubernetes minor version, Helm chart and Terraform provider versions, installed CLI versions, IAM shape. Record the transcript and keep it in version control with the runbook.

A small harness makes the lab run repeatable. This sketch executes the steps from a tab-separated file and records the output. It refuses to start unless the current kubectl context is the named lab context, and it skips steps marked destructive unless `ALLOW_DESTRUCTIVE=yes` is set. The context check covers kubectl only: give other tools (cloud CLIs, Terraform) lab-only credentials in the same shell.

```bash title="verify-runbook.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

# usage: verify-runbook.sh steps.tsv lab-context
# steps.tsv: id<TAB>marker<TAB>command; use "-" for no marker, "#" starts a comment
steps="$1"
ctx="$2"
allow_destructive="${ALLOW_DESTRUCTIVE:-no}"

case "$ctx" in lab-*) ;; *) echo "refusing non-lab context: $ctx" >&2; exit 2 ;; esac
current="$(kubectl config current-context)"
if [[ "$current" != "$ctx" ]]; then
  echo "current kubectl context is $current, expected $ctx" >&2
  exit 2
fi

mkdir -p transcripts
out="transcripts/$(basename "$steps" .tsv)-$(date -u +%Y%m%dT%H%M%SZ).txt"

while IFS=$'\t' read -r id marker cmd; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  if [[ "$marker" == *DESTRUCTIVE* || "$marker" == *DATA-LOSS* ]] && [[ "$allow_destructive" != yes ]]; then
    echo "### $id SKIPPED (destructive; set ALLOW_DESTRUCTIVE=yes in a disposable lab)" | tee -a "$out"
    continue
  fi
  echo "### $id [$marker] $cmd" | tee -a "$out"
  # </dev/null stops a step from reading the rest of the steps file
  bash -c "$cmd" </dev/null 2>&1 | tee -a "$out" || echo "### $id FAILED" | tee -a "$out"
done <"$steps"
```

The marker field must not be empty, because `read` collapses consecutive tabs; that is why the format uses `-`. Steps run with your shell's credentials, so run the harness only from a session that cannot reach production.

Whatever harness you use, record: date, tool versions, lab ID and the person who reviewed the output. Then compare the output to the expected-output line the model proposed; a mismatch is a defect in the runbook, not in the lab.

## Mark destructive steps

Use a fixed vocabulary so people and linters can rely on it, for example `[DESTRUCTIVE]`, `[DATA-LOSS]`, `[PROD-ONLY]` and `[NEEDS-APPROVAL]`. Each marked step needs a preview form, an approver and a rollback or "stop here" line.

```markdown
### 6. Delete the stuck PVC [DESTRUCTIVE] [NEEDS-APPROVAL]

- Preview: `kubectl get pvc "$PVC" -n "$NS" -o yaml`, then check the bound PV's `persistentVolumeReclaimPolicy`; with `Delete`, the underlying volume is removed too, so confirm a snapshot exists and the volume is not the only copy
- Command: `kubectl delete pvc "$PVC" -n "$NS"`
- Approver: service owner, recorded in the incident channel
- Rollback: restore from the latest snapshot (see step 9); data written since is lost
```

Add a lint check in CI so that the model cannot drop a warning when it rewrites a step for brevity. Match known risky verbs and require a marker on the same step:

```yaml title=".gitlab-ci.yml"
runbook-lint:
  stage: test
  # Any pinned image with find and awk; pin by digest, never a moving tag.
  image: registry.example.com/ci/base:1.8.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
  script:
    - |
      find runbooks -name '*.md' -exec awk '
        FNR == 1 { marked = 0 }
        /^#+ / { marked = ($0 ~ /\[(DESTRUCTIVE|DATA-LOSS)\]/) }
        tolower($0) ~ /(delete|drain|detach|--force|rm -rf|drop |truncate)/ && !marked {
          printf "%s:%d: risky verb in a step without a marker\n", FILENAME, FNR; bad = 1
        }
        END { exit bad }
      ' {} +
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - runbooks/**/*
```

A step is the text under a heading, so the marker on the step heading covers the command lines below it, and a risky verb in an unmarked step fails the job. The regex is intentionally crude and will produce false positives; the point is a gate that forces a human to look. Pair it with the guardrails in [[safe-shell-command-generation-for-agents]].

## Prefer declarative, previewable forms

Ask the model for the Terraform, Helm or GitOps change that corresponds to each manual step. Where a step has no declarative equivalent, keep it but log it as debt. Prefer a server-side preview or plan before the mutating form, but check that the preview exists and behaves as you expect in your tool versions; do not accept flags from the model's memory. Avoid `kubectl edit`, console clicks and one-off `gcloud` commands where a reviewed change will do ([[validating-ai-generated-infrastructure-code]]).

## Keep the drafting agent's permissions small

If an assistant only drafts, give it read access to docs and transcripts and nothing else. If an assistant executes steps, scope its credentials to the runbook's steps, require human approval for writes, deletes and infrastructure changes, and never give it standing cluster-admin. This is the least-privilege and excessive-agency guidance applied to runbooks ([[agent-tool-authorization-boundaries]], [[kubernetes-rbac-for-ai-agents]]).

## Freshness reviews

Runbooks rot when the platform changes. Keep metadata in front matter and review on a schedule, not only after incidents. In this repository, the `verified`, `evidence`, `reviewed` and `review-due` fields and the Evidence section described in [[writing-notes]] play this role; elsewhere, something like:

```yaml
last_verified: 2026-10-20
verified_with:
  kubectl: "<version from the lab>"
  gke_minor: "<version from the lab>"
lab: lab-gke-03
review_due: 2027-01-20
```

- Re-verify on each platform upgrade (cluster minor, CI server or plugin upgrade, major release of a tool the runbook calls).
- Run a scheduled job that lists runbooks past `review_due` or whose referenced versions differ from what is deployed ([[ai-docs-drift-and-verification]]).
- When a model proposes an edit to an existing runbook, review the diff against the latest verified transcript, not against the model's description of the change.
- Retrieval over runbooks should return the `last_verified` date and warn when it is stale, and the assistant should say "not verified" instead of filling gaps ([[knowledge-freshness-and-invalidation]]).

## Test runbooks in game days

A runbook is tested when someone with no prior context can finish it. Pick a fault, give the on-call engineer only the runbook, and record the following.

- Steps that could not be executed as written.
- Wrong turns and the step that caused them.
- Time to the first correct action and to mitigation.
- Missing permissions or access discovered mid-drill.

Log each gap as a runbook bug with an owner. Use the infrastructure side in [[game-day-chaos-gke]] as the fault source and add a runbook-specific scorecard. Include AI-drafted and human-drafted runbooks in the same drills and compare, which is how you test the hypothesis that AI drafting helps ([[measuring-ai-impact-on-delivery]]).

## Measure outcomes

Useful signals: steps that failed in the lab, game-day corrections per runbook, time to mitigate in drills, and the count of runbooks past their freshness date. Runbook count and word count tell you nothing. Keep provenance in git (author, reviewer, lab transcript, approval) so that you can see which edits were AI-drafted ([[ai-generated-code-policy-and-provenance]]).

## Failure modes

- A runbook written from the model's memory, with a flag that was removed or renamed in your tool version.
- A rewrite for brevity that silently drops a `[DESTRUCTIVE]` marker or the preview step.
- A step with no expected output or rollback, so the responder cannot tell if it worked.
- A lab that differs from production, so a verified step fails in anger.
- A lab harness that trusts a context name but runs against whatever cluster or cloud account the shell is pointed at.
- Stale procedures returned by retrieval with high confidence.
- Invented root causes and "usually" lines with no incident behind them.
- Transcripts containing secrets or customer data committed with the runbook.
- An executing assistant with broad credentials running a drafted step that nobody reviewed.
- Counting generated runbooks as progress.

## Review checklist

- [ ] Every step cites an incident, a lab transcript or a doc link, or says `NOT VERIFIED`.
- [ ] Every command ran in a lab matching production versions, with output recorded.
- [ ] Destructive steps carry a marker, a preview, an approver and a rollback.
- [ ] CI lint fails on unmarked risky verbs.
- [ ] Each step has an expected-output line and a stop condition.
- [ ] Manual steps with a declarative equivalent link to the reviewed change.
- [ ] Front matter holds `last_verified`, tool versions, lab ID and `review_due`.
- [ ] Transcripts are redacted and stored with the runbook.
- [ ] An executing assistant, if any, has scoped credentials and human approval for writes.
- [ ] The runbook has been run by someone without prior context in a game day.
- [ ] The result is checked against [[alert-and-runbook-standard]].

## Sources

- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final): incident response playbooks, roles and lessons learned.
- [promptfoo: OWASP LLM Top 10](https://promptfoo.dev/docs/red-team/owasp-llm-top-10/): secondary coverage of the OWASP Top 10 for LLM applications, for the excessive agency risk and least-privilege controls; check the edition on the OWASP site.
- [Google Cloud Well-Architected Framework: operational excellence](https://docs.cloud.google.com/architecture/framework/operational-excellence): incident management and operations practice.
- [The Site Reliability Workbook](https://research.google/pubs/the-site-reliability-workbook/): incident response and disaster recovery practice.
- [Chaos Engineering, chapter on Google DiRT](https://oreilly.com/library/view/chaos-engineering/9781492043850/ch05.html): the game day framing of inducing failures in a controlled setting.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
