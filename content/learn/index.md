---
title: Learning path
description: Fifty-three lessons from first job to middle level in DevOps, in stages with milestones, a self-assessment and a weekly plan.
tags:
  - learning
  - meta
created: 2026-10-17
modified: 2026-10-19
draft: false
---

This is a structured path for someone who has started a DevOps or platform job, or wants to, and needs to reach the level where they can own a service end to end. It runs in stages. Each stage ends in something you can show, and each lesson is a self-contained page with hands-on exercises you run in your own lab.

## Who it is for and how to use it

It is for people from their first job to middle level: new engineers, developers moving towards operations, and system administrators who want the cloud-native side. It assumes you can use a computer comfortably and have no prior Linux, Kubernetes or cloud knowledge. Where a lesson needs earlier material, it says so in its opening line.

- **Go in order.** Later lessons build on earlier ones. A plan of about 8 to 10 hours a week finishes in about 14 weeks (see the week-by-week map below), or about 18 with the "Going deeper" lessons.
- **Or jump in.** Do the self-assessment below. If you score 3 on every row of a stage, skip that stage's lessons and read only the milestone. At 2, do the exercises as a test. Start at the first stage where you score below 3.
- **Do the exercises.** Reading is not learning. Every lesson has numbered exercises with expected output and an "If you see something else" line for when it goes wrong.
- **Keep a notes file** with the commands that worked. It becomes your own runbook.

> [!warning] The lab-first rule
> Everything in this path runs in your lab, never on production or on a shared team system. The first lesson, [[learn/lab-setup|Start 01: Set up your lab]], builds a disposable Linux machine, local tools and a budgeted Google Cloud sandbox project. Do it before anything else. Cloud steps can cost money, and each says so and prints its cleanup command.

**What "middle level" means here.** A middle engineer owns a service end to end: they can ship a change through CI to Kubernetes on GCP, define the infrastructure as code, watch it with dashboards and alerts, take the pager, and write the postmortem. They work with little supervision on well-understood problems and ask early on new ones. The full expectations by level are in [[management/career-ladder-devops|the career ladder]].

> [!note] How the lessons are written
> Every lesson has the same shape: an opening callout with the level, time, prerequisites and lab; what you will learn; concept sections; hands-on exercises; common mistakes; check-your-understanding questions with folded answers; next steps; and sources. Time estimates are rough. Facts that depend on a tool version are flagged "Check before relying on this" or "verify for your version"; check them before relying on them.

Level chips: `junior` can be done without prior experience of the topic; `junior-middle` needs the earlier stages and takes more thought; `middle` is the level of independent work, with trade-offs and judgement.

## Stage 0: Start

**Goal:** a safe, repeatable place to practise.

- `junior` [[learn/lab-setup|Start 01: Set up your lab (and the homelab ladder)]]

## Stage 1: Linux

**Goal:** work comfortably on a Linux host: files, users, text, processes and services.

- `junior` [[learn/linux-shell-and-filesystem|Linux 01: The shell, the filesystem and the command line]]
- `junior` [[learn/linux-users-permissions-sudo-and-ssh|Linux 02: Users, permissions, sudo and SSH]]
- `junior-middle` [[learn/text-and-data-tools|Linux 03: Text and data tools]]
- `junior-middle` [[learn/linux-processes-memory-and-disk|Linux 04: Processes, memory and disk]]
- `junior-middle` [[learn/linux-services-packages-and-scheduled-jobs|Linux 05: Services, packages and scheduled jobs]]

**Going deeper:**

- `middle` [[learn/linux-performance-triage-with-mpstat-pidstat-sar-and-psi|Linux 06: Performance triage with mpstat, pidstat, sar and PSI]]

**Homelab P1** after this stage: a VM with nginx, a systemd unit and a restore checked by checksum (see [[learn/lab-setup#The homelab ladder|the ladder]]).

## Stage 2: Networking

**Goal:** explain how a request travels from a browser to a server, and find where it breaks.

- `junior` [[learn/network-layers-tcp-and-udp|Networking 01: Network layers, TCP and UDP]]
- `junior` [[learn/ip-addressing-and-subnets|Networking 02: IP addressing and subnets]]
- `junior-middle` [[learn/dns-resolution|Networking 03: DNS resolution]]
- `junior-middle` [[learn/http-and-tls|Networking 04: HTTP and TLS]]
- `middle` [[learn/load-balancers-firewalls-and-network-troubleshooting|Networking 05: Load balancers, firewalls and network troubleshooting]]

## Stage 3: Git and collaboration

**Goal:** use Git daily without fear, and work through pull requests.

- `junior` [[learn/git-mental-model-and-daily-workflow|Git 01: The mental model and the daily workflow]]
- `junior-middle` [[learn/git-merge-rebase-and-undo|Git 02: Merge, rebase and undo]]
- `junior-middle` [[learn/pull-requests-and-code-review|Git 03: Pull requests and code review]]

## Stage 4: Scripting

**Goal:** automate repetitive work safely.

- `junior` [[learn/bash-scripting-fundamentals|Scripting 01: Bash fundamentals]]
- `junior-middle` [[learn/safe-bash-scripts|Scripting 02: Safe Bash scripts]]
- `junior-middle` [[learn/python-for-ops|Scripting 03: Python for ops]]

> [!tip] Milestone M1: you can work on a Linux host, script safely and collaborate in Git
> **Evidence:** a Git repository with a small ops script (it passes `shellcheck`, takes arguments, has a dry-run mode and a non-zero exit on failure), merged through a pull request that someone else reviewed; and P1 working, with a restore verified by checksum.

## Stage 5: Containers

**Goal:** understand what a container is and build, run and debug one.

- `junior` [[learn/containers-under-the-hood|Containers 01: What a container really is]]
- `junior-middle` [[learn/running-and-debugging-containers|Containers 02: Running and debugging containers]]
- `junior-middle` [[learn/building-and-shipping-images|Containers 03: Building and shipping images]]
- `junior-middle` [[learn/container-storage-networking-and-compose|Containers 04: Storage, networking and Compose]]

**Going deeper:**

- `junior-middle` [[learn/image-build-speed-cache-mounts-and-measurement|Containers 05: Faster image builds with measurement and BuildKit mounts]]

**Homelab P2** after this stage: Compose, a reverse proxy and TLS from a local CA.

## Stage 6: Kubernetes

**Goal:** run an app on Kubernetes, expose it, configure it, observe it and roll it back.

- `junior` [[learn/kubernetes-architecture-and-kind|Kubernetes 01: Architecture, kind and kubectl]]
- `junior-middle` [[learn/kubernetes-pods-and-deployments|Kubernetes 02: Pods and Deployments]]
- `junior-middle` [[learn/kubernetes-services-and-ingress|Kubernetes 03: Services and ingress]]
- `junior-middle` [[learn/kubernetes-config-secrets-and-namespaces|Kubernetes 04: Config, Secrets and namespaces]]
- `middle` [[learn/kubernetes-probes-resources-and-debugging|Kubernetes 05: Probes, resources and debugging]]
- `middle` [[learn/helm-basics-and-capstone|Kubernetes 06: Helm basics and the capstone]]

**Going deeper:**

- `middle` [[learn/rbac-roles-bindings-and-least-privilege|Kubernetes 07: RBAC, least privilege and a first audit]]
- `middle` [[learn/helm-chart-authoring-schema-dependencies-and-tests|Kubernetes 08: Authoring a reusable Helm chart]]

**Homelab P3** after this stage: a kind or k3s cluster with Helm, ingress and a rollback.

> [!tip] Milestone M2: you can ship a containerised app to Kubernetes, with a rollback you have tested
> **Evidence:** a container image you built, deployed by a Helm chart to your kind cluster with probes and resource requests, reachable through an Ingress or Gateway, and a deliberately broken release that you rolled back. Keep the `helm history` output as proof.

## Stage 7: Google Cloud

**Goal:** use GCP safely: projects, identity, networks, compute and managed Kubernetes.

- `junior` [[learn/gcp-foundations|GCP 01: Foundations (projects, gcloud, billing and Cloud Storage)]]
- `junior-middle` [[learn/gcp-iam-and-service-accounts|GCP 02: IAM and service accounts]]
- `junior-middle` [[learn/gcp-vpc-compute-and-cloud-sql|GCP 03: VPC, Compute Engine and Cloud SQL]]
- `middle` [[learn/gke-for-beginners|GCP 04: GKE for beginners]]

## Stage 8: CI/CD and infrastructure as code

**Goal:** put changes through a pipeline and describe infrastructure in code.

- `junior` [[learn/ci-cd-concepts-and-branching|Delivery 01: CI and CD from the ground up, with branching strategies]]
- `junior` [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02: Your first pipeline in GitLab CI and Jenkins]]
- `middle` [[learn/environments-releases-and-rollbacks|Delivery 03: Environments, releases, approvals and rollbacks]]
- `junior` [[learn/terraform-basics-on-gcp|Delivery 04: Terraform basics with a first GCP project]]
- `middle` [[learn/terraform-state-modules-and-pipelines|Delivery 05: Terraform state, remote backends, modules and pipelines]]

**Going deeper:**

- `junior-middle` [[learn/gitlab-ci-rules-dag-matrix-and-includes|Delivery 06: GitLab CI rules:changes, the needs DAG, matrix and includes]]
- `middle` [[learn/jenkins-agents-configuration-as-code-and-shared-libraries|Delivery 07: Jenkins agents, Configuration as Code and a shared library]]
- `junior-middle` [[learn/artifactory-repositories-access-and-retention|Delivery 08: Artifactory repositories, clients, access and cleanup]]
- `junior-middle` [[learn/sonarqube-basics-first-scan-and-triage|Delivery 09: SonarQube basics, a first scan and triage]]
- `middle` [[learn/terraform-for-each-lifecycle-and-tests|Delivery 10: Terraform for_each, lifecycle rules and terraform test]]

**Homelab P4** after this stage: Terraform, CI and GitOps on one repository.

> [!tip] Milestone M3: it goes through CI, with infrastructure as code on GCP
> **Evidence:** a repository where a merge request runs build, test and lint, deploys a versioned artefact to a non-production environment, and where the GCP resources it needs are created by Terraform from a pipeline, with a plan reviewed before apply and state kept remotely.

## Stage 9: Security

**Goal:** apply the basics that stop the common failures.

- `junior-middle` [[learn/security-basics-for-devops|Security 01: Basics for DevOps]]

## Stage 10: Observability and incidents

**Goal:** see what the system is doing and handle it when it breaks.

- `junior` [[learn/observability-signals-and-dashboards|Observability 01: Signals and dashboards]]
- `junior` [[learn/searching-logs|Observability 02: Searching logs]]
- `junior-middle` [[learn/first-prometheus-alert|Observability 03: Your first Prometheus alert]]
- `junior-middle` [[learn/troubleshooting-method|Incidents 01: A troubleshooting method]]
- `middle` [[learn/on-call-incidents-and-postmortems|Incidents 02: On-call, incidents and postmortems]]

**Going deeper:**

- `middle` [[learn/promql-for-alert-rules-and-recording-rules|Observability 04: PromQL for alert rules and recording rules]]

**Homelab P5** after this stage: Prometheus, Grafana and Loki, plus an alert that fires.

> [!tip] Milestone M4: you can run it, with dashboards, alerts, on-call and a postmortem
> **Evidence:** a dashboard for your service, an alert that fires when you break it on purpose and links to a runbook, a practice incident handled with a timeline, and a blameless postmortem with owned follow-up actions. Then P6, a recovery drill with measured RTO and RPO, closes the loop.

## Stage 11: Next level

**Goal:** know what a middle engineer owns and plan the next 12 months.

- `middle` [[learn/becoming-a-middle-devops-engineer|Career 01: Becoming a middle DevOps engineer]]

## Self-assessment

Score yourself honestly on each row: **0** I have not done it; **1** I have followed a guide; **2** I can do it alone, with the documentation open; **3** the description in the last column is true for me and I could teach it.

| Skill                   | Your score | What 3 looks like                                                                                  | Lesson                                                                        |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Shell and filesystem    |            | You predict what a command with redirects, pipes and quotes does before running it.                | [[learn/linux-shell-and-filesystem\|Linux 01]]                                |
| Users and permissions   |            | You set ownership and modes on purpose, use `sudo` for one command, and log in with SSH keys only. | [[learn/linux-users-permissions-sudo-and-ssh\|Linux 02]]                      |
| Text and data tools     |            | You answer a question about a log or JSON file with `grep`, `awk`, `sed` and `jq` in one pipeline. | [[learn/text-and-data-tools\|Linux 03]]                                       |
| Processes and resources |            | You find what is using the CPU, memory or disk, and say why.                                       | [[learn/linux-processes-memory-and-disk\|Linux 04]]                           |
| Services and scheduling |            | You run a service under systemd, read its journal and schedule a job.                              | [[learn/linux-services-packages-and-scheduled-jobs\|Linux 05]]                |
| Network model           |            | You explain TCP versus UDP and where a failure sits in the layers.                                 | [[learn/network-layers-tcp-and-udp\|Networking 01]]                           |
| Addressing              |            | You work out a subnet's range and size by hand and choose non-overlapping ranges.                  | [[learn/ip-addressing-and-subnets\|Networking 02]]                            |
| DNS and TLS             |            | You trace a name lookup and read a certificate chain to find the cause of a failure.               | [[learn/dns-resolution\|Networking 03]]                                       |
| Network troubleshooting |            | You localise a connection failure to DNS, routing, firewall or the application.                    | [[learn/load-balancers-firewalls-and-network-troubleshooting\|Networking 05]] |
| Git daily work          |            | You commit in clean steps, rebase a branch and recover from a mistake with the reflog.             | [[learn/git-merge-rebase-and-undo\|Git 02]]                                   |
| Code review             |            | You open small pull requests and review others' changes with specific, kind comments.              | [[learn/pull-requests-and-code-review\|Git 03]]                               |
| Safe scripting          |            | Your scripts quote variables, fail loudly, clean up, support a dry run and pass `shellcheck`.      | [[learn/safe-bash-scripts\|Scripting 02]]                                     |
| Python for ops          |            | You write a small command-line tool with arguments, an HTTP call, error handling and a test.       | [[learn/python-for-ops\|Scripting 03]]                                        |
| Containers              |            | You write a small, non-root Dockerfile and debug a container that will not start.                  | [[learn/building-and-shipping-images\|Containers 03]]                         |
| Kubernetes workloads    |            | You deploy, expose and configure an app, and debug a Pod stuck in `Pending` or `CrashLoopBackOff`. | [[learn/kubernetes-probes-resources-and-debugging\|Kubernetes 05]]            |
| Helm                    |            | You package an app as a chart, upgrade it and roll back.                                           | [[learn/helm-basics-and-capstone\|Kubernetes 06]]                             |
| GCP identity            |            | You give a workload the least privilege it needs with a service account and no downloaded key.     | [[learn/gcp-iam-and-service-accounts\|GCP 02]]                                |
| CI/CD                   |            | You build a pipeline with stages, caching and a manual production gate, and you explain each part. | [[learn/first-pipeline-gitlab-ci-and-jenkins\|Delivery 02]]                   |
| Terraform               |            | You write a module, review a plan and manage remote state without editing state by hand.           | [[learn/terraform-state-modules-and-pipelines\|Delivery 05]]                  |
| Security basics         |            | You keep secrets out of Git, scan for them and rotate one that leaks.                              | [[learn/security-basics-for-devops\|Security 01]]                             |
| Observability           |            | You build a dashboard from the golden signals and search logs for one request.                     | [[learn/observability-signals-and-dashboards\|Observability 01]]              |
| Alerting                |            | You write an alert on user impact, test it and attach a runbook.                                   | [[learn/first-prometheus-alert\|Observability 03]]                            |
| Incident response       |            | You lead a small incident, keep a timeline and write a blameless postmortem.                       | [[learn/on-call-incidents-and-postmortems\|Incidents 02]]                     |

How to read your result: mostly 0s and 1s, start at the beginning. Mostly 2s in a stage, skim its lessons and do their exercises as a test. A 3 means you can skip.

## Week-by-week map

This folds a 14-week plan onto the stages, at about three lessons a week. The homelab projects take extra time (plan a few hours each, on top of the weekly hours); they are marked where they fit. All times are estimates, not measured.

| Week | Lessons        | Focus                                        | Also                 |
| ---- | -------------- | -------------------------------------------- | -------------------- |
| 1    | 01, 02, 03     | Lab, shell and filesystem, users and SSH     |                      |
| 2    | 04, 05, 06     | Text tools, processes, services              | P1 homelab           |
| 3    | 07, 08, 09     | Layers, addressing, DNS                      |                      |
| 4    | 10, 11, 12     | HTTP and TLS, load balancers, Git basics     |                      |
| 5    | 13, 14, 15     | Merge and rebase, pull requests, Bash        |                      |
| 6    | 16, 17, 18     | Safe scripts, Python, containers             | M1 check             |
| 7    | 19, 20, 21     | Running, building, Compose                   | P2 homelab           |
| 8    | 22, 23, 24     | Kubernetes architecture, workloads, services |                      |
| 9    | 25, 26, 27     | Config, probes, Helm                         | P3 homelab, M2 check |
| 10   | 28, 29, 30     | GCP foundations, IAM, networks               |                      |
| 11   | 31, 32, 33     | GKE, CI/CD concepts, first pipeline          |                      |
| 12   | 34, 35, 36     | Releases, Terraform                          | P4 homelab, M3 check |
| 13   | 37, 38, 39     | Security, signals, logs                      |                      |
| 14   | 40, 41, 42, 43 | Alerting, troubleshooting, on-call, career   | M4 check, P5 homelab |

After week 14, do P6 (the recovery drill) and repeat the self-assessment. Lesson numbers count from 01 for the lab setup through 43 for the career lesson, in the stage order above; the "Going deeper" lessons are not numbered in this map.

**Weeks 15 to 18 (optional, going deeper):** week 15, Linux 06, Containers 05 and Kubernetes 07; week 16, Kubernetes 08, Delivery 06 and Delivery 07; week 17, Delivery 08, Delivery 09 and Delivery 10; week 18, Observability 04 and the self-assessment again. Times are estimates, not measured.

## Using AI while learning

> [!tip] Using AI while learning
> An AI assistant is useful for explaining a concept a different way, for reviewing a script or manifest you wrote, and for asking "what would break this?". It is a poor substitute for running the command yourself: ask it, then verify in your lab. Never paste secrets, customer data, internal hostnames or real configuration from your employer into an AI tool, and treat generated commands as untrusted until you understand them. For the owner's catalogue of AI skills, see <https://ai.szolotov.com>. The team's view on AI is in [[ai/index|the AI section]].

Related: [[ai/index|AI in DevOps]], <https://ai.szolotov.com>.

## After this path

When you can do the milestone evidence without a guide, the senior sections go deeper on the same subjects. They are written for people who run these systems in production:

- [[patterns/index|Patterns]] for tested ways of building things, such as [[patterns/zero-downtime-deployments-kubernetes]] and [[patterns/gke-workload-identity]].
- [[runbooks/index|Runbooks]] for operating and recovering, such as [[runbooks/incident-response]] and [[runbooks/kubernetes-pod-troubleshooting]].
- [[tools/index|Tools]] for comparisons such as [[tools/gitlab-ci-vs-jenkins]] and [[tools/helm-vs-kustomize]].
- [[architecture/index|Architecture]] for reference designs on GCP, and [[compliance/index|Compliance]] for evidence and controls.
- [[standards/index|Standards]] such as [[standards/code-review]] and [[standards/blameless-postmortems]], and [[adr/index|Decision records]].
- [[management/index|Management]] for the people side, including [[management/career-ladder-devops]] and [[management/onboarding-engineers]].
