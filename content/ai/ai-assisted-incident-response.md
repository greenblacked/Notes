---
title: AI-assisted incident response, what to automate and what never to
description: How to use AI assistants during incidents and postmortems with read-only access, evidence-first prompts and a clear list of actions that always need a human.
type: guide
tags:
  - ai
  - incident-management
  - on-call
  - kubernetes
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This guide is for senior DevOps engineers and on-call responders who want to use an AI assistant during incidents without handing it the pager. It covers where an assistant helps (summaries, correlation, drafts), the actions that always stay with a human, how to give it read-only access, and how to prompt it with evidence. It does not cover the incident process itself ([[runbooks/incident-response]]), the postmortem practice ([[standards/blameless-postmortems]]), or how to secure agents in pipelines and cloud accounts ([[ai/securing-ai-agents-in-ci-and-cloud]]).

> [!info] Scope and sources
> Written for a GKE and GCP stack with Helm releases, using generic "AI assistant" wording rather than any product. The kubectl, helm and gcloud commands follow the public documentation at [kubernetes.io](https://kubernetes.io/docs/reference/kubectl/), [helm.sh](https://helm.sh/docs/helm/helm_history/) and [cloud.google.com](https://cloud.google.com/logging/docs/reference/tools/gcloud-logging). Check flags against the versions you run.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the exact `gcloud logging read` flags and the RBAC resource names for your cluster version. Vendor incident-tool AI features are deliberately not named because they change often. Check them before relying on them.

## Where it helps

An assistant is good at reading a lot of text quickly and bad at knowing what is true about your system. Use it for the first and keep a human for the second.

| Task                                     | Automation level               | Guardrail                                                           |
| ---------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| Summarise a burst of alerts              | Automatic, read-only           | Link every claim to an alert ID so a human can open it              |
| Correlate deploys with an error spike    | Assisted                       | Give it the deploy list and the graph window; human confirms        |
| Draft an incident timeline               | Assisted                       | Timestamps come from evidence you pasted, not from the model        |
| Draft a status update for stakeholders   | Assisted                       | Incident commander edits and sends; nothing is posted automatically |
| Suggest next diagnostic commands         | Assisted, human runs them      | Read-only commands only; you copy and run                           |
| Search past incidents and runbooks       | Automatic, read-only           | Show the source note so the answer can be checked                   |
| Draft the postmortem                     | Assisted                       | Facts reviewed by the people who were there                         |
| Execute remediation (rollback, scale...) | Not automated during incidents | A human runs it and records who and why                             |

## Never without a human

These actions change production state or are hard to undo. An assistant may propose them with a reason; a person decides, runs them and takes responsibility.

- Rollback or roll-forward of a release ([[runbooks/helm-release-rollback]]).
- Rotating, revoking or reading secrets ([[runbooks/leaked-credential-rotation]]).
- DNS, load balancer, firewall rule and IAM changes.
- `terraform apply`, `terraform destroy` or state operations.
- Scaling, resizing, failing over or restoring data stores.
- Deleting pods, namespaces, volumes, buckets or snapshots.
- Posting to customers or on a public status page.
- Declaring the incident resolved.

Two reasons hold up under pressure. First, the assistant has no accountability and no view of what else is happening at the same time. Second, an incident is exactly when its inputs are most likely to be wrong, incomplete or hostile (see log injection below).

## Read-only access design

Give the assistant its own identity, separate from any human or CI identity, and make the default "can look, cannot touch". For reusable skills and workflows, see [the owner's AI skills catalogue](https://ai.szolotov.com); keep the access rules below regardless of which skill or tool you pick.

Design rules:

- One service account per assistant, with no cluster-admin and no `secrets` access.
- Namespace-scoped RoleBindings where possible; a ClusterRole only for what truly spans namespaces.
- No `pods/exec`, `pods/portforward`, `pods/attach` or `*/proxy` verbs. These read data from inside workloads and are effectively write-capable.
- Short-lived credentials (Workload Identity, not exported keys); see [[patterns/gke-workload-identity]].
- Log every request the assistant makes with its identity, so the postmortem can show what it saw.
- Prefer a pre-built evidence file over live access: a script collects, a person reviews, then the assistant reads the file.

```yaml title="incident-assistant-rbac.yaml"
# Read-only access for an AI assistant. Change: the namespace (shop), the
# service account name and the GCP identity binding to match your setup.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: incident-assistant
  namespace: shop
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: incident-assistant-read
  namespace: shop
rules:
  - apiGroups: [""]
    resources: ["pods", "events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: incident-assistant-read
  namespace: shop
subjects:
  - kind: ServiceAccount
    name: incident-assistant
    namespace: shop
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: incident-assistant-read
```

The role has no `pods/log` subresource on purpose: logs can contain customer data and instructions from outsiders. Add `pods/log` only if you accept that, and prefer the redacted evidence bundle below.

Check what the account can and cannot do before the first incident:

```bash
set -euo pipefail

NAMESPACE="shop"  # change: the namespace to test
SA="system:serviceaccount:${NAMESPACE}:incident-assistant"

kubectl auth can-i list pods -n "$NAMESPACE" --as "$SA"          # expect: yes
kubectl auth can-i get secrets -n "$NAMESPACE" --as "$SA"        # expect: no
kubectl auth can-i create pods/exec -n "$NAMESPACE" --as "$SA"   # expect: no
kubectl auth can-i delete deployments -n "$NAMESPACE" --as "$SA" # expect: no
```

### Evidence bundle script

Running one reviewed script is safer than letting an assistant improvise commands. A responder runs it, looks at the file, then shares it.

```bash title="collect-evidence.sh"
set -euo pipefail

NAMESPACE="shop"            # change: namespace of the affected service
DEPLOYMENT="checkout"       # change: deployment name
RELEASE="checkout"          # change: Helm release name
PROJECT_ID="my-project"     # change: GCP project that holds the logs
WINDOW="30m"                # change: how far back to look
OUT="evidence-$(date -u +%Y%m%dT%H%M%SZ).txt"

{
  echo "## collected at $(date -u +%FT%TZ) by $(whoami)"

  echo "## events (oldest first)"
  kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp

  echo "## pods"
  kubectl get pods -n "$NAMESPACE" -o wide

  echo "## rollout history"
  kubectl rollout history "deployment/${DEPLOYMENT}" -n "$NAMESPACE"

  echo "## helm history"
  helm history "$RELEASE" -n "$NAMESPACE" --max 10

  echo "## error logs, last ${WINDOW}"
  gcloud logging read \
    "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"${NAMESPACE}\" AND severity>=ERROR" \
    --project "$PROJECT_ID" --freshness "$WINDOW" --limit 200 --format "value(timestamp,textPayload)"
} > "$OUT" 2>&1

echo "Wrote $OUT. Review and redact it before sharing."
```

Review the file for tokens, emails and customer identifiers before it goes to any external provider.

## Prompting with evidence

Paste the evidence, say what you want, and ask the assistant to tell you how it could be wrong. A good prompt gives it facts and forbids guessing about what it cannot see.

- State the symptom, the time window and what changed (deploys, config, traffic).
- Paste the evidence bundle, not a description of it.
- Ask for hypotheses ranked by likelihood, each with the evidence for it and the observation that would disprove it.
- Ask for the cheapest read-only check per hypothesis.
- Tell it to say "not in the evidence" when it does not know.

Then do the checks yourself and feed the results back. The model proposes, the evidence decides.

For stakeholder updates, a fixed template keeps the tone calm and the facts bounded (see [[management/stakeholder-communication]] for wording):

```text
You are drafting an incident status update. Use only the facts below.
If a fact is missing, write "unknown" instead of guessing.

Service: <SERVICE_NAME>
Impact: <WHO IS AFFECTED AND HOW, in plain words>
Started: <UTC TIME>
Current status: <investigating | identified | mitigating | monitoring | resolved>
What we know: <FACTS FROM THE EVIDENCE>
What we are doing: <ACTIONS A HUMAN HAS TAKEN OR STARTED>
Next update at: <UTC TIME>

Write 4 sentences or fewer. No root cause claims unless listed under
"What we know". No apologies beyond one line. Do not promise a fix time.
```

The incident commander edits the draft and sends it.

## Postmortem drafting

After the incident, an assistant is useful for turning raw material into a first draft:

- Give it the chat export, alert timeline and deploy list, and ask for a timeline table with a source per row.
- Ask for contributing factors as questions to the team, not as conclusions.
- Ask it to list gaps: moments with no evidence, decisions with no recorded reason.
- Ask for action items phrased as testable changes, then pick owners yourself.

Keep the blameless rules from [[standards/blameless-postmortems]]: tell the assistant to describe systems and decisions, not individuals. The people who were there review every fact before it is published.

## Pitfalls

- **Hallucinated root causes.** A fluent, confident explanation is not evidence. Require a pointer to a log line, metric or diff for each claim, and treat anything without one as a hypothesis.
- **Log injection.** Logs, error messages, ticket text and commit messages can contain text that reads like an instruction to the assistant. Treat all of it as data, never as commands, and keep the assistant's access read-only so an injection cannot do damage.
- **Leaking customer data.** Evidence pasted into an external provider may include personal data, tokens or internal hostnames. Redact first, use only approved providers, and check your data processing terms.
- **Anchoring.** The first hypothesis from the assistant tends to become the team's hypothesis. Ask for alternatives explicitly.
- **Skipping the runbook.** The assistant is not a replacement for [[runbooks/kubernetes-pod-troubleshooting]]. Use it to speed up the steps, not to skip them.
- **Silent actions.** Any tool that can run commands for you will, eventually, run the wrong one. Keep command execution with the human on call.

> [!note] The incident commander decides
> The assistant gives input; the incident commander makes the calls and owns the outcome. If the assistant and the evidence disagree, the evidence wins. Start with the narrow uses above and widen only after a few incidents show they help.

## Related

- [[runbooks/incident-response]]: the process the assistant supports but does not run.
- [[standards/blameless-postmortems]]: how to review and publish the drafted postmortem.
- [[runbooks/kubernetes-pod-troubleshooting]]: the diagnostic steps to follow with or without help.
- [[runbooks/helm-release-rollback]]: a rollback is a human action; this is how to do it.
- [[ai/securing-ai-agents-in-ci-and-cloud]]: the wider controls for agents with cloud access.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
