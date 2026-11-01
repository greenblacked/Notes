---
title: Local models on engineer workstations
description: Governance for engineers running open-weight models locally, covering sources, licences, scanning, data classes, encryption, network exposure, limits and updates.
type: pattern
tags:
  - ai
  - security
  - supply-chain
  - policy-as-code
created: 2026-11-01
modified: 2026-11-01
draft: false
---

This note sets a baseline for engineers who run open-weight models on a laptop, workstation or personal dev VM. It is for platform and security engineers who write the policy and for engineers who follow it. It covers approved sources and licences, artifact scanning, data classes, disk encryption, network exposure of local servers, resource limits, updates, and the cases where local is the wrong answer. It does not cover the full risk assessment of a model ([[open-weight-model-risk-assessment]]), the artifact promotion pipeline ([[model-supply-chain-verification]], [[model-artifacts-in-artifactory]]), isolating coding agents ([[sandboxing-coding-agents-on-workstations-and-runners]]) or shared serving in a cluster ([[self-hosted-llm-inference-on-gke]]).

> [!note] Not verified
> No procedure here was run. The sources below were not all fetched, and two public URLs are path mappings from local copies. Before use, check: the current security page of your inference server (which endpoints an API key covers, defaults for inter-node traffic), the licence text of every model you approve, which scanner you will use for weight files and its supported formats, your MDM and disk encryption settings, and the GitLab CI syntax for your edition. No VRAM or performance figures are given because none were benchmarked.

## Practical guidance

### Approved sources and licences

Keep an allowlist of model, version, licence and source. Engineers pull from the internal mirror, never from an arbitrary download page or by model name. Pin by content digest, record it, and reject a mismatch.

"Open-weight" is a licence statement, not a provenance or safety claim. Licences differ in commercial use, acceptable-use and redistribution terms and change over time. Do not summarise a licence in policy; link the licence text per allowlist entry and have the owner review it ([[open-weight-model-risk-assessment]]).

A fetch script that fails closed:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Usage: fetch-model.sh <name> <version> <expected-sha256>
name="$1"; version="$2"; expected="$3"
mirror="https://models.internal.example/${name}/${version}"
dest="${HOME}/models/${name}/${version}"

mkdir -p "${dest}"
curl --fail --silent --show-error -o "${dest}/weights.safetensors" \
  "${mirror}/weights.safetensors"

actual="$(sha256sum "${dest}/weights.safetensors" | cut -d' ' -f1)"
if [[ "${actual}" != "${expected}" ]]; then
  rm -f "${dest}/weights.safetensors"
  echo "digest mismatch for ${name} ${version}" >&2
  exit 1
fi
```

### Artifact scanning and formats

Some checkpoint formats can execute code when loaded. Policy intent: require a tensor-only format where one exists, and scan the artifact in the central pipeline before it is promoted to the mirror, so a workstation never loads an unscanned file. Name the scanner only after you have verified it supports your formats. Scanning is not proof of safety; it lowers one class of risk.

A promotion job in GitLab CI that runs only on the default branch (protect that branch so only reviewed changes reach it):

```yaml
promote-model:
  stage: deploy
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      changes:
        - models/allowlist.yaml
  script:
    - set -euo pipefail
    - ./scripts/verify-digests.sh models/allowlist.yaml
    - ./scripts/scan-artifacts.sh models/allowlist.yaml
    - ./scripts/promote-to-mirror.sh models/allowlist.yaml
```

### Data classes allowed

Map each class in [[data-classification-and-handling-standard]] to what may reach a local model. A workable default:

| Class                                             | Local model use                                        |
| ------------------------------------------------- | ------------------------------------------------------ |
| Public, internal code and docs                    | Allowed on an approved, encrypted, managed device      |
| Confidential                                      | Only with owner sign-off and the controls named in it  |
| Restricted (customer PII, credentials, regulated) | Not in local prompts, caches or logs without a control |

Prompt caches, conversation history and logs are data at rest on the same disk. Redact before calls where the class demands it ([[redacting-sensitive-data-before-llm-calls]]). Content capture in traces is opt-in and may contain personal data, so the local default is metadata only: model, token counts, latency, errors. Enabling content capture needs a classification decision ([[llm-tracing-with-sensitive-data-controls]]).

### Disk encryption and device state

Weights, caches, spill files and logs all land on disk. Require full-disk encryption and managed-device enrolment before weights or anything above public data arrive. Treat this as a policy baseline from your own standard, not a claim from an external source. Unmanaged personal machines get public data only, or nothing.

### Network exposure of local servers

Bind to loopback. The MCP transport specification says local servers should bind to 127.0.0.1 rather than 0.0.0.0 and must validate the Origin header to stop DNS rebinding from a web page; the same reasoning applies to a model server. Documentation examples often use `--host 0.0.0.0`; policy overrides copied examples.

```bash
# Container: publish to loopback only, never "-p 8000:8000".
# Inside the container the server listens on all of the container's
# interfaces; the host side of the mapping is what must be loopback.
# Example limits only; size them for your machine.
image_digest="${INFERENCE_IMAGE_DIGEST:?set the pinned image digest}"
docker run --rm \
  --cpus 8 --memory 32g \
  -p 127.0.0.1:8000:8000 \
  "registry.internal.example/inference-server@sha256:${image_digest}"
```

Two further points from the inference server security guidance. The API key option covers only the routes under some path prefixes, and other sensitive endpoints on the same server need no key, so it is not a perimeter; if a server must be shared, put an authenticating proxy that allowlists routes in front of it. Inter-node traffic in multi-node setups is insecure by default and must sit on an isolated network, so do not cluster workstations on the office network. Anything shared beyond one user is the wrong shape for a workstation (see below).

### Resource limits

A runaway model can starve the machine and the engineer's own work ([[llm-denial-of-service-and-resource-exhaustion]]). Set concurrency and GPU memory caps in the serving config, and add OS-level limits with systemd or container limits. On a dev cluster or VM running containers, the same applies in manifests. Kubernetes quotas are the team-level analogy; they do not replace workstation limits.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: local-model-dev
spec:
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: server
      image: registry.internal.example/inference-server@sha256:<pinned-digest>
      args: ["--host", "127.0.0.1"]
      resources:
        requests:
          cpu: "4"
          memory: 16Gi
        limits:
          cpu: "8"
          memory: 32Gi
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: scratch
          mountPath: /tmp
  volumes:
    - name: scratch
      emptyDir:
        sizeLimit: 2Gi
```

The UID, sizes and scratch path are examples; the server may need further writable paths (for example a model cache) under a read-only root filesystem. Binding to loopback inside a pod only reaches that pod's own network namespace, so adjust for how you actually expose it (for example port-forward); do not switch to a wide bind to make it work.

### Updates

Treat the model and its serving runtime as pinned, versioned dependencies. Upgrade models through a regression check ([[model-version-pinning-and-upgrade-evals]]). Give runtime security fixes a fast path, and publish which runtime version is approved so engineers can see when theirs is stale. Retire models by removing them from the allowlist and the mirror, then ask engineers to delete local copies.

### When local is the wrong answer

Use these as review questions, not measured thresholds:

- Does the work need audit logs or central observability? Use a managed or central service.
- Does the model fit available memory without heavy quantization hurting quality ([[quantization-quality-and-performance-tradeoffs]])?
- Does the output feed a production SLO?
- Do several teammates need the same endpoint?
- Is the data above what an individual device may hold?

Local fits individual experimentation and personal work inside the data-class limits.

## Failure modes

- A copied example binds to all interfaces and a laptop on shared Wi-Fi serves an unauthenticated model.
- An API key is treated as full protection while other routes stay open.
- Weights are pulled by name from a public page; the file changes or is tampered with and nobody notices.
- A pickle-based checkpoint is loaded before any scan.
- A model's licence forbids the intended use, discovered after code ships.
- Restricted data lands in prompt caches or logs on an unencrypted disk.
- Content capture is switched on for debugging and never switched off.
- An engineer clusters two machines for more memory, exposing unauthenticated inter-node traffic.
- Stale runtimes keep running long after a security fix.
- A local prototype quietly becomes a team dependency with no owner or logs.

## Review checklist

- [ ] Allowlist records model, version, licence text link, source and digest.
- [ ] Weights come from the internal mirror and digests are verified before use.
- [ ] A tensor-only format is required where available, and artifacts are scanned centrally.
- [ ] Allowed data classes for local use are written down and match the standard.
- [ ] Full-disk encryption and managed-device enrolment are checked before weights are installed.
- [ ] Servers bind to 127.0.0.1 and the Origin header is validated where a browser can reach them.
- [ ] No server is shared or clustered without an authenticating proxy or isolated network.
- [ ] Concurrency, GPU memory and OS-level resource limits are set.
- [ ] Trace content capture is off by default and needs sign-off.
- [ ] Approved model and runtime versions are published, with a fast path for security fixes.
- [ ] Engineers know the criteria for moving a workload to a central service.

## Sources

- [MCP specification, Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) — loopback binding and Origin validation against DNS rebinding; the same requirement appears in the 2025-06-18 and 2026-07-28 revisions.
- [Inference server security documentation](https://docs.vllm.ai/en/latest/usage/security/) — API key scope limits, the endpoints the key does not cover, and insecure-by-default inter-node traffic; public URL is a path mapping from a local copy, not fetched.
- [OpenTelemetry GenAI span conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) — content attributes are opt-in and may hold personal data; public URL is a path mapping, not fetched.
- [Kubernetes resource quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) — the team-level resource budget analogy.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — governance framing; cited as canonical, not fetched.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) — threat framing for sensitive information disclosure, supply chain and unbounded consumption; not fetched.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
