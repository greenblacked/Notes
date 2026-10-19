---
title: Caching public registries through Artifactory remote repositories for CI
description: Put Artifactory remote and virtual repositories in front of Docker Hub, npm, PyPI, Maven and Helm so CI survives upstream rate limits and outages.
type: pattern
tags:
  - patterns
  - artifactory
  - ci-cd
  - supply-chain
  - reliability
  - cost
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A CI fleet that pulls straight from Docker Hub, npmjs.org, PyPI and Maven Central is only as reliable as those services and only as fast as the egress path to them. An Artifactory **remote repository** is a caching proxy: the first request fetches from upstream and stores the file, later requests are served locally. A **virtual repository** gives every client one URL that fronts the remote (and your own local repositories). The result is faster builds, fewer rate-limit failures, and a copy of what you actually built against.

> [!info] Not checked against live docs
> Artifactory UI labels, REST field names (cache periods, include and exclude patterns, resolution order) and the Docker Hub rate-limit rules were not checked against the live documentation when this was written. Check the current JFrog documentation for the exact option names on your version, and the [Docker Hub usage page](https://docs.docker.com/docker-hub/usage/) for current limits. No limit values are quoted here on purpose.

## Why cache

- **Rate limits.** Shared runner NAT addresses hit anonymous pull limits quickly. A cache means one upstream pull serves every job.
- **Outages.** With a warm cache a build keeps working while the upstream is down. With a cold cache it does not, so cache the things you depend on before you need them.
- **Reproducibility.** A cached artefact stays the same even if the upstream tag moves or a package is yanked (subject to cache retention, below).
- **Cost and speed.** Traffic stays inside your network; the NAT and egress bill drops.

The layout of local repositories per stage is in [[artifact-promotion-artifactory]]; this note covers the dependency side only.

## Repository types and naming

| Type    | Role in this pattern                                                                 |
| ------- | ------------------------------------------------------------------------------------ |
| Remote  | One per upstream per package type. Caches. Never receives uploads.                   |
| Local   | Your own internal packages and images. Receives uploads from CI.                     |
| Virtual | The single URL clients use. Aggregates local and remote repositories in a set order. |

A naming scheme that scales across package types:

```text title="repository naming"
docker-hub-remote       # remote -> Docker Hub
docker-ghcr-remote      # remote -> GitHub Container Registry
docker-internal-local   # local  -> images we build
docker                  # virtual: docker-internal-local, then the remotes

npm-remote              # remote -> npm registry
npm-internal-local      # local  -> private packages
npm                     # virtual: local first, then remote

pypi-remote / pypi-internal-local / pypi
maven-central-remote / maven-internal-local / maven
helm-remote / helm-internal-local / helm
generic-remote          # remote -> a vendor download site (tool binaries)
```

Put the local repository before the remote ones in every virtual repository. The reason is dependency confusion, covered below.

## Cache behaviour

Two settings decide how fresh a remote is. Names differ by version, so check the current docs:

- **Metadata cache period.** How long Artifactory trusts cached index files (`package.json` documents, `simple` index pages, `maven-metadata.xml`, Docker tag lists) before asking upstream again. Short values give fresh tags and versions at the cost of more upstream traffic; long values give stability and survive outages longer.
- **Artifact retention (unused artefact cleanup).** Cached files that nobody has requested for a period can be removed to save space. Set this deliberately, because it decides how long a "frozen" dependency really stays available. Pair it with [[0006-artifact-retention-by-cleanup-policies]].

Moving tags (`latest`, `3`, `lts`) are the main stale-metadata trap. Pin images by version or digest in builds and let the cache serve the pinned content. See [[dockerfile-hardening]] for pinning.

## Wiring CI clients

Set the repository base URL once, in a CI variable, so rollback is a variable change.

```bash title="ci-env.sh"
export ARTIFACTORY_URL="https://artifactory.example.com/artifactory"
export NPM_REGISTRY="${ARTIFACTORY_URL}/api/npm/npm/"
export PIP_INDEX_URL="https://ci-reader:${ARTIFACTORY_READ_TOKEN}@artifactory.example.com/artifactory/api/pypi/pypi/simple"
export MAVEN_MIRROR_URL="${ARTIFACTORY_URL}/maven"
export HELM_REPO_URL="${ARTIFACTORY_URL}/helm"
export DOCKER_PREFIX="artifactory.example.com/docker"
```

### Docker

There are two mechanisms, and they behave differently:

1. **Daemon `registry-mirrors`.** Applies only to Docker Hub pulls of unprefixed images. Configure it on runner nodes.
2. **Image prefix rewrite.** The image reference itself points at Artifactory, for example `artifactory.example.com/docker/library/alpine`. Works for any upstream, and is the only option for BuildKit builds in a container without access to the node daemon config.

```json title="/etc/docker/daemon.json"
{
  "registry-mirrors": ["https://artifactory.example.com"]
}
```

Whether the mirror URL needs a repository path depends on how the virtual repository is exposed (repository path method or subdomain method). Check the current JFrog Docker documentation, and the [Docker registry mirror guide](https://docs.docker.com/docker-hub/mirror/).

Verify the daemon picked it up:

```bash title="verify docker mirror"
docker info | grep -A2 'Registry Mirrors'
docker pull artifactory.example.com/docker/library/alpine:3
```

In Dockerfiles, take the registry as a build argument so the same file works with and without the cache:

```dockerfile title="Dockerfile"
ARG REGISTRY=docker.io
FROM ${REGISTRY}/library/node:lts-slim AS build
```

### npm, pip, Maven, Helm

```bash title="npm"
npm config set registry "${NPM_REGISTRY}"
npm config get registry
```

```ini title="pip.conf"
[global]
index-url = https://artifactory.example.com/artifactory/api/pypi/pypi/simple
```

```bash title="pip"
pip config list
```

```xml title="settings.xml"
<settings>
  <mirrors>
    <mirror>
      <id>artifactory</id>
      <mirrorOf>*</mirrorOf>
      <url>https://artifactory.example.com/artifactory/maven</url>
    </mirror>
  </mirrors>
  <servers>
    <server>
      <id>artifactory</id>
      <username>ci-reader</username>
      <password>${env.ARTIFACTORY_READ_TOKEN}</password>
    </server>
  </servers>
</settings>
```

```bash title="helm"
helm repo add platform "${HELM_REPO_URL}" --username ci-reader --password-stdin <<< "${ARTIFACTORY_READ_TOKEN}"
helm repo update
```

### GitLab runners and Jenkins

On GitLab, set the variables above at group level, masked and, for anything that writes, protected. Pass the Docker prefix as a build argument. On Kubernetes executors, put daemon-level settings in the node image or a DaemonSet, because job pods cannot change them. See [[gitlab-runners-on-gke]].

On Jenkins, put the same values in the Kubernetes pod template as environment variables, and mount `.npmrc`, `pip.conf` or `settings.xml` from a credential-backed secret rather than baking tokens into agent images. See [[jenkins-controller-and-agent-hardening]].

## Security

- **No anonymous access.** Disable it on the instance. Pulls go through a read-only identity with permission only on the virtual repositories CI needs. Token design is in [[artifactory-access-tokens-and-oidc-for-ci]].
- **Separate read from write.** The pull identity cannot deploy. The deploy identity is only available to protected jobs.
- **Exclude patterns.** On each remote, exclude paths you never want to pull, for example an internal group or scope, so a request for an internal name cannot be satisfied from the public internet.
- **Curation or Xray policy on remotes.** Where you license a feature to block known-bad or too-new packages at the remote, use it. Check the current JFrog docs for what your edition includes, and see [[0005-xray-scanning-gates-promotion]].
- **Credentials in config files.** Treat `settings.xml`, `.npmrc` and `pip.conf` as secrets files. Never commit them; never print them in job logs.

### Dependency confusion

If an internal package named `acme-billing` exists in your local repository and also (or later) on a public registry, a resolver that asks both and picks the highest version can install the attacker's copy. Defences in the virtual repository:

1. Order the local repository **before** the remote repository.
2. On the remote, set **exclude patterns** for your internal names and scopes (for example `@acme/**`, `com/acme/**`, `acme-*`). On the local repository, set include patterns for the same.
3. Prefer scoped names (`@acme/billing` for npm, a reserved group ID for Maven).
4. Pin with lock files and integrity hashes, and review lock file changes. See [[automated-dependency-updates]].

Check the current docs for how your version resolves a name that exists in several members of a virtual repository.

## Failure modes

| Symptom                               | Likely cause                                                                                                               | Fix                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| New release not visible for hours     | Metadata cache period longer than expected                                                                                 | Lower it for that remote, or expire the cache entry for one package                            |
| Build fails during an upstream outage | Cold cache: that dependency was never fetched through the proxy                                                            | Pre-warm by building main through the proxy; keep retention long enough                        |
| Still rate-limited by Docker Hub      | Images are referenced with a fully qualified registry that skips the mirror, or `FROM` in a base build stage has no prefix | Use the prefix rewrite; grep Dockerfiles and Helm values for `docker.io` and unprefixed images |
| 401 on pull for some projects         | Token lacks permission on the virtual repository, or expired                                                               | Check the permission target and the token expiry                                               |
| Wrong package version installed       | Virtual repository resolution order or a public name collision                                                             | Fix order and exclude patterns, then clear the cached entry                                    |
| Disk fills                            | No retention on remotes                                                                                                    | Add cleanup policies; alert on repository storage                                              |
| Everything fails at once              | Artifactory itself is now a single point of failure                                                                        | Run it highly available per your hosting decision; keep the rollback variable below ready      |

Artifactory becoming the dependency of every build is the main trade-off of this pattern. The hosting decision is in [[0011-artifactory-hosting-saas-or-self-managed]], and the resolver rule in [[0007-language-packages-resolve-through-artifactory]].

## Verify

```bash title="verify the chain"
# Docker mirror active on a runner node
docker info | grep -A2 'Registry Mirrors'

# Package managers point at Artifactory
npm config get registry
pip config list

# A pull is served from the cache: second pull is fast and the repo shows a cached file
curl -fsS -H "Authorization: Bearer ${ARTIFACTORY_READ_TOKEN}" \
  "${ARTIFACTORY_URL}/api/storage/docker-hub-remote-cache/library/alpine" | head
```

Then run one pipeline with the network path to the public registries blocked in a test runner, and confirm the build still passes. That test proves the cache is warm and that nothing bypasses it. The exact `-cache` storage path suffix is a JFrog detail; check the current docs.

## Rollback

Because every client takes its base URL from a variable, rollback is a variable change:

1. Set `NPM_REGISTRY`, `PIP_INDEX_URL`, `MAVEN_MIRROR_URL` and `DOCKER_PREFIX` back to their upstream values (for example `https://registry.npmjs.org/`, `docker.io`).
2. For daemon mirrors, remove `registry-mirrors` from the node config and restart the daemon in a drained node.
3. Re-run a canary pipeline, then roll back wider if needed.

Keep the upstream values documented next to the variables so the switch can be done under pressure.

## Related

- [[artifact-promotion-artifactory]]
- [[artifactory-access-tokens-and-oidc-for-ci]]
- [[buildkit-registry-cache-in-ci]]
- [[gitlab-runners-on-gke]]
- [[automated-dependency-updates]]
- [[dockerfile-hardening]]
- [[0007-language-packages-resolve-through-artifactory]]

## Sources

- https://jfrog.com/help/r/jfrog-artifactory-documentation
- https://docs.docker.com/docker-hub/usage/
- https://docs.docker.com/docker-hub/mirror/
- https://docs.npmjs.com/cli/v10/using-npm/config
- https://pip.pypa.io/en/stable/topics/configuration/
