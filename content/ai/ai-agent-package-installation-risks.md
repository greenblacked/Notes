---
title: Package installation risks in AI agent workflows
description: Prevent package managers and generated dependency changes from turning agent execution into unreviewed code execution or supply-chain exposure.
type: guide
tags:
  - ai
  - security
  - supply-chain
created: 2026-10-26
modified: 2026-10-26
draft: false
---

When an agent installs a package, it delegates trust to a registry, publisher account, package version, transitive dependency graph, and build or install scripts. The dependency may execute code during installation, compile, test, or runtime. A model’s recommendation, popularity metric, lockfile, or successful test does not establish that the package is safe. This note is about package acquisition in agent workflows; broader model artifact integrity is covered by [[ai/model-supply-chain-verification]].

Agent-generated dependency changes still require the review and provenance practices in [[ai/ai-generated-code-policy-and-provenance]].

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Treat dependency changes as executable changes

Review package manifests, lockfiles, build scripts, lifecycle hooks, plugins, and transitive dependencies as code changes. Ask why the dependency is needed, whether the project already has equivalent functionality, who maintains it, which version is selected, and what license and data behavior apply. Evaluate both direct and transitive dependencies. A package name can be mistyped or impersonated, a legitimate maintainer account can be compromised, and a previously safe release can change behavior.

Do not let an agent install arbitrary packages into a privileged or persistent environment. Use an isolated workspace with no credentials and restricted egress, and direct package requests through an approved registry mirror or proxy. Pin exact versions using the project’s lockfile conventions and review changes to that file. Pinning improves repeatability but does not prove publisher identity or harmlessness. Avoid casually relaxing lockfile integrity, registry, signature, or policy checks to make an installation succeed.

## Establish provenance and policy

Prefer approved registries and sources, restrict untrusted Git URLs and local path dependencies, and preserve the package’s origin. Validate package identity and integrity through the ecosystem’s supported mechanisms. Use provenance attestations or signatures where available and verify their identity against an expected publisher and build workflow; a valid signature from an unexpected identity is not sufficient. SLSA provides a specification for provenance and supply-chain assurance, while Sigstore documents verification mechanisms for signed artifacts and attestations. Neither framework guarantees that a package is non-malicious.

Run vulnerability and license checks as part of normal dependency review. `npm audit`, for example, submits a description of configured dependencies to the default registry to report known vulnerabilities, so assess the privacy and registry implications before using it with sensitive manifests. A clean advisory report only means no matching published advisory was found under that service’s data and time window. It does not establish security, maintainer trust, or absence of malicious behavior.

## Constrain installation-time execution

Install and build dependencies in a disposable sandbox with no cloud credentials, source-control write token, deployment key, or host socket. Disable lifecycle scripts when the workflow permits, but check the package manager’s exact semantics and whether required packages depend on scripts. If scripts must run, allow them only in the isolated build stage and inspect their effects. Give the environment only the network routes needed for package retrieval, and do not allow a dependency install to call internal services or metadata endpoints.

Keep build caches separated by trust boundary. Shared caches can return poisoned or stale artifacts across branches or tenants if keys and permissions are weak. Use immutable or content-addressed cache entries where supported, scope caches to the repository and trust level, and invalidate them through a reviewed process after suspected compromise. Do not promote an artifact from an untrusted pull request into a trusted release cache.

## Review agent-generated dependency proposals

Require the agent to explain the dependency’s purpose, source, version, transitive footprint, and proposed code changes, but treat the explanation as a lead for human review, not evidence. Verify the package against the official registry, upstream repository, and project policy. Review the actual diff and lockfile independently. Run tests and scans in the normal pipeline, and require a human owner for packages with access to secrets, build hooks, native code, network services, or sensitive data.

Have a clear rule for packages first introduced by untrusted contributors: no secret-bearing install step, no privileged build, and no release artifact promotion until review and required CI succeed. The same rules apply when the agent suggests a package to fix a build. Do not accept an automatically generated dependency update solely because it makes tests pass.

## Failure cases and incident response

Warning signs include unexpected install scripts, registry changes, sudden maintainer changes, typosquatted names, unexplained native binaries, broad postinstall network access, lockfile churn beyond the requested package, or a newly requested credential. If a package is suspected compromised, stop promotion and further installation, preserve manifest and lockfile versions, package tarballs or hashes, registry metadata, build logs, and cache provenance. Coordinate removal or revocation with package and security owners; do not delete evidence before capturing the relevant artifacts.

## Review checklist

- Are package source, identity, version, lockfile, and transitive graph reviewed?
- Is the agent’s install environment disposable and free of ambient credentials?
- Are registries and egress restricted to approved sources?
- Are lifecycle scripts disabled or executed only in an isolated stage?
- Are provenance and vulnerability checks interpreted with their limitations?
- Are shared caches isolated by trust boundary and invalidated safely?
- Are agent-generated dependency explanations verified independently?
- Can a suspected compromised package be traced through builds and artifacts?

## Sources

- [npm: `npm audit`](https://docs.npmjs.com/cli/v10/commands/npm-audit): audit behavior, registry interaction, and documented command options for npm CLI v10 documentation.
- [SLSA specification v1.1](https://slsa.dev/spec/v1.1/): supply-chain threat model, levels, and provenance specification.
- [Sigstore Cosign: Verifying signatures](https://docs.sigstore.dev/cosign/verifying/verify/): signature and attestation verification guidance.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent supply-chain and excessive-agency context.
