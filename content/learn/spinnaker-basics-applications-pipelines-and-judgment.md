---
title: "Delivery 12: Spinnaker basics: applications, pipelines, Kubernetes manifests and manual judgment"
description: Read and design Spinnaker pipelines with confidence, from applications and server groups to manifest deploys, manual judgment, expressions and rollback.
type: guide
tags:
  - learning
  - spinnaker
  - kubernetes
  - ci-cd
  - delivery
created: 2026-10-21
modified: 2026-10-21
draft: false
---

> [!info] Level: middle | Time: about 3 h | You need: [[learn/environments-releases-and-rollbacks|Delivery 03: Environments, releases, approvals and rollbacks]] and [[learn/helm-basics-and-capstone|Kubernetes 06: Helm basics and the stage capstone]] | Lab: a terminal with `jq`; the core exercises read and design pipeline JSON. Installing Spinnaker yourself is optional and needs a large cluster (see the end)

Spinnaker is a continuous delivery platform: it takes an artifact that CI has built and moves it through environments, with stages such as deploy, wait, check and ask a human. Many organisations still run it, often with years of pipelines in it, so you will meet it even where new work uses something else. The site's decision is explicit: Kubernetes delivery uses Argo CD and Argo Rollouts, and **Spinnaker is not adopted** for new work ([[adr/0017-argo-cd-and-rollouts-not-spinnaker|ADR 0017]]). This lesson is therefore about **working safely with an existing Spinnaker estate**: reading its model, understanding what a pipeline will do before you press Start, changing one without surprises, and rolling back.

The exercises use pipeline JSON rather than a running Spinnaker, because a Spinnaker install is a large system and the skills that matter day to day (reading a pipeline, spotting the stage that is not really gated, choosing a rollback) do not need one.

> [!note] Not run against a Spinnaker instance
> The concepts, stage names and expression syntax follow the Spinnaker documentation; the JSON `type` strings were read from Spinnaker's source code. **Every pipeline JSON on this page is illustrative**: field names and shapes depend on your Spinnaker version. Before you rely on a field, open a real pipeline in your Spinnaker, use "Edit as JSON" and compare. Only the `jq` helper commands were checked, against the JSON on this page.

## What you will learn

- Where Spinnaker sits next to CI and Argo CD, and what its main services do.
- The application, cluster, server group and load balancer model, and how it maps onto Kubernetes.
- How a pipeline is built from triggers, stages, artifacts and parameters, and how stages are ordered in the JSON.
- How Deploy (Manifest), Manual Judgment, Check Preconditions, Wait and Undo Rollout (Manifest) behave, and how expressions connect them.
- How to roll back in Spinnaker, and how its authorisation model and its coexistence with Argo CD work.

## Where Spinnaker fits

Spinnaker is **not CI**. It does not compile code or run unit tests. Jenkins or GitLab CI build and test; Spinnaker picks up the result (a new image in a registry, a finished Jenkins job, a webhook) and orchestrates delivery: deploy to staging, wait, check, ask, deploy to production, roll back if needed.

Compared with Argo CD from [[learn/gitops-with-argo-cd|Delivery 11]]:

| Question                      | Spinnaker                                       | Argo CD                                                    |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Model                         | Push: pipelines run stages that change targets. | Pull: an agent reconciles the cluster to Git continuously. |
| Source of truth for what runs | The last successful pipeline execution.         | The Git repository.                                        |
| Who holds target credentials  | Spinnaker, for every account it deploys to.     | The agent in (or for) each cluster.                        |
| Targets                       | Kubernetes, and also VMs and several clouds.    | Kubernetes.                                                |
| Human approval                | A Manual Judgment stage in the pipeline.        | A pull request review before the merge.                    |

Spinnaker is built from microservices. The names below are the ones you see in logs and in the install; check the architecture page of the docs for your version for the full list and what each one does:

| Service     | Role (one line)                                                                   |
| ----------- | --------------------------------------------------------------------------------- |
| Deck        | The web UI.                                                                       |
| Gate        | The API gateway; the UI, the `spin` CLI and scripts talk to it.                   |
| Orca        | The orchestration engine: runs pipelines and stages.                              |
| Clouddriver | Talks to cloud providers and Kubernetes; caches their state and performs deploys. |
| Front50     | Stores applications, pipelines and their history.                                 |
| Echo        | Events, triggers (cron, webhooks) and notifications. Manual Judgment needs it.    |
| Igor        | Integrates CI systems (Jenkins and others) and polls registries for triggers.     |
| Rosco       | The bakery: VM images, and manifest baking with a renderer such as Helm.          |
| Fiat        | Authorisation.                                                                    |
| Kayenta     | Automated canary analysis (see [[patterns/spinnaker-canary-analysis]]).           |

## The model: applications, clusters, server groups

Spinnaker's vocabulary predates Kubernetes and does not map one to one. From the Concepts page:

- An **application** is a collection of clusters, plus firewalls and load balancers. Typically one per service, and it is where pipelines and permissions live.
- A **cluster** is a logical grouping of server groups. The docs warn that it does **not** map to a Kubernetes cluster; it is a Spinnaker grouping, for example all versions of `web` in one environment.
- A **server group** is the deployable unit: an artifact plus its settings, running as a set of instances. On VMs the instances are machines; on Kubernetes they are Pods.
- A **load balancer** sends traffic to the instances of its server groups; a **firewall** controls access to them.
- An **account** is a set of credentials for a target. For Kubernetes, an account maps to a kubeconfig context, so "deploy to account `k8s-production`" means "use those credentials and that cluster".

With the manifest-based Kubernetes provider, which the docs call the recommended way to deploy to Kubernetes, you deploy ordinary Kubernetes manifests and Spinnaker shows the resulting workloads in this model. How each Kubernetes kind appears in the UI (which kinds are server groups, which are load balancers) is described in the Kubernetes provider reference; it was not checked for this page, so read it for your version before you depend on the UI view.

## Pipelines: triggers, stages, artifacts, parameters

A **pipeline** is a sequence of **stages** inside an application. It starts manually or from a **trigger**: a Jenkins job finishing, a new image in a Docker registry, a cron schedule, a webhook, or another pipeline completing. Parameters let the person or system that starts it pass values (an image digest, a region).

Spinnaker stores each pipeline as JSON, and the UI has "Edit as JSON" for it. The parts you need to read any pipeline:

```json title="pipeline-skeleton.json (illustrative)"
{
  "application": "web",
  "name": "web-to-production",
  "limitConcurrent": true,
  "parameterConfig": [{ "name": "digest", "required": true }],
  "triggers": [],
  "stages": [
    {
      "refId": "1",
      "requisiteStageRefIds": [],
      "type": "deployManifest",
      "name": "Deploy to staging"
    },
    { "refId": "2", "requisiteStageRefIds": ["1"], "type": "manualJudgment", "name": "Promote?" },
    {
      "refId": "3",
      "requisiteStageRefIds": ["2"],
      "type": "deployManifest",
      "name": "Deploy to production"
    }
  ]
}
```

- Each stage has a `refId`, and `requisiteStageRefIds` lists the stages that must finish first. That is how the graph is stored: stages with the same requisites run **in parallel**, and a stage with an empty list starts as soon as the pipeline starts. The order of stages in the array means nothing.
- `type` is the machine name of the stage. From Spinnaker's source: `deployManifest`, `bakeManifest`, `manualJudgment`, `checkPreconditions`, `wait`, `undoRolloutManifest`, `scaleManifest`, `deleteManifest`.
- The docs warn that JSON edited through "Edit as JSON" **is not validated**. Pipelines also have revision history (diff and restore), and can be locked against UI edits or disabled.

**Artifacts** are how Spinnaker passes "the thing to deploy" between triggers and stages: a Docker image, a manifest file in Git, a Helm chart. A trigger or stage declares an **expected artifact** with match rules; an incoming artifact that matches is **bound** to it, and the pipeline can fall back to the artifact of the prior execution or a default one when nothing matches. Most real pipelines get their image this way instead of from a parameter.

### The stages you will meet most

| Stage (UI name)                   | What it does                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Deploy (Manifest)                 | Applies Kubernetes manifests (inline text or an artifact) to an account.                                         |
| Bake (Manifest)                   | Renders a manifest with a template renderer such as Helm, producing an artifact for a later deploy stage.        |
| Manual Judgment                   | Waits until a person clicks **Continue**; can show instructions and offer input options. Needs the Echo service. |
| Check Preconditions               | Fails or stops the branch unless a condition holds, for example a cluster size or an expression.                 |
| Wait                              | Waits a set time; can be skipped manually during execution.                                                      |
| Run Job                           | Runs a container to completion, for example a smoke test or a migration. UI names vary by provider and version.  |
| Undo Rollout (Manifest)           | Rolls a manifest back a target number of revisions.                                                              |
| Scale / Patch / Delete (Manifest) | Change the scale of, patch or delete a deployed resource.                                                        |
| Canary Analysis                   | Runs Kayenta analysis on a canary against a baseline.                                                            |
| Pipeline                          | Runs another pipeline.                                                                                           |

### Expressions (SpEL), briefly

Stage fields can contain **pipeline expressions**, written in the Spring Expression Language and wrapped in `${ }`. Expressions cannot be nested. Examples from the docs:

```text
${ parameters.stack }                          a pipeline parameter
${ trigger["buildInfo"]["number"] }            data from the trigger
${ #stage("Deploy to Prod")["type"] }           data from another stage, by name
${ #judgment("Ask for next step") == 'clean up' }   the option chosen in a Manual Judgment
${ parameters["region"] ?: 'us-east-1' }        a default value (Elvis operator)
```

The `#judgment` helper looks the stage up by its exact name, and the docs point out that the lookup is case-sensitive: rename the judgment stage and every expression that refers to it silently stops matching. Defaults are the other trap: `?:` with a production value means that a missing parameter deploys to production. Expressions are powerful and evaluated at run time, so test a changed expression on a non-production pipeline first.

## Manual Judgment, done properly

A Manual Judgment stage is only a gate if the stages after it actually depend on it. Three rules:

1. **Everything that goes to production must have the judgment in its requisite chain.** A production deploy whose `requisiteStageRefIds` point at the staging deploy runs in parallel with the judgment, not after it. Check the graph (exercise 2 shows how).
2. **Give the approver something to decide with.** `instructions` that say what to check (a dashboard, the error rate, a ticket), and input options whose meaning is clear. Use the chosen option downstream, for example with a Check Preconditions stage on `#judgment(...)`, so "stop" really stops.
3. **Decide what a rejection does.** Whether a rejected or timed-out judgment fails the whole pipeline is a stage setting; know which one you have.

A human click is also slow, and people learn to click Continue without looking. Where you can, replace the judgment with an automated check (a canary analysis, a metrics precondition), and keep the human for the decisions that need one. That is the direction [[patterns/spinnaker-canary-analysis]] takes.

## Rolling back

Spinnaker gives you two ways back, and they are not equivalent:

- **Undo Rollout (Manifest)** rolls a manifest back a target number of revisions, using the history the cluster keeps. It is fast and needs no new artifact. But it depends on that history (a Deployment's `revisionHistoryLimit`, for example) and acts on what is deployed, not on what the pipeline would deploy next time; how it behaves for each resource kind was not checked for this page.
- **Redeploy the previous known-good artifact**: run the deploy pipeline (or a dedicated rollback pipeline) with the previous image **digest**. Slower to start, but it uses the same, tested path as every deploy, and the result is recorded as a normal execution.

The site's rule, [[adr/0048-rollback-by-redeploying-previous-digest|ADR 0048]], is the second: roll back by redeploying the previous known-good digest, with database schemas only moving forward. Images by digest, never by a mutable tag ([[adr/0010-deploy-images-by-digest|ADR 0010]]), is what makes "the previous version" exact. Whatever you choose, write down the rollback before the release, as [[learn/environments-releases-and-rollbacks|Delivery 03]] taught.

## Authorisation with Fiat

From the authorisation docs:

- Fiat is **disabled by default**. Turn on authentication and authorisation before anyone else uses your Spinnaker.
- Its model is an approve list that is **open by default**: an application or account with no restrictions can be used by anyone who can log in.
- Permissions are `READ` and `WRITE` on accounts and applications, plus `EXECUTE` on applications, and they are granted to **roles** (groups), never to individual users. `READ` is needed to view an account's resources and `WRITE` to change them, and `WRITE` does not imply `READ`, so grant both. By default `READ` on an application **also grants `EXECUTE`**, so anyone who can see the application can run its pipelines; to restrict running to `WRITE` users, set `fiat.executeFallback: 'WRITE'` in `fiat-local.yml` and give `EXECUTE` explicitly where it is needed.

The Kubernetes account behind Spinnaker is a credential with rights in the cluster. Give it a ServiceAccount with only the namespaces and verbs it needs, as in [[learn/rbac-roles-bindings-and-least-privilege|Kubernetes 07]], not cluster-admin.

## Pipelines as code, and living with Argo CD

Clicking pipelines together in a UI does not scale and is hard to review. Spinnaker's own answer is pipeline templates (Managed Pipeline Templates v2, managed with the `spin` CLI or the UI); the docs also describe Managed Delivery, a declarative model of environments. The maintenance status of both, and of other pipelines-as-code tools around Spinnaker, was not confirmed for this page: check the current docs before building on them. At the very least, export pipeline JSON into Git and review changes there.

Where Spinnaker and Argo CD meet, ADR 0017 sets the direction: new Kubernetes services are delivered with Argo CD and Argo Rollouts, and Spinnaker is reconsidered only for what Argo CD cannot model (multi-cloud estates, VM targets, orchestration outside Kubernetes). In practice that means existing Spinnaker pipelines keep working while services move, never two systems deploying the same resources, and moving a service means moving its manifests into Git, recreating its gates as pull request reviews and Rollouts analysis, then disabling its Spinnaker pipeline. The comparison is in [[tools/argo-rollouts-vs-spinnaker]].

## Hands-on exercises

> [!warning] Exercises are not verified against Spinnaker
> The pipeline JSON is illustrative and was not loaded into a Spinnaker instance. The `jq` commands and their output were checked against the JSON on this page only.

Work in a scratch directory: `mkdir -p ~/delivery12 && cd ~/delivery12`.

1. **Read a pipeline.** Save this as `web-to-production.json`:

   ```json title="web-to-production.json (illustrative)"
   {
     "application": "web",
     "name": "web-to-production",
     "limitConcurrent": true,
     "parameterConfig": [
       { "name": "digest", "description": "Image digest from CI, sha256:...", "required": true }
     ],
     "triggers": [],
     "stages": [
       {
         "refId": "1",
         "requisiteStageRefIds": [],
         "type": "deployManifest",
         "name": "Deploy to staging",
         "cloudProvider": "kubernetes",
         "account": "k8s-staging",
         "source": "text",
         "manifests": [
           {
             "apiVersion": "apps/v1",
             "kind": "Deployment",
             "metadata": { "name": "web", "namespace": "web" },
             "spec": {
               "replicas": 2,
               "selector": { "matchLabels": { "app": "web" } },
               "template": {
                 "metadata": { "labels": { "app": "web" } },
                 "spec": {
                   "containers": [
                     { "name": "web", "image": "registry.example.com/web@${parameters.digest}" }
                   ]
                 }
               }
             }
           }
         ]
       },
       {
         "refId": "2",
         "requisiteStageRefIds": ["1"],
         "type": "wait",
         "name": "Soak in staging",
         "waitTime": 900
       },
       {
         "refId": "3",
         "requisiteStageRefIds": ["1"],
         "type": "checkPreconditions",
         "name": "Digest looks valid",
         "preconditions": [
           {
             "type": "expression",
             "failPipeline": true,
             "context": { "expression": "${parameters.digest.startsWith('sha256:')}" }
           }
         ]
       },
       {
         "refId": "4",
         "requisiteStageRefIds": ["2", "3"],
         "type": "manualJudgment",
         "name": "Promote to production?",
         "instructions": "Check the staging dashboard and error rate before promoting.",
         "judgmentInputs": [{ "value": "promote" }, { "value": "stop" }],
         "failPipeline": true
       },
       {
         "refId": "5",
         "requisiteStageRefIds": ["4"],
         "type": "checkPreconditions",
         "name": "Promotion chosen",
         "preconditions": [
           {
             "type": "expression",
             "failPipeline": true,
             "context": { "expression": "${#judgment('Promote to production?') == 'promote'}" }
           }
         ]
       },
       {
         "refId": "6",
         "requisiteStageRefIds": ["5"],
         "type": "deployManifest",
         "name": "Deploy to production",
         "cloudProvider": "kubernetes",
         "account": "k8s-production",
         "source": "text",
         "manifests": []
       }
     ]
   }
   ```

   Without running anything, answer: How is the pipeline started? Which stages run in parallel? What must be true before production is touched? Which value decides the image?

   Expected: it has no triggers, so it starts manually with a required `digest` parameter. Stages 2 (wait 900 seconds) and 3 (check the digest format) both depend only on stage 1, so they run in parallel after the staging deploy. Production (stage 6) needs stage 5, which needs a judgment of `promote` in stage 4, which needs both 2 and 3. The image is `registry.example.com/web@` plus the `digest` parameter, so every environment runs exactly the same bytes. (The production stage's `manifests` list is empty only to keep the example short; in a real pipeline it holds the same Deployment.)
   If you see something else: if you read the stages top to bottom as the order, look again at `requisiteStageRefIds`; that field, not the array order, defines the graph.

2. **Print the stage graph with `jq`.**

   ```bash
   jq empty web-to-production.json && echo valid
   jq -r '.stages[] | "\(.refId)  \(.type)  \(.name)  <- [\(.requisiteStageRefIds | join(","))]"' web-to-production.json
   jq -r '.stages[] | select(.requisiteStageRefIds | length == 0) | .name' web-to-production.json
   ```

   Expected:

   ```text
   valid
   1  deployManifest  Deploy to staging  <- []
   2  wait  Soak in staging  <- [1]
   3  checkPreconditions  Digest looks valid  <- [1]
   4  manualJudgment  Promote to production?  <- [2,3]
   5  checkPreconditions  Promotion chosen  <- [4]
   6  deployManifest  Deploy to production  <- [5]
   Deploy to staging
   ```

   The last line lists the stages that start immediately. Use the same two commands on any pipeline you export from a real Spinnaker before you change it.
   If you see something else: a `parse error` from `jq` means the file is not valid JSON, often a missing comma or quote from copying.

3. **Find the gap in a pipeline.** A colleague "simplified" the pipeline. Save it as `web-simplified.json`:

   ```json title="web-simplified.json (illustrative)"
   {
     "application": "web",
     "name": "web-simplified",
     "parameterConfig": [{ "name": "account", "required": false }],
     "stages": [
       {
         "refId": "1",
         "requisiteStageRefIds": [],
         "type": "deployManifest",
         "name": "Deploy to staging",
         "account": "k8s-staging",
         "image": "registry.example.com/web:latest"
       },
       {
         "refId": "2",
         "requisiteStageRefIds": ["1"],
         "type": "manualJudgment",
         "name": "Promote",
         "failPipeline": false
       },
       {
         "refId": "3",
         "requisiteStageRefIds": ["1"],
         "type": "deployManifest",
         "name": "Deploy to production",
         "account": "${parameters['account'] ?: 'k8s-production'}",
         "image": "registry.example.com/web:latest"
       }
     ]
   }
   ```

   ```bash
   jq -r '.stages[] | "\(.refId)  \(.name)  <- [\(.requisiteStageRefIds | join(","))]"' web-simplified.json
   jq -r '.stages[] | select(.type == "deployManifest") | "\(.name): \(.account) \(.image)"' web-simplified.json
   ```

   Expected output:

   ```text
   1  Deploy to staging  <- []
   2  Promote  <- [1]
   3  Deploy to production  <- [1]
   Deploy to staging: k8s-staging registry.example.com/web:latest
   Deploy to production: ${parameters['account'] ?: 'k8s-production'} registry.example.com/web:latest
   ```

   Expected findings: (a) production depends on stage 1, not on the judgment, so it deploys **in parallel** with the approval request: the gate gates nothing. (b) Both deploys use `:latest`, so staging and production may run different images, and "roll back to the previous version" has no meaning. (c) The account defaults to production when the parameter is missing. (d) The judgment has no instructions and does not fail the pipeline when rejected. Fix: production `requisiteStageRefIds: ["2"]` (plus a precondition on the judgment's value), a digest from the trigger or a parameter, no production default, and instructions.
   If you see something else: if you found only the `:latest` problem, look at the second column of the first command again; the missing dependency is the outage.

4. **Write your own three-stage pipeline.** In a new file `my-pipeline.json`, write a pipeline for application `api` with: a required `digest` parameter; stage 1 deploys to `k8s-staging`; stage 2 is a Manual Judgment with instructions and options `promote` and `stop`; stage 3 deploys to `k8s-production` only after stage 2. Use digests in both image references. Then check it:

   ```bash
   jq empty my-pipeline.json && echo valid
   jq -r '.stages[] | "\(.refId)  \(.type)  <- [\(.requisiteStageRefIds | join(","))]"' my-pipeline.json
   grep -c ':latest' my-pipeline.json
   ```

   Expected: `valid`; a chain `1 <- []`, `2 <- [1]`, `3 <- [2]` with types `deployManifest`, `manualJudgment`, `deployManifest`; and `0` from `grep -c` (no mutable tag).
   If you see something else: if stage 3 lists `1`, it is not gated. If `grep -c` prints a number above 0, replace the tags with `@${parameters.digest}`.

5. **Design the rollback.** The production deploy of digest `sha256:bbbb...` (illustrative) has raised the error rate; the previous release was `sha256:aaaa...`. Write down, in five lines or fewer: which rollback you use, the exact input, who approves, how you confirm it worked, and what you do about a database migration that shipped with the release.

   Expected (one good answer): run the same deploy pipeline with `digest=sha256:aaaa...` (redeploy the previous known-good digest, per ADR 0048), approved by the on-call engineer under the incident's rules; confirm by the Pods' image digest (`kubectl get pods -o jsonpath='{..imageID}'`) and the error rate returning to normal; the schema is not rolled back, because migrations are expand and contract and the previous version works with the expanded schema. Undo Rollout (Manifest) is the faster emergency option if the deploy pipeline itself is broken, followed by redeploying properly.
   If you see something else: if your answer rolls back the database schema, read [[patterns/postgres-expand-contract-migrations]] first.

6. **Optional: install Spinnaker in a lab.** The install docs now deprecate Halyard and use Kustomize from the `spinnaker-kustomize` directory of the Spinnaker repository: you set the version as the image tag, render with `kubectl kustomize`, apply, and reach the UI through the included ingress. The docs ask for a cluster with at least 18 GB of memory and 6 cores, and the default setup has a default username and password that you must change. That is more than a typical laptop kind cluster; use a sandbox cluster, and if it is in the cloud, it costs money until you delete it. Follow the current install pages (https://spinnaker.io/docs/setup/install/) rather than commands copied from here, and set up authentication first.

## Common mistakes

- **A production stage that does not depend on the judgment.** Why it bites: the approval request and the production deploy run at the same time. Fix: check `requisiteStageRefIds` for every production stage, with the `jq` command from exercise 2.
- **Mutable tags such as `:latest`.** Why it bites: environments run different images, and the previous version cannot be named. Fix: digests, bound from the trigger's artifact or a parameter.
- **Expression defaults that point at production.** Why it bites: a missing parameter deploys to production. Fix: no default for environment-selecting parameters; make them required.
- **Renaming a stage that an expression refers to.** Why it bites: `#stage(...)` and `#judgment(...)` look stages up by exact, case-sensitive name and stop matching. Fix: search the pipeline JSON for the old name before renaming.
- **Editing JSON in the UI without checking it.** Why it bites: the docs warn that "Edit as JSON" is not validated. Fix: validate and diff it with `jq` first, and use the revision history to compare and restore.
- **Leaving Fiat off.** Why it bites: authorisation is disabled by default and open by default, so anyone who can log in can run production pipelines. Fix: authentication plus Fiat roles with `READ`, `WRITE` and `EXECUTE` before shared use.
- **A cluster-admin Kubernetes account.** Why it bites: any pipeline can do anything in the cluster. Fix: a scoped ServiceAccount per account.
- **Two systems deploying the same resources.** Why it bites: Argo CD reverts what Spinnaker deploys, or the other way round. Fix: one owner per resource; disable the Spinnaker pipeline when a service moves to Argo CD.

## Check your understanding

1. In Spinnaker terms, what is an application, a cluster and a server group, and why can "cluster" confuse a Kubernetes engineer?
2. How does pipeline JSON express that two stages run in parallel, and that a stage waits for both?
3. A pipeline has a Manual Judgment, but production was deployed before anyone approved. What do you check first?
4. What do `${ parameters["region"] ?: 'us-east-1' }` and `${ #judgment("Promote") == 'promote' }` do, and what can go wrong with each?
5. Compare Undo Rollout (Manifest) with redeploying the previous digest. Which does the site prefer, and why?
6. Why does ADR 0017 not adopt Spinnaker, and what does that mean for an existing Spinnaker pipeline you maintain?

> [!question]- Answers
>
> 1. An application is the top-level grouping for a service (its clusters, load balancers, firewalls, pipelines and permissions). A cluster is a logical group of server groups, for example all versions of `web` in one environment. A server group is one deployable version with its instances (Pods on Kubernetes). A Spinnaker cluster is not a Kubernetes cluster; that name clash confuses people.
> 2. Through `refId` and `requisiteStageRefIds`: two stages that list the same predecessor run in parallel once it finishes, and a stage that lists both of them (`["2", "3"]`) waits until both are done. The order of stages in the array does not matter.
> 3. The production stage's `requisiteStageRefIds`: it probably depends on an earlier stage, not on the judgment (or on a branch the judgment does not gate). Then check whether a rejected judgment fails the pipeline, and whether a precondition uses the chosen option.
> 4. The first returns the `region` parameter, or `us-east-1` if it is missing; a default can send a deploy somewhere nobody chose. The second is true when the person picked `promote` in the Manual Judgment stage named exactly `Promote`; it silently stops matching if the stage is renamed or the case differs.
> 5. Undo Rollout rolls the deployed manifest back a number of revisions using the cluster's history: fast, but tied to that history and outside the normal deploy path. Redeploying the previous known-good digest uses the same tested pipeline and records a normal execution with an exact image. ADR 0048 prefers redeploying the previous digest.
> 6. Spinnaker is a large second control plane that would compete with Argo CD for "what deploys", and CI-held credentials and push deploys conflict with the GitOps model of ADR 0001. Existing pipelines keep running safely (gated, by digest, with least-privilege accounts) until the service moves to Argo CD and Rollouts; no new services are onboarded to Spinnaker unless they need what Argo CD cannot model.

## Next steps

Previous lesson: [[learn/gitops-with-argo-cd|Delivery 11: GitOps with Argo CD]]. Next lesson: [[learn/chef-basics-cookbooks-test-kitchen-and-inspec|Config 01: Chef basics]].

To go deeper:

- [[adr/0017-argo-cd-and-rollouts-not-spinnaker]] and [[tools/argo-rollouts-vs-spinnaker]] for the decision and the comparison.
- [[patterns/spinnaker-canary-analysis]] for Kayenta canary analysis in Spinnaker pipelines.
- [[patterns/progressive-delivery-argo-rollouts]] for the same ideas in the site's standard stack.
- [[adr/0048-rollback-by-redeploying-previous-digest]] and [[adr/0010-deploy-images-by-digest]] for rollback and digests.
- [[learn/jenkins-agents-configuration-as-code-and-shared-libraries|Delivery 07]] for the Jenkins side that often triggers Spinnaker.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Spinnaker documentation, "Concepts" (https://spinnaker.io/docs/concepts/) and "Pipelines" (https://spinnaker.io/docs/concepts/pipelines/), for applications, clusters (not Kubernetes clusters), server groups, load balancers, firewalls, pipelines and triggers.
- Spinnaker documentation, "Pipeline Stages" reference (https://spinnaker.io/docs/reference/pipeline/stages/), for the stage names and descriptions, including Manual Judgment needing Echo and Undo Rollout (Manifest).
- Spinnaker documentation, "Pipeline Expressions" guide (https://spinnaker.io/docs/guides/user/pipeline/expressions/), for the `${ }` syntax, no nesting, the `#stage` and `#judgment` helpers, case sensitivity and the Elvis operator.
- Spinnaker documentation, "Managing Pipelines" (https://spinnaker.io/docs/guides/user/pipeline/managing-pipelines/), for "Edit as JSON" not being validated, revision history, locking and disabling.
- Spinnaker documentation, "Artifacts" (https://spinnaker.io/docs/reference/artifacts/), for expected artifacts, matching and fallbacks.
- Spinnaker documentation, "Kubernetes provider" (https://spinnaker.io/docs/setup/install/providers/kubernetes/), for the manifest-based provider and accounts mapping to kubeconfig credentials.
- Spinnaker documentation, "Authorization" (https://spinnaker.io/docs/setup/other_config/security/authorization/), for Fiat being disabled and open by default, and `READ`, `WRITE` and `EXECUTE`.
- Spinnaker documentation, "Install" (https://spinnaker.io/docs/setup/install/) and "Deploy" (https://spinnaker.io/docs/setup/install/deploy/), for the Halyard deprecation, the Kustomize install and the stated resource requirements.
- Spinnaker documentation, "Pipeline Templates" (https://spinnaker.io/docs/guides/user/pipeline/pipeline-templates/) and "Managed Delivery" (https://spinnaker.io/docs/guides/user/managed-delivery/).
- Spinnaker source code (https://github.com/spinnaker/spinnaker, Orca), for the stage `type` strings.
- Checked against the documentation sources on 2026-10-21; not checked against a running Spinnaker. Not verified: all pipeline JSON field names beyond `refId`, `requisiteStageRefIds` and `type`; the current Spinnaker release; how Kubernetes kinds map to server groups and load balancers in the UI; Undo Rollout behaviour per resource kind; the status of Managed Delivery, pipeline templates and other pipelines-as-code tools; the Operator-based install; the one-line service descriptions. Check the current docs.
