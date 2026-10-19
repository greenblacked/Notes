---
title: Verifying AI-generated runbooks before on-call uses them
description: Check every step of an AI-drafted runbook against the live system, a staging dry run and a named owner, and record when it was last verified.
type: guide
tags:
  - ai
  - runbooks
  - on-call
  - incident-management
  - kubernetes
created: 2026-10-19
modified: 2026-10-19
draft: false
---

An AI assistant can draft a runbook in a minute. It reads well, uses the right vocabulary and is wrong in small ways that only show up at 3 a.m.: a flag that does not exist, a namespace that was renamed, a step that assumes a state nobody checked. This guide describes how to turn a draft into a runbook an on-call engineer can trust, and how to keep it trustworthy. The runbook format itself is set by your alert and runbook standard; the incident process is in [[incident-response]].

> [!info] Scope
> Written for GKE and GCP runbooks using kubectl, helm and gcloud, with runbooks stored as Markdown in a repository and changed by merge request. Command flags change between versions, so check each against the version you run.

> [!note] Not verified
> The commands are examples of the verification method and were not run for this note. Do your own run against your clusters before relying on any of them.

## What drafts get wrong

Models complete patterns; they do not know your cluster. The typical defects:

- **Invented flags and subcommands.** Something that looks right and is not in `--help`.
- **Stale or guessed names.** Deployment `checkout-api` when yours is `checkout`; namespace `prod` when yours is `shop-prod`.
- **Missing preconditions.** "Scale to zero" without saying to check for a PodDisruptionBudget, an HPA that will scale it back, or traffic still arriving.
- **Wrong context or namespace.** Commands run against whatever cluster the engineer's shell points at.
- **Fluent but untested ordering.** Steps that are individually fine and unsafe in sequence.
- **Missing the rollback.** The draft tells you how to change a thing, not how to undo it.

## Step-by-step verification

Verification is done by a person who could run the runbook, step by step, against a real system. Use a checklist per step.

1. **Read-only first.** Run every read command (`get`, `describe`, `logs`, `list`) against the real system and compare the output with what the runbook says to expect.
2. **Check names exist.** Resources, namespaces, labels and projects:

   ```bash title="verify-names.sh"
   set -euo pipefail

   CTX="gke_example-project_europe-west1_prod"  # change: your kube context
   NS="shop-prod"                               # change: the runbook's namespace

   kubectl --context "$CTX" get deploy checkout -n "$NS"
   kubectl --context "$CTX" explain deployment.spec.strategy
   gcloud sql instances describe shop-db --project=example-project --format="value(state)"
   ```

3. **Check flags against help**, never against memory or the draft:

   ```bash title="verify-flags.sh"
   kubectl rollout undo --help
   helm rollback --help
   gcloud container clusters upgrade --help
   ```

4. **Pin the context.** Every command in the runbook carries `--context` (and `-n`), or the runbook begins with an explicit, checked context switch. A runbook that depends on the shell's current context will eventually run on the wrong cluster. See [[kubernetes-pod-troubleshooting]] for the same habit.
5. **Check preconditions and expected output.** Each step states what you should see before and after, so the responder can tell it worked.
6. **Check the exit path.** There is a "stop if" line and a rollback for every changing step.

For changing steps you cannot run on production, use the staging dry run below.

## Destructive steps stay human-written

Any step that changes or deletes state (scale, delete, rollback, failover, IAM, DNS, `terraform apply`) is written by a person, reviewed by a second person, and marked so nobody runs it by reflex:

> [!danger] Deletes data
> `kubectl delete pvc data-shop-db-0 -n shop-prod` removes the claim and, depending on the reclaim policy, the volume. Take a snapshot first and confirm the claim name.

An AI draft may propose such a step, but it enters the runbook only as a note for the human author. The same rule as in [[ai-assisted-incident-response]]: a model proposes, a human decides and runs. Rollback steps get the same treatment; link to a tested one such as [[helm-release-rollback]] where it exists instead of rewriting it.

## Staging dry run

Run the whole runbook once in a staging environment that mirrors production's shape:

- Use a person who did not write the draft; the author reads what they meant, not what is written.
- Break something on purpose (a failed deployment, a full disk on a test node) and follow the runbook as the only guide.
- Note every place the responder had to guess, every command that failed, and every output that differed from the text. Fix the runbook, not the responder.
- Time it. A runbook that takes forty minutes to read is not a runbook for a page.

Where the environment differs from production in a way that matters (sizes, data, IAM), say so in the runbook.

## Ownership and review in merge requests

Every runbook has an owning team and a named person in the front matter, and changes go through a merge request like code. The MR template for runbooks asks:

- What was verified, on which system, by whom, on which date?
- Which steps changed state, and who reviewed them?
- Was any text drafted by an assistant? (This is for review attention, not for attribution in the published page.)
- Is the rollback linked and current?

CODEOWNERS routes runbook changes to the owning team and to someone from the on-call rotation, who is the real reader.

## Recording verification

The writing standard already has a rule that applies here: `verified` is a promise ([[writing-notes]]). Set it only to the day you compared the text with the system. Use the same idea in runbooks:

```yaml title="runbook front matter"
---
title: Checkout service rollback
owner: team-checkout
service: checkout
verified: 2026-10-19
verified_by: a.example
verified_on: staging, prod read-only
---
```

Do not bump the date for typo fixes, and never copy a date from a draft. An old honest date is more useful than a fresh guess, because it tells the responder how much to trust the page.

## Drift and scheduled re-checks

Runbooks rot as the platform changes. Counter it with a habit and a check:

- **After every platform upgrade**, re-verify the runbooks for what changed. The upgrade checklist in [[gke-cluster-upgrade]] should include "re-verify affected runbooks" as a step.
- **On a schedule**, such as quarterly, for each critical-service runbook, with the on-call engineer running the read-only steps.
- **A CI lint** that flags runbooks whose `verified` date is older than N days:

  ```bash title="stale-runbooks.sh"
  set -euo pipefail

  MAX_DAYS=180  # change: your allowed age
  cutoff=$(date -d "-${MAX_DAYS} days" +%F 2>/dev/null || date -v-${MAX_DAYS}d +%F)

  status=0
  for f in runbooks/*.md; do
    v=$(sed -n 's/^verified: *//p' "$f" | head -1)
    if [ -z "$v" ] || [ "$v" \< "$cutoff" ]; then
      echo "stale or unverified: $f (verified: ${v:-none})"
      status=1
    fi
  done
  exit $status
  ```

  Make it a warning at first and a blocking check on critical runbooks once the backlog is cleared.

- **After use.** The last step of every incident is "did the runbook match reality?" and the postmortem files an action if it did not ([[incident-response]]).

## Pitfalls

- **Trusting the model's own check.** Asking the assistant "is this correct?" is not verification. It has no access to your system.
- **Verifying once and forgetting.** The date is the point. Without a re-check cadence it becomes false.
- **Hiding uncertainty.** If a step is unverified, say so in the text. Responders prefer an honest gap to a confident error.
- **Over-long runbooks.** Link to deeper material instead of pasting it; the page should survive a tired reader.
- **Retrieval without checks.** If runbooks feed an assistant that answers on-call questions, stale pages become stale answers; see [[rag-over-runbooks-for-on-call]].

## Sources

- [kubectl reference](https://kubernetes.io/docs/reference/kubectl/), Kubernetes documentation.
- [gcloud CLI reference](https://cloud.google.com/sdk/gcloud/reference), Google Cloud documentation.
- [Emergency Response](https://sre.google/sre-book/emergency-response/), Site Reliability Engineering, Google.

## Related

- [[incident-response]]: the process runbooks support.
- [[kubernetes-pod-troubleshooting]]: a verified diagnostic runbook to model on.
- [[helm-release-rollback]]: a rollback to link to instead of rewriting.
- [[gke-cluster-upgrade]]: re-verify runbooks after each upgrade.
- [[ai-assisted-incident-response]]: what an assistant may and may not do during an incident.
- [[writing-notes]]: the meaning of `verified`.
- [[rag-over-runbooks-for-on-call]]: retrieval over these runbooks.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
