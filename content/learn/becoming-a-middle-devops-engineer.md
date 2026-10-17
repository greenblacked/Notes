---
title: "Career 01: Becoming a middle DevOps engineer: ownership, certifications and interviews"
description: What a middle DevOps engineer owns end to end, how to measure it with SLOs and DORA metrics, and how to prepare for certifications and interviews with a lab-first plan.
type: guide
tags:
  - learning
  - career
  - reliability
  - kubernetes
  - terraform
  - gcp
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: middle | Time: about 8 h, then weeks of practice | You need: [[learn/on-call-incidents-and-postmortems|Incidents 02: On-call, incidents and postmortems]] and most of the earlier lessons | Lab: Lab B (the kind cluster `lab`) and Lab A, from [[learn/lab-setup|Start 01: Set up your lab]]; the Terraform exercise needs Terraform or OpenTofu installed

This is the last lesson of the path. It does not teach one more tool. It describes what changes when you go from a junior engineer who completes tasks to a middle engineer who owns outcomes, and it gives you practical drills for the two moments where that shows: certifications and interviews.

The roadmap and the week-by-week plan live in [[learn/index|the learning path index]], so they are not repeated here.

## What you will learn

- What "owning a service end to end" means in concrete, checkable parts.
- How to tell a one-way door decision from a two-way door decision, and how to write a short design doc.
- How to define an SLI, an SLO and an error budget, and how to compute them for your own service.
- How to use the DORA metrics, cost and capacity numbers, and a decision record as part of ordinary work.
- How to mentor, review infrastructure pull requests, give stakeholders updates and say no with numbers.
- What certifications prove and do not prove, a study order, and how to prepare for them with labs.
- How a technical interview is scored, with a scenario bank, system design basics, STAR answers and a mock-interview rubric.

## What changes from junior to middle

A junior engineer is given a task and finishes it well. A middle engineer is given a **problem** and is responsible for the **result**, including the parts nobody wrote down. The tools are the same. What differs is the scope of what you answer for.

| Junior                           | Middle                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Completes the ticket             | Checks that the ticket solved the problem, and follows up when it did not                |
| Asks "how do I do this?"         | Brings options with trade-offs and a recommendation                                      |
| Fixes the failing job            | Asks why the job was fragile and fixes the class of problem                              |
| Works when the system is healthy | Is trusted on call, and keeps the system healthy before it fails                         |
| Needs review of most changes     | Reviews others' changes, and knows which of their own changes need a second pair of eyes |
| Reports status when asked        | Reports early, including bad news, with a plan                                           |

None of this is about speed or about knowing more commands. The team's ladder describes the expectations by level; read [[management/career-ladder-devops]] and compare it with your own evidence.

## What a middle engineer owns

"Owning" a service is not about control. It means that when something about the service is wrong, you are the person who notices and acts, whether or not you wrote the code. A useful way to make that concrete is an **ownership sheet**: one page per service that lists what exists, who is responsible and where the gaps are.

| Part          | The question the sheet answers                                    | Evidence a reviewer can check                          |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Pipeline      | Does every change go through CI/CD with tests and a rollback?     | A pipeline link, a recent run, the rollback command    |
| Environments  | Are dev, staging and production defined as code and kept in sync? | The repository path and the last drift check           |
| SLO           | What does "working" mean for users, as a number?                  | The SLO, the SLI query and the current budget          |
| Dashboards    | Can anyone see the golden signals in one place?                   | A dashboard link                                       |
| Alerts        | Do alerts fire on user pain, each with an owner and a runbook?    | The alert rules, with tests and `runbook_url`          |
| Runbook       | Could a new on-call person handle the top three alerts alone?     | A runbook link, tested by someone who did not write it |
| On-call       | Who is paged, with what escalation, and is the load sustainable?  | The rota and the last quarter's page count             |
| Cost tag      | Can the cost of this service be seen and attributed?              | Labels on resources and a cost report                  |
| Access review | Who can change this service, and is each access still needed?     | The last access review date and its result             |

The sheet is only useful if you **ticket the gaps**. A gap you know about and never record is a risk you silently accepted. If you want an independent check of the whole list, [[standards/production-readiness-review]] describes how a team reviews a service before it carries real traffic.

## Decisions: one-way and two-way doors

A **two-way door** decision can be reversed cheaply: a feature flag, a dashboard layout, an internal tool's name. Make these quickly, with little ceremony, and correct them later if needed.

A **one-way door** decision is costly or impossible to reverse: choosing a database engine, changing how production data is stored, deleting data, opening a firewall to the internet, signing a long contract. Slow down for these. Write down the options and the rollback plan, ask for review and wait for it.

Most people err in one of two ways: they treat every decision as one-way, and the team stalls, or they treat a one-way decision as a quick change, and the team regrets it. Part of being a middle engineer is classifying the decision correctly before you act, and saying which kind it is when you ask for review.

### A short design doc

For a one-way or large decision, write a short design doc. One page is usually enough. The skeleton below is the same shape as an architecture decision record ([[adr/template]]).

```markdown
# <Title: the decision, not the problem>

## Context

What is the situation and why now? Facts, numbers, links. Who is affected?

## Goals and non-goals

Goals: what must be true when this is done (measurable where possible).
Non-goals: what this deliberately does not solve, so nobody assumes it does.

## Options

For each option: how it works, cost, risk, effort, and what it makes hard later.
Always include "do nothing" so its cost is visible.

## Decision

The option chosen and the main reasons, in two or three sentences.

## Rollback

How to undo this, how long it takes, and the point after which it cannot be undone.

## Open questions

What is not known yet and who will find out.
```

Once a decision is accepted, record it. The ADR process in this knowledge base is described in [[adr/index]], with an example in [[adr/0001-gitops-with-argocd]].

## Reliability numbers: SLI, SLO and error budget

Three terms turn "the service should be reliable" into something you can measure and negotiate.

- **SLI** (service level indicator): a measurement of what users experience. For an API, a common one is availability: the share of requests that succeed, or `1 - (error requests / all requests)`.
- **SLO** (service level objective): the target for that SLI over a time window, for example "99.9% of requests succeed over 30 days".
- **Error budget:** the amount of failure the SLO allows, which is `1 - SLO`. At 99.9% over 30 days the budget is 0.1% of the window.

For time, the arithmetic is: 30 days is 30 x 24 x 60 = 43,200 minutes, and 0.1% of that is 43.2 minutes. So a service with a 99.9% availability SLO can be fully unavailable for 43.2 minutes in 30 days. For a request-based SLI the budget is a share of requests, and the same idea holds.

The budget is useful because it turns a debate into a number. While budget remains, the team can ship changes faster and take risks. When the budget is used up, the team slows risky changes and spends time on reliability until it recovers. The policy for that is in [[standards/error-budget-policy]]. Alerting on how fast you spend the budget is in [[patterns/slo-burn-rate-alerting]].

> [!warning] Check before relying on this
> The numbers here are examples. Real SLOs come from what users need and what the service can sustain, set together with the people who depend on it. Avoid 100%: it leaves no budget, and every change then breaks the promise.

### An SLI in PromQL

With the same counter as in [[learn/first-prometheus-alert|Observability 03]], availability over 30 days and the share of the budget left are:

```yaml title="slo.yml"
groups:
  - name: payments-slo
    rules:
      - record: payments:availability:ratio_30d
        expr: |
          1 - (
            sum(increase(http_requests_total{service="payments", status=~"5.."}[30d]))
            /
            sum(increase(http_requests_total{service="payments"}[30d]))
          )
      - record: payments:error_budget_remaining:ratio_30d
        expr: |
          1 - (
            (1 - payments:availability:ratio_30d) / (1 - 0.999)
          )
```

The second rule says: the error ratio so far, divided by the allowed error ratio (0.1%), is the share of the budget used; one minus that is what remains. A value of `0.5` means half of the budget is left, and a negative value means the SLO is already broken for the window. The `0.999` is the SLO target: change it to yours.

> [!note] A 30-day query is heavy
> A query over `[30d]` reads a lot of data. In production, calculate the ratio from shorter windows (recording rules over 5 minutes) and aggregate those, or use your monitoring tool's SLO feature. The version above is for learning and for a small lab.

## DORA metrics for your own pipeline

The DORA research programme identified a small set of measures of software delivery performance: how often you deploy, how long a change takes from commit to production, how often changes fail, and how fast you recover. They are best used for **your team's own trend** and to find the bottleneck, not to compare teams with each other or as a target for individuals. For a middle engineer, the practical step is to find where each number comes from in your pipeline (the CI system and the deploy history for the first two, the incident record for the other two) and to look at the trend once a month. Metric names and definitions have changed between reports; read [[management/dora-metrics]] and the current pages at <https://dora.dev/> before quoting a definition.

## Cost and capacity

Owning a service includes knowing what it costs and when it will run out of room.

- **Cost.** Put the same labels on every resource of the service (service, team, environment) so a cost report can group by them. Look at the monthly trend and at the biggest items. Ask what you would remove if the bill had to halve. The architecture view is in [[architecture/finops-cost-allocation-and-guardrails]].
- **Capacity.** Know the current peak load, the load at which the service degrades (measured, not guessed) and how long it takes to add capacity. Plan growth with a margin, and test the plan with a load test ([[patterns/load-and-performance-testing]]).

## Working with people

### Mentoring juniors and reviewing infrastructure pull requests

Teaching is part of the job. Pair on a real task, let the junior drive and explain your thinking aloud. Review their work to help them learn, not to prove you are right: ask questions ("what happens if this value is empty?"), point to docs, and separate "must fix" from "nice to have". When you review an infrastructure change (Terraform, Helm, pipeline), check what the diff does to **running systems**: a plan that replaces a resource, a rule that opens a port, a missing rollback, a secret in plain text. [[standards/code-review]] and [[learn/pull-requests-and-code-review|Git 03]] have the details, and [[management/onboarding-engineers]] shows how a team brings new people in.

### Stakeholder updates and saying no with numbers

Stakeholders want to know three things: what is the situation, what do you need from them, and when will they hear next. Give the bad news early, with the plan.

When you have to say no, say it with a number and an alternative. Compare:

- "We can't do that, it's too risky."
- "That change needs about 3 weeks of work and would use roughly half of this quarter's error budget if the rollout goes badly. I can do a smaller version in 1 week that covers the main case. Which do you prefer?"

A "no" with a reason, a cost and a smaller offer keeps the relationship and gives the other person a real choice. More on this in [[management/stakeholder-communication]].

## Certifications

A certification is **evidence that you learned a defined body of knowledge and could use it under exam conditions**. It is not evidence that you can run production, and it is not a substitute for experience. Used well, it gives you a structure to study and a signal for people who do not know you.

| Certification                                     | What it proves                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| HashiCorp Terraform Associate                     | You know Terraform concepts, workflow and state at a basic level                   |
| Google Cloud Associate Cloud Engineer (ACE)       | You can deploy and operate workloads on Google Cloud with the console and `gcloud` |
| Certified Kubernetes Administrator (CKA)          | You can install, configure, troubleshoot and operate a cluster, in a live terminal |
| Certified Kubernetes Application Developer (CKAD) | You can build, configure and expose applications on Kubernetes, in a live terminal |
| Google Cloud Professional Cloud Architect (PCA)   | You can design cloud solutions and reason about trade-offs                         |

A suggested order for a DevOps engineer on this stack is: **Terraform Associate or Google Cloud ACE first** (a gentle start that matches the lessons you have done), then **CKA**, then **CKAD or PCA**, depending on whether your work is more application delivery or more design. Google Cloud also offers a Professional Cloud DevOps Engineer certification; check its current guide, because it fits this path well.

> [!warning] Check before relying on this
> Exam names, versions, domains and their weightings, prices, validity periods, the Kubernetes version the CKA and CKAD are based on, and the rules about what you may open during the exam all change. For example, a Terraform Associate exam has been published in numbered versions (003 and a newer one); do not assume which is current. This page states **none** of those details as fact. Before you book, read the official exam guide and the candidate handbook for your exam, and plan from them. The CKA and CKAD are hands-on exams in which a limited set of official documentation is allowed (verify the current list and rules on the Linux Foundation page).

### Study labs-first

1. Download the exam guide and list its domains.
2. For each domain, do a lab, not a video. You have already built most of them in this path: Terraform and state ([[learn/terraform-basics-on-gcp|Delivery 04]]), Google Cloud IAM and networking, Kubernetes workloads and troubleshooting.
3. For the Kubernetes exams, practise **speed in a terminal**: create, edit and fix objects with `kubectl` and the official docs open in a browser. Use `kubectl explain` and `--dry-run=client -o yaml` instead of memorising YAML.
4. Take a practice exam under time, review every miss and rebuild the lab for it.
5. Book the real exam only when your practice scores are steady.

## Interviews

### What is scored

Interviewers for an operations role are rarely scoring whether you memorised a command. They score **how you think**: do you clarify the problem, form hypotheses, check them in a sensible order, say what you would look at, explain trade-offs, admit what you do not know and keep calm? This is the troubleshooting method from [[learn/troubleshooting-method|Incidents 01]] spoken aloud. Narrate it. A wrong first guess followed by a good check is a better answer than a right guess with no reasoning.

### A troubleshooting scenario bank

Practise each of these aloud in a lab. For each, name your first three moves and what each result would tell you.

| Scenario                                   | First moves (illustrative)                                                                                | What you are showing                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A Pod is in `CrashLoopBackOff`             | `kubectl get pod`, `kubectl logs --previous`, `kubectl describe pod` (exit code, events)                  | You read evidence before changing anything |
| A Service has no endpoints                 | `kubectl get endpointslices`, compare the Service selector with the Pod labels, check Pod readiness       | You know how Services find Pods            |
| DNS fails inside a Pod                     | `nslookup` from a debug Pod, check `/etc/resolv.conf`, check CoreDNS Pods and logs, test a NetworkPolicy  | You work layer by layer                    |
| `terraform apply` says the state is locked | Find who holds the lock, check whether the run is alive, unlock only when you are sure nobody is applying | You are careful with shared state          |
| A page is slow only for some users         | Is it a cache miss? Compare cache hit ratio, regions and headers; check origin latency                    | You think about caches and edges           |
| Users report a TLS error                   | `openssl s_client` for the chain and expiry date, check the certificate renewal job                       | You know how certificates fail             |
| A node's disk is full                      | `df -h`, then `du` to find the largest directories, check logs and container images                       | You find the source before deleting        |

### System design basics

A design question is "build X for N users". A good answer has a shape:

1. **Clarify** the requirements: users, load, data, availability target, budget, constraints.
2. **Estimate** the numbers with simple arithmetic (below).
3. **Sketch** the main parts and the data flow. Start simple and add complexity only where a number demands it.
4. **Name the trade-offs** and the failure modes: what happens when a zone fails, the database is slow, a deploy goes wrong?
5. **Say how you would operate it:** monitoring, alerts, rollbacks, cost.

**Capacity arithmetic.** Practise this until it is easy. For example: a log pipeline receives 10 million lines a day of about 300 bytes each, kept for 30 days. Raw volume is 10,000,000 x 300 bytes = 3 GB a day, or about 90 GB for 30 days. Compression, indexing and replication change the stored size a lot (and these factors depend on the product, so say that you would measure them), but the first number tells you whether you are designing for gigabytes or for terabytes.

### A worked example: a CI platform for 200 engineers

> [!note] Illustrative
> The assumptions below are chosen for the example. In an interview, state your own assumptions aloud and invite correction.

**Requirements (assumed).** 200 engineers, each pushing about 5 times a day, so about 1,000 pipeline runs a day. Each pipeline has about 3 jobs of about 6 minutes each. Most work happens in an 8-hour window. Availability target: the platform should be usable during working hours; a short outage is acceptable but a day-long one is not.

**Estimate.** The compute is 1,000 x 3 x 6 = 18,000 job-minutes a day, which is 300 job-hours. Spread over 8 hours, the average is 300 / 8 = 37.5 jobs running at once. Work arrives in bursts, so plan for about twice the average at peak: about 75 concurrent jobs. If one job uses 2 vCPU, the peak is about 150 vCPU, which you would not keep running all day.

**Design.** A managed or self-hosted CI controller; ephemeral runners that autoscale (for example on GKE, see [[patterns/gitlab-runners-on-gke]]); a cache for dependencies and a registry or artifact repository close to the runners ([[patterns/artifact-promotion-artifactory]]); pipeline definitions as code ([[patterns/gitlab-ci-pipeline-structure]]); secrets injected at run time, not stored in the repository ([[patterns/external-secrets-with-secret-manager]]).

**Trade-offs and failure modes.** Autoscaling saves money but a slow node start adds minutes to every job at the start of the day, so keep a small warm pool. A shared cache speeds builds but a poisoned cache is a supply-chain risk. A single controller is a single point of failure; decide whether you can accept restoring from backup in an hour or need a standby.

**Operating it.** Track queue time (how long jobs wait for a runner), job success rate and cost per pipeline. Alert on queue time over a threshold, since that is what developers feel.

### STAR answers

Behavioural questions ("tell me about a time when...") are answered well with **STAR**: **S**ituation (the context, briefly), **T**ask (what you were responsible for), **A**ction (what **you** did, in the first person, step by step) and **R**esult (what changed, with a number if you have one, and what you learned). Prepare four or five stories from your lab and work: an incident you handled, a disagreement you resolved, a mistake you made and fixed, something you improved and a time you taught someone. Keep each to about two minutes.

### A mock-interview rubric

Score each criterion from 1 to 4, then write one sentence of evidence for each score.

| Criterion          | 1 (weak)                             | 2                          | 3                                       | 4 (strong)                                            |
| ------------------ | ------------------------------------ | -------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Problem framing    | Starts typing commands, no questions | Asks a few questions       | Clarifies scope, impact and constraints | States the symptom precisely and the success criteria |
| Method             | Random guesses                       | Some order, one hypothesis | Ranked hypotheses, cheap checks first   | Predictions that could fail, bisects, time-boxes      |
| Technical accuracy | Wrong or unsafe advice               | Mostly right with gaps     | Correct, knows the main trade-offs      | Correct, with edge cases and what to verify           |
| Communication      | Hard to follow                       | Clear but no structure     | Structured and checks understanding     | Concise, honest about unknowns, easy to follow        |

### AI tools while you prepare, and in interviews

An AI assistant can be a good study partner: ask it to quiz you, to explain a mistake in your answer, or to propose scenarios. Check what it says against the official docs and your lab, because it can be confidently wrong. Never paste confidential material from your employer. In a real interview, follow the rules you were given; if tools are not allowed, do not use them, and if they are, show how you check the output. The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com); this page makes no claim about its contents.

## Hands-on exercises

1. **Write an ownership sheet for one service, and ticket the gaps.** Pick a service from your lab (the Helm chart from [[learn/helm-basics-and-capstone|Kubernetes 06]] will do). Create a table with the nine parts from "What a middle engineer owns". For each, write the evidence or "none". For every "none" write a ticket title with an outcome and an owner.

   Expected: a table of nine rows, and at least two ticket lines such as:

   ```text
   Gap: no runbook for the three top alerts. Ticket: "Write and test runbooks for HighErrorRatio, PodCrashLooping, DiskFillingSoon". Owner: <name>. Due: <date>.
   Gap: no access review in 12 months. Ticket: "Review who can change the production namespace and remove unused access". Owner: <name>. Due: <date>.
   ```

   If you see something else: if the table is all filled in with no gaps, check the evidence column; "we have one" without a link is not evidence.

2. **Define an SLO, write the SLI in PromQL and compute the budget.** Take the `payments` service from the PromQL above with a 99.9% SLO. First compute the time budget by hand, then check the rules with a unit test.

   ```bash
   echo "minutes in 30 days: $(( 30*24*60 ))"
   python3 -c "print('budget at 99.9%:', 30*24*60*0.001, 'minutes')"
   ```

   Expected:

   ```text
   minutes in 30 days: 43200
   budget at 99.9%: 43.2 minutes
   ```

   Now save the `slo.yml` above and this test, which feeds 2,000 requests an hour, 1 of them an error, for 30 days (an error ratio of 0.05%, so half of the budget is used):

   ```yaml title="slo_test.yml"
   rule_files:
     - slo.yml
   evaluation_interval: 1h
   tests:
     - interval: 1h
       input_series:
         # 2000 requests per hour in total, 1 of them an error: ratio 0.0005.
         - series: 'http_requests_total{service="payments", status="500"}'
           values: "0+1x740"
         - series: 'http_requests_total{service="payments", status="200"}'
           values: "0+1999x740"
       promql_expr_test:
         - expr: round(payments:availability:ratio_30d, 0.0001)
           eval_time: 721h
           exp_samples:
             - labels: "{}"
               value: 0.9995
         - expr: round(payments:error_budget_remaining:ratio_30d, 0.01)
           eval_time: 721h
           exp_samples:
             - labels: "{}"
               value: 0.5
   ```

   ```bash
   promtool check rules slo.yml
   promtool test rules slo_test.yml
   ```

   Expected (`promtool` 2.45.3 on Ubuntu 24.04):

   ```text
   Checking slo.yml
     SUCCESS: 2 rules found

   Unit Testing:  slo_test.yml
     SUCCESS
   ```

   If you see something else: the `round()` calls are there because the recorded series carries a metric name and because floating-point results are never exact; without them the test compares `{__name__="..."}` and a value such as `0.5000000000000555`. If you change the errors to 3 an hour (`0+3x740`) the test fails and shows an availability of `0.9985` and a budget of `-0.5`: the SLO is broken. Install the tools as in [[learn/first-prometheus-alert|Observability 03]].

3. **Write a one-page design doc.** Choose a decision in your lab with a real trade-off (for example "Helm or Kustomize for the lab app", see [[tools/helm-vs-kustomize]]). Use the skeleton above, with at least two options plus "do nothing", and a rollback section.

   Expected: one page with the title and all six section headings, a Decision section of no more than three sentences and a rollback that someone else could follow.
   If you see something else: if the Context section describes the solution, move that to Decision; context states the problem and the forces.

4. **Kubernetes speed drills on the kind cluster.** Time yourself with the docs open. This exercise was **not run** for this page; the outputs are what you should expect, not captured output.

   ```bash
   kubectl create deployment drill --image=nginxinc/nginx-unprivileged:1.27-alpine --replicas=3
   kubectl rollout status deployment/drill
   kubectl get deployment drill
   kubectl scale deployment/drill --replicas=5
   kubectl rollout status deployment/drill
   kubectl get deployment drill
   ```

   Expected (illustrative):

   ```text
   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
   drill   3/3     3            3           25s
   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
   drill   5/5     5            5           50s
   ```

   Then break it and fix it within 5 minutes using only `kubectl`:

   ```bash
   kubectl set image deployment/drill nginx-unprivileged=nginxinc/nginx-unprivileged:no-such-tag
   kubectl get pods -l app=drill
   ```

   The container is named after the image (`nginx-unprivileged`) when created with `kubectl create deployment`. Expect a Pod in `ErrImagePull` or `ImagePullBackOff`. Diagnose with `kubectl describe pod` and `kubectl rollout undo deployment/drill`, then confirm with `kubectl rollout status deployment/drill`. Finish with `kubectl delete deployment drill`.

   If you see something else: if `kubectl set image` says `unable to find container`, list the container name with `kubectl get deployment drill -o jsonpath='{.spec.template.spec.containers[*].name}'`. Your goal in this drill is the time, not the result: write down how long each step took and which one you hesitated over.

5. **Validate a Terraform configuration.** This needs Terraform or OpenTofu on your machine, and it was **not run** for this page. The configuration uses no cloud provider, so it needs no credentials.

   ```hcl title="main.tf"
   terraform {
     required_version = ">= 1.5"
   }

   variable "env" {
     type    = string
     default = "dev"
   }

   locals {
     name = "demo-${var.env}"
   }

   output "name" {
     value = local.name
   }
   ```

   ```bash
   terraform init
   terraform validate
   ```

   Expected:

   ```text
   Success! The configuration is valid.
   ```

   If you see something else: an `Unsupported argument` or `Invalid reference` error names the file and line. With OpenTofu, use `tofu` instead of `terraform` ([[tools/terraform-vs-opentofu]]). `validate` checks syntax and internal consistency only; it does not contact any cloud, so a valid file can still fail on `plan`.

6. **Name the first three commands for `CrashLoopBackOff`.** Without looking, write them in order and say what each tells you.

   Expected:

   ```bash
   kubectl get pod <pod>                # status, restarts, how often
   kubectl logs <pod> --previous        # the run that crashed, not the new empty one
   kubectl describe pod <pod>           # Last State, exit code, events (read from the bottom)
   ```

   If you see something else: if your first command was `kubectl delete pod`, you destroyed the evidence. See [[learn/kubernetes-probes-resources-and-debugging|Kubernetes 05]].

7. **Diagnose a planted selector mismatch.** Create a Service whose selector does not match the Pod labels, then find it as you would in an interview.

   ```yaml title="selector-drill.yaml"
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: sel-drill
   spec:
     replicas: 1
     selector:
       matchLabels:
         app: sel-drill
     template:
       metadata:
         labels:
           app: sel-drill
       spec:
         containers:
           - name: web
             image: nginxinc/nginx-unprivileged:1.27-alpine # example tag; pin the one you use
             ports:
               - containerPort: 8080
             resources:
               requests:
                 cpu: 20m
                 memory: 32Mi
               limits:
                 memory: 64Mi
             securityContext:
               runAsNonRoot: true
               runAsUser: 101
               allowPrivilegeEscalation: false
               capabilities:
                 drop: ["ALL"]
               seccompProfile:
                 type: RuntimeDefault
   ---
   apiVersion: v1
   kind: Service
   metadata:
     name: sel-drill
   spec:
     selector:
       app: sel-drill-typo
     ports:
       - port: 80
         targetPort: 8080
   ```

   ```bash
   kubectl apply -f selector-drill.yaml
   kubectl rollout status deployment/sel-drill
   kubectl get endpoints sel-drill
   kubectl get svc sel-drill -o jsonpath='{.spec.selector}'; echo
   kubectl get pods --show-labels
   ```

   Expected (illustrative; this exercise was **not run** for this page):

   ```text
   NAME        ENDPOINTS   AGE
   sel-drill   <none>      10s
   {"app":"sel-drill-typo"}
   NAME                         READY   STATUS    RESTARTS   AGE   LABELS
   sel-drill-6c7d9f5b8d-abcde   1/1     Running   0          15s   app=sel-drill,pod-template-hash=6c7d9f5b8d
   ```

   Note that the Service still has a cluster IP and resolves in DNS; the problem shows up as a refused or timed-out connection, not as a name error. Fix it and watch the endpoint appear:

   ```bash
   kubectl patch service sel-drill -p '{"spec":{"selector":{"app":"sel-drill"}}}'
   kubectl get endpoints sel-drill
   kubectl delete -f selector-drill.yaml
   ```

   ```text
   NAME        ENDPOINTS         AGE
   sel-drill   10.244.0.5:8080   40s
   ```

   If you see something else: the endpoint address differs on your cluster. On newer Kubernetes versions `kubectl get endpoints` may warn that the Endpoints API is deprecated; `kubectl get endpointslices -l kubernetes.io/service-name=sel-drill` shows the same information (verify for your version).

8. **Do the capacity arithmetic.** Compute the raw volume for 10 million log lines a day at 300 bytes for 30 days, and the CI estimate from the worked example.

   ```bash
   echo "bytes per day: $(( 10000000 * 300 ))"
   echo "bytes for 30 days: $(( 10000000 * 300 * 30 ))  (about 90 GB)"
   python3 -c "print('job-min/day:', 1000*3*6, ' job-hours:', 1000*3*6/60, ' avg concurrent:', 1000*3*6/60/8, ' peak at 2x:', 1000*3*6/60/8*2)"
   ```

   Expected:

   ```text
   bytes per day: 3000000000
   bytes for 30 days: 90000000000  (about 90 GB)
   job-min/day: 18000  job-hours: 300.0  avg concurrent: 37.5  peak at 2x: 75.0
   ```

   If you see something else: a different result means a mistyped number. Redo the multiplication by hand and compare. State your assumptions out loud next time; the number matters less than showing the steps.

9. **Run a 30-minute mock interview with written scores.** Ask a colleague (or an AI assistant, with no confidential material) to act as the interviewer. Give them one scenario from the bank, one capacity question and two STAR questions. Afterwards, both of you score the four criteria from 1 to 4 with a sentence of evidence each.

   Expected: a filled table such as:

   ```text
   Problem framing: 3. Asked who is affected and since when, but not how many.
   Method: 2. Went to logs first without a hypothesis.
   Technical accuracy: 3. Correct on endpoints and selectors; unsure about readiness.
   Communication: 3. Clear, but spoke too fast in the capacity answer.
   Next practice: state a ranked hypothesis list before the first command.
   ```

   If you see something else: if all scores are 4, the interviewer was too kind; ask for the weakest moment. Repeat the mock a week later and compare.

10. **Clean up.**

    ```bash
    kubectl delete deployment drill --ignore-not-found
    kubectl delete -f selector-drill.yaml --ignore-not-found
    ```

    Expected: any leftover objects are deleted, or `kubectl` prints nothing.
    If you see something else: check `kubectl get deployments,services` for names beginning `drill` or `sel-drill`.

## Common mistakes

- **Owning the tasks but not the outcome.** Why it bites: the ticket is closed and the problem remains. Fix: check with the users or the metrics that the problem is gone, and say so.
- **Treating every decision as a one-way door.** Why it bites: the team stalls on small choices. Fix: classify the decision first; decide two-way doors fast.
- **Treating a one-way door as a quick change.** Why it bites: an expensive mistake you cannot undo. Fix: write the options and the rollback, and get review.
- **An SLO of 100%.** Why it bites: there is no budget, so any change or failure breaks the promise. Fix: set the SLO from user need and sustainable effort, such as 99.9%.
- **Using DORA numbers to rank people.** Why it bites: people game the numbers and trust drops. Fix: use them for the team's own trend and to find bottlenecks.
- **Collecting certificates without labs.** Why it bites: you pass nothing, or you pass and cannot do the job. Fix: labs first, then the exam.
- **Memorising commands for interviews.** Why it bites: the interviewer changes one detail and the answer collapses. Fix: practise the method and say your reasoning aloud.
- **A "no" without a number or an alternative.** Why it bites: people hear obstruction. Fix: give the cost, the risk and a smaller option.
- **Pasting confidential material into an AI tool.** Why it bites: it may leave your organisation. Fix: use only tools your organisation has approved, and anonymise anything you share.

## Check your understanding

1. What changes from junior to middle in terms of what you answer for?
2. Why are certificates not proof that you can run production?
3. What do interviewers listen for when you troubleshoot aloud?
4. A service has a 99.9% availability SLO over 30 days. How many minutes of full downtime does the budget allow, and what does a budget of `-0.5` mean?
5. How do you tell a one-way door decision from a two-way door decision, and what do you do differently?
6. You must refuse a request because the team is short of capacity. How do you say no in a way that helps?

> [!question]- Answers
>
> 1. A junior answers for finishing a task. A middle engineer answers for the outcome of a whole service or problem: the pipeline, environments, SLO, dashboards, alerts, runbook, on-call, cost and access, including checking that the work solved the problem and ticketing the gaps.
> 2. A certificate shows that you studied a defined set of knowledge and passed an exam. Production needs judgement under pressure, knowledge of your own systems and a history of keeping them healthy, which an exam does not measure. The certificate helps with structure and as a signal, no more.
> 3. Method more than memory: a clear statement of the problem, ranked hypotheses, cheap checks first, predictions that can fail, calm reasoning, honesty about what you do not know and clear communication.
> 4. 30 x 24 x 60 = 43,200 minutes, and 0.1% of that is 43.2 minutes. A remaining budget of `-0.5` means the service has already used 150% of the budget in the window: the SLO is broken, and the team should slow risky changes and put time into reliability.
> 5. Ask whether it can be reversed cheaply. A two-way door (a flag, a dashboard) is decided quickly and corrected later. A one-way door (a database engine, deleting data, opening a firewall) gets a short design doc with options, a rollback plan and a review before you act.
> 6. Give a reason with a number (the cost and the risk), offer a smaller option or a later date, and ask which the stakeholder prefers. They then have a real choice instead of an obstruction.

## Next steps

You have reached the end of the path. Previous lesson: [[learn/on-call-incidents-and-postmortems|Incidents 02: On-call, incidents and postmortems]].

Go further in the senior sections, which assume what you now know:

- [[management/career-ladder-devops]] to see the expectations for the next level and to collect evidence for them.
- [[management/delegation-and-ownership]] for how ownership is shared and handed on.
- [[management/dora-metrics]] for the delivery metrics and how to use them well.
- [[management/hiring-devops-engineers]] for the interviewer's side of the table, which will help you prepare.
- [[adr/template]] and [[adr/index]] to write your first decision record.
- [[standards/production-readiness-review]] and [[standards/error-budget-policy]] for the team-level versions of the ownership sheet and the budget.
- The AI skills catalogue at [ai.szolotov.com](https://ai.szolotov.com) and [[ai/index|the AI section]] for using AI tools in your work responsibly.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Google SRE book and workbook, on service level objectives: "Service Level Objectives" (https://sre.google/sre-book/service-level-objectives/) and "Implementing SLOs" (https://sre.google/workbook/implementing-slos/).
- DORA, the research programme and its metrics (https://dora.dev/).
- Architectural Decision Records (https://adr.github.io/).
- Linux Foundation, Certified Kubernetes Administrator (https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/) and Certified Kubernetes Application Developer (https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/), including the candidate handbooks.
- Google Cloud certifications (https://cloud.google.com/learn/certification) and HashiCorp certifications (https://developer.hashicorp.com/certifications).
- Kubernetes documentation, "Troubleshooting Applications" (https://kubernetes.io/docs/tasks/debug/debug-application/).
- Run for this page: the time and capacity arithmetic, and the SLO rules and their unit test with `promtool` 2.45.3+ds on Ubuntu 24.04.5 LTS.
- Not verified: every exam name, version, domain, price, validity period and rule (including whether Terraform Associate 003 or a newer version is current, the Kubernetes version under test, and the documentation allowed in the CKA and CKAD), the Google Cloud Professional Cloud DevOps Engineer details, the `terraform validate` output, the kind and `kubectl` drills, the `kubectl get endpoints` deprecation warning, and the CI sizing example, whose assumptions are invented.
