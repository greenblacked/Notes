---
title: Artifactory vs Nexus vs Artifact Registry
description: Comparing JFrog Artifactory, Sonatype Nexus Repository and Google Artifact Registry for images, Helm charts and language packages on GKE.
type: tool
tags:
  - tools
  - artifactory
  - gcp
  - supply-chain
  - cost
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Every GKE platform needs one place that stores container images, Helm charts and language packages, and one controlled path to the public registries. Three products cover that role most often: JFrog Artifactory, Sonatype Nexus Repository and Google Artifact Registry. They overlap on the basics and differ on breadth, operations and where the identity model lives.

> [!info] Not checked against current releases
> Versions, licences, limits and prices were not checked when this note was written. Tier names and feature splits change often; confirm them in the current vendor documentation before deciding.

## Criteria

The comparison uses the criteria that decide this choice in practice:

- Which package formats you must host, not which ones the product lists.
- Whether you need pull-through caches (remote repositories) and a single virtual endpoint for clients.
- Where scanning and signing hooks attach.
- How access control maps to your existing identity (IAM groups, SSO, CI identities).
- How retention and cleanup work, because registries only grow.
- Who runs it: licence, hosting and the on-call burden.

## At a glance

| Concern             | Artifactory                                                   | Nexus Repository                             | Artifact Registry                                       |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| Hosting             | Self-hosted or vendor cloud                                   | Self-hosted or vendor cloud                  | Managed by Google, regional or multi-regional           |
| Format breadth      | Very wide, including generic and many niche formats           | Wide; check the format list for your edition | Docker/OCI, Helm (as OCI), Maven, npm, Python, and more |
| Remote repositories | Yes, for most formats                                         | Yes ("proxy" repositories)                   | Yes, for a limited set of upstreams per format          |
| Virtual endpoint    | Virtual repositories with ordered resolution                  | Group repositories                           | Virtual repositories                                    |
| Access control      | Own users, groups, permission targets, SSO                    | Own roles and privileges, SSO                | Cloud IAM on project or repository                      |
| Scanning            | Xray (separate product); see [[jfrog-xray-vs-trivy-vs-grype]] | Vendor scanner (separate product)            | Google's vulnerability scanning for supported formats   |
| Cleanup             | Retention scripts, plugins, lifecycle features                | Cleanup policies and scheduled tasks         | Cleanup policies, with dry-run                          |
| Operations          | You run or buy it                                             | You run or buy it                            | None beyond configuration                               |

Treat the table as orientation. Feature availability depends on tier and edition, so check the current docs for each cell that matters to you.

## Supported formats

Start from the list of artefacts your teams really publish: OCI images, Helm charts, Maven or npm or Python packages, Terraform modules, generic files such as release tarballs. Artifactory has the longest list and a `generic` type for anything else. Nexus covers the common ecosystems and is a reasonable single tool for them. Artifact Registry covers the main container and language formats, and stores Helm charts as OCI artefacts. If a format you need is not listed, that is usually the end of the discussion for that product.

## Remote (proxy) and virtual repositories

A remote repository caches an upstream (Docker Hub, npmjs, PyPI, Maven Central) so builds do not hit the internet and survive upstream outages. A virtual repository gives clients one URL that resolves across local and remote repositories in a defined order.

On Artifact Registry a Docker Hub pull-through cache is one command. Confirm the flag names with `gcloud artifacts repositories create --help`, because upstream options differ per format and have changed over time.

```bash title="remote-repository.sh"
PROJECT=example-project
LOCATION=europe-west1

gcloud artifacts repositories create dockerhub-cache \
  --project="$PROJECT" \
  --location="$LOCATION" \
  --repository-format=docker \
  --mode=remote-repository \
  --remote-docker-repo=DOCKER-HUB \
  --description="Pull-through cache for Docker Hub"

gcloud artifacts repositories create docker-local \
  --project="$PROJECT" \
  --location="$LOCATION" \
  --repository-format=docker \
  --mode=standard-repository

# Virtual repository: one URL, ordered upstreams (higher priority value wins)
cat > upstreams.json <<'EOF'
[
  {"id": "internal", "repository": "projects/example-project/locations/europe-west1/repositories/docker-local", "priority": 100},
  {"id": "dockerhub", "repository": "projects/example-project/locations/europe-west1/repositories/dockerhub-cache", "priority": 50}
]
EOF

gcloud artifacts repositories create docker \
  --project="$PROJECT" \
  --location="$LOCATION" \
  --repository-format=docker \
  --mode=virtual-repository \
  --upstream-policy-file=upstreams.json
```

Give internal repositories a higher priority value than remote ones, so a public image can never shadow an internal name. The same dependency-confusion reasoning applies to Artifactory virtual repositories; see [[artifactory-repository-design]].

## Security, scanning and signing hooks

- **Artifactory** integrates with Xray for repository-level policies and with its own metadata for build info and properties. Signing is done outside it (cosign, GPG for packages) and the signature is stored next to the artefact.
- **Nexus** offers a vendor scanning product and repository health data; the open-source edition has fewer security features. Check the current docs for the edition split.
- **Artifact Registry** integrates with Google's vulnerability scanning and with Binary Authorization for deploy-time checks on GKE.

Whatever the registry, the control that matters is scanning and verifying by digest in CI and at admission, not only inside the registry. See [[image-signing-and-admission-verification]] and [[sbom-generation-and-storage]].

## Access control: Artifactory permissions vs Nexus roles vs IAM on repositories

Artifact Registry uses Cloud IAM. A GKE workload that only pulls needs `roles/artifactregistry.reader` on the repository, granted to the node or workload service account. CI needs a writer role only on the repositories it publishes to.

```bash title="grant-reader.sh"
gcloud artifacts repositories add-iam-policy-binding docker-local \
  --project=example-project \
  --location=europe-west1 \
  --member="serviceAccount:gke-nodes@example-project.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

Prefer Workload Identity over node-level grants where pods differ in what they may pull; see [[gke-workload-identity]]. Artifactory uses its own users, groups and permission targets (patterns of repositories plus actions), and Nexus uses roles built from privileges. Both need an identity-provider integration and a plan for service accounts, which is real work that IAM gives you for free inside Google Cloud. Neither can be used with CI workload identity federation without extra setup, so check what your CI system supports.

## Retention and cleanup

Registries grow without bound unless you prune. Artifact Registry cleanup policies delete or keep versions by tag prefix, age and count. Always run them in dry-run mode first, and write keep rules for anything you must be able to roll back to.

```json title="cleanup-policy.json"
[
  {
    "name": "keep-release-tags",
    "action": { "type": "Keep" },
    "condition": { "tagState": "TAGGED", "tagPrefixes": ["v"] }
  },
  {
    "name": "keep-recent-five",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 5 }
  },
  {
    "name": "delete-old-untagged",
    "action": { "type": "Delete" },
    "condition": { "tagState": "UNTAGGED", "olderThan": "30d" }
  }
]
```

```bash title="apply-cleanup.sh"
# 1. See what would be deleted
gcloud artifacts repositories set-cleanup-policies docker-local \
  --project=example-project --location=europe-west1 \
  --policy=cleanup-policy.json --dry-run

# 2. Apply only after reviewing the audit log of the dry run
gcloud artifacts repositories set-cleanup-policies docker-local \
  --project=example-project --location=europe-west1 \
  --policy=cleanup-policy.json --no-dry-run
```

Verify the exact JSON field names against the cleanup policy documentation before applying. Nexus uses cleanup policies attached to repositories plus scheduled compaction tasks, and Artifactory uses retention scripts or lifecycle features; both need a tested dry run too, and promoted artefacts must be exempt (see [[artifact-promotion-artifactory]]).

## Licensing, hosting and operations

Artifactory and Nexus both have free or open-source entry points and paid tiers, and both have vendor-hosted cloud offerings. The feature split between tiers (high availability, some formats, security and replication features) changes; check the current docs and pricing pages rather than trusting any summary, including this one. Self-hosting means you own upgrades, database and filestore backups, disk growth, TLS and high availability. Artifact Registry removes all of that and bills for storage and egress; use the pricing calculator for your volumes.

Confirm that a self-hosted Artifactory is healthy and reachable with the JFrog CLI:

```bash title="check-artifactory.sh"
jf config add example --url=https://artifactory.example.com --user=ci-reader --access-token="$ART_TOKEN" --interactive=false
jf rt ping --server-id=example
```

## Migration between them

1. **Inventory** repositories, formats, sizes and the clients (CI, developers, Helm, Docker) that use each.
2. **Create the target** with the same logical layout and permissions, using Terraform or scripts.
3. **Dual-publish**: CI pushes every new artefact to both the old and new registry.
4. **Switch pulls** through a virtual or remote repository, so clients change one URL and the new registry can fall back to the old as an upstream while history is copied.
5. **Copy history** for what you still need to roll back to (images by digest, release charts), not everything.
6. **Freeze the old registry** read-only, watch pull logs for stragglers, then archive and delete after a full release cycle.

Rollback during the switch is trivial because both registries still hold current artefacts: point clients back at the old URL.

## When to choose which

Choose **Artifact Registry** when you are already all-in on Google Cloud, your formats are covered, and you would rather not operate a registry. IAM, audit logs and GKE integration come with it.

Choose **Artifactory** when you need many formats, advanced promotion and build metadata, replication across sites or clouds, or a registry independent of one cloud.

Choose **Nexus** when you need a capable self-hosted multi-format registry and your team already knows it.

## Recommendation

For a GCP-centred team with container images, Helm charts and a few language ecosystems, start with Artifact Registry: standard repositories for internal artefacts, remote repositories for Docker Hub and the language registries, one virtual repository per format, IAM for access, and cleanup policies from day one. Move to Artifactory when a concrete requirement appears that Artifact Registry cannot meet, such as a format it lacks, cross-cloud replication, or promotion workflows you already run. What would change this advice: a multi-cloud estate, a mandatory on-premises registry, or an existing large Artifactory investment.

## Related

- [[artifactory-repository-design]] for laying out local, remote and virtual repositories.
- [[artifact-promotion-artifactory]] for promotion between maturity levels.
- [[jfrog-xray-vs-trivy-vs-grype]] for scanning.
- [[gitlab-ci-vs-jenkins]] for the CI systems that publish here.
- [[gke-workload-identity]] for pull permissions per workload.
- [[tools/index|Tools index]]

## Sources

- [Artifact Registry documentation](https://cloud.google.com/artifact-registry/docs)
- [Remote repositories](https://cloud.google.com/artifact-registry/docs/repositories/remote-repo)
- [Cleanup policies](https://cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
- [Sonatype Nexus Repository documentation](https://help.sonatype.com/en/sonatype-nexus-repository.html)
- [JFrog Artifactory documentation](https://jfrog.com/help/r/jfrog-artifactory-documentation)
