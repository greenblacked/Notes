---
title: Language package managers resolve only through Artifactory
description: CI and developers install npm, pip and Maven packages through Artifactory virtual repos, never straight from the public internet.
type: adr
tags:
  - adr
  - artifactory
  - supply-chain
  - ci-cd
  - security
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0007
---

## Context

Application builds install hundreds of third-party packages. When `npm`, `pip` and Maven talk directly to the public indexes, several things go wrong at once:

- A public index outage or a yanked package breaks builds that did nothing wrong.
- A malicious or typosquatted package reaches a build with no chance to scan or block it first.
- We cannot answer "which builds used package X?" without searching every repository.
- A build that works today may resolve different transitive versions tomorrow if a lockfile is missing or ignored.

[[0002-artifactory-as-single-artifact-store]] makes Artifactory the single store. This record fixes how the language package managers use it.

## Decision

We will make **npm, pip and Maven resolve only through Artifactory virtual repositories**, for CI and for developer machines, and we will block direct access to public registries from runners.

Client configuration points at the virtual repository (naming in [[0003-artifactory-repository-layout]]). Credentials come from CI variables or short-lived tokens and are never committed.

```ini title=".npmrc"
registry=https://artifactory.example.com/artifactory/api/npm/npm-virtual/
# Token is injected by CI as NPM_TOKEN; never commit it.
//artifactory.example.com/artifactory/api/npm/npm-virtual/:_authToken=${NPM_TOKEN}
always-auth=true
```

```ini title="pip.conf"
[global]
index-url = https://__token__:${PIP_TOKEN}@artifactory.example.com/artifactory/api/pypi/pypi-virtual/simple
```

In practice, render `pip.conf` in the job from a CI variable so the token is not stored in the file. Some pip versions do not expand environment variables in `pip.conf`; the safe form is to set `PIP_INDEX_URL` as a masked CI variable instead.

```xml title="settings.xml"
<settings>
  <mirrors>
    <mirror>
      <id>artifactory</id>
      <name>Artifactory virtual repo</name>
      <url>https://artifactory.example.com/artifactory/maven-virtual</url>
      <mirrorOf>*</mirrorOf>
    </mirror>
  </mirrors>
  <servers>
    <server>
      <id>artifactory</id>
      <username>${env.ARTIFACTORY_USER}</username>
      <password>${env.ARTIFACTORY_TOKEN}</password>
    </server>
  </servers>
</settings>
```

Rules:

- **Lockfiles stay committed** (`package-lock.json`, `requirements.txt` with hashes or a lock tool's file, resolved Maven versions) and CI uses the strict install commands (`npm ci`, `pip install --require-hashes` where hashes are used). The lockfile gives repeatability; the proxy gives availability and control. Updates arrive through [[automated-dependency-updates]].
- **Runner egress to public registries is blocked** ([[private-gke-and-controlled-egress]]). A job that bypasses the proxy fails instead of silently skipping controls.
- **Locals win over remotes** in the virtual repository, which prevents an upstream package from shadowing an internal one with the same name.
- Remote repositories may quarantine or delay newly published upstream versions, and scanning applies to cached packages ([[0005-xray-scanning-gates-promotion]]). Which of these protections exist depends on the Artifactory edition and subscription; check the current docs before promising them to teams.
- Runner configuration is described in [[gitlab-runners-on-gke]].

> [!info] Not checked against current docs
> Not verified for this record: the exact Artifactory API paths per package type, which pip versions expand variables in `pip.conf`, the availability of quarantine or minimum-package-age protection in our edition, and the Maven `mirrorOf` behaviour with several repositories. Check the npm, pip and Maven pages linked below and the JFrog package-type pages.

## Consequences

Easier:

- Builds are insulated from public outages and removed packages for anything already cached.
- One place to scan, block and report on every third-party package.
- A single configuration shape per ecosystem, shipped to runners and to developer laptops.

Harder or newly required:

- An Artifactory outage stops builds. Availability and DR of the store therefore matter ([[0011-artifactory-hosting-saas-or-self-managed]]).
- Each new ecosystem (Go modules, NuGet, Cargo) needs its own virtual repository before teams can use it.
- Developers on laptops need the same configuration; provide a bootstrap script and document the token flow.
- First installs of new packages are slower while the cache fills.

## Alternatives considered

- **Direct public registries plus lockfiles only.** Lockfiles give repeatability, but not availability, scanning or an audit trail, and a lockfile refresh pulls the unvetted package directly. Rejected.
- **Vendoring dependencies into each repository.** Maximum isolation, but large repositories, hard security updates and no central view. Reserved for exceptional cases.
- **A pull-through cache per team.** More moving parts and no central policy. Rejected.

## Validation

With runner egress blocked, strict installs must still succeed through the proxy. Run these in a clean CI container; set the variables first.

```bash title="validate-0007.sh"
set -o pipefail
export NPM_TOKEN="${NPM_TOKEN:?set a read token}"
export PIP_INDEX_URL="${PIP_INDEX_URL:?set the pypi-virtual simple URL with token}"

# 1. npm: strict install from the lockfile
npm ci --no-audit --no-fund

# 2. pip: install pinned requirements (add --require-hashes if hashes are used)
python3 -m pip install --no-cache-dir -r requirements.txt

# 3. Maven: resolve dependencies through the mirror only
mvn --batch-mode dependency:resolve -s settings.xml

# 4. Direct access must fail (expected: timeout or connection error)
curl -sS --max-time 10 -o /dev/null https://registry.npmjs.org/ && echo "FAIL: direct access works"
```

## References

- npm `.npmrc`: https://docs.npmjs.com/cli/configuring-npm/npmrc
- pip configuration: https://pip.pypa.io/en/stable/topics/configuration/
- Maven mirror settings: https://maven.apache.org/guides/mini/guide-mirror-settings.html

Related notes:

- [[gitlab-runners-on-gke]]
- [[automated-dependency-updates]]
- [[private-gke-and-controlled-egress]]
- [[0002-artifactory-as-single-artifact-store]]
- [[0003-artifactory-repository-layout]]
