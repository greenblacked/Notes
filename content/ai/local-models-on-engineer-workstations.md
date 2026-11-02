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
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note sets a baseline for engineers who run open-weight models on a laptop, workstation or personal dev VM. It is for platform and security engineers who write the policy and for engineers who follow it. It covers approved sources and licences, artifact scanning, data classes, disk encryption, network exposure of local servers, resource limits, updates, and the cases where local is the wrong answer. It does not cover the full risk assessment of a model ([[open-weight-model-risk-assessment]]), the artifact promotion pipeline ([[model-supply-chain-verification]], [[model-artifacts-in-artifactory]]), isolating coding agents ([[sandboxing-coding-agents-on-workstations-and-runners]]) or shared serving in a cluster ([[self-hosted-llm-inference-on-gke]]).

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

Map each class in [[data-classification-and-handling-standard]] to what may reach a local model. These rules follow the standard; where they differ, the standard wins:

| Class        | Local model use                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public       | Allowed on an approved, encrypted, managed device                                                                                                                                                 |
| Internal     | Only through a local tool that is on the approved list, on an approved, encrypted, managed device                                                                                                 |
| Confidential | The standard allows it only in approved tools behind the gateway's redaction; a local model bypasses the gateway, so it is not allowed unless an approved exception records an equivalent control |
| Restricted   | **Never**: not in local prompts, caches, logs, fine-tuning data or files on the workstation. The standard allows no Restricted data on workstations or in AI tools, and a local model is both     |

Prompt caches, conversation history and logs are data at rest on the same disk. Redact before calls where the class demands it ([[redacting-sensitive-data-before-llm-calls]]). Content capture in traces is opt-in and may contain personal data, so the local default is metadata only: model, token counts, latency, errors. Enabling content capture needs a classification decision ([[llm-tracing-with-sensitive-data-controls]]).

### Disk encryption and device state

Weights, caches, spill files and logs all land on disk. Require full-disk encryption and managed-device enrolment before weights or anything above public data arrive. Treat this as a policy baseline from your own standard, not a claim from an external source. Unmanaged personal machines get public data only, or nothing.

### Network exposure of local servers

Bind to loopback. The MCP transport specification says local servers should bind to 127.0.0.1 rather than 0.0.0.0 and must validate the Origin header to stop DNS rebinding from a web page; the same reasoning applies to a model server. Documentation examples often use `--host 0.0.0.0`; policy overrides copied examples.

```bash
# Container: publish to loopback only, never "-p 8000:8000".
# Docker documents publishing as reachable from outside the host unless
# an address such as 127.0.0.1 is given.
# The server inside the container must listen on the container's own
# interface (for example --host 0.0.0.0 inside the container) for the
# mapping to work; the host side of the mapping is what must be loopback.
# Example limits only; size them for your machine.
image_digest="${INFERENCE_IMAGE_DIGEST:?set the pinned image digest}"
docker run --rm \
  --cpus 8 --memory 32g \
  -p 127.0.0.1:8000:8000 \
  "registry.internal.example/inference-server@sha256:${image_digest}"
```

Two further points from the inference server security guidance. The API key option covers only the routes under some path prefixes, and other sensitive endpoints on the same server need no key, so it is not a perimeter; if a server must be shared, put an authenticating proxy that allowlists routes in front of it. Inter-node traffic in multi-node setups is insecure by default and must sit on an isolated network, so do not cluster workstations on the office network. Docker documents that releases older than 28.0.0 let hosts on the same L2 segment reach ports published to localhost, so keep the container engine current. In rootless mode the `--cpus` and `--memory` flags are enforced only with cgroup v2 and systemd, and are otherwise ignored; check that `docker info` shows a Cgroup Driver other than `none` to confirm the limits apply. Anything shared beyond one user is the wrong shape for a workstation (see below).

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

The UID, sizes and scratch path are examples; the server may need further writable paths (for example a model cache) under a read-only root filesystem. Containers in a pod share one network namespace, so binding to loopback inside a pod only reaches that pod's own containers, so adjust for how you actually expose it (for example port-forward); do not switch to a wide bind to make it work.

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
- Restricted data reaches a local model at all, in prompts, caches or logs. The standard never allows it on a workstation or in an AI tool, encrypted disk or not.
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

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the network exposure, data-at-rest, supply-chain, container and CI claims in this note were compared with local copies of the primary documentation.

### Sources checked

- [MCP specification, Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): servers MUST validate the Origin header against DNS rebinding and SHOULD bind locally to 127.0.0.1 rather than 0.0.0.0; the 2025-06-18 transports page has the same two requirements. Checked 2026-11-02 against modelcontextprotocol commit d0e246e.
- [Inference server security guide](https://docs.vllm.ai/en/latest/usage/security/): inter-node traffic is insecure by default and needs an isolated network; the API key covers only the /v1, /v2, /inference and /cohere prefixes while endpoints such as /invocations, /score and /rerank need no key; a reverse proxy that allowlists endpoints and adds authentication is the recommended approach. Other examples in the same documentation use `--host 0.0.0.0` and `--host 127.0.0.1`. Checked 2026-11-02 against vllm commit 8530a77.
- [GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md): message content is sensitive; instrumentations SHOULD NOT capture it by default and SHOULD let users opt in. Checked 2026-11-02 against semantic-conventions-genai commit 244465e.
- [GenAI client inference](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/client-inference.md): `gen_ai.input.messages` and `gen_ai.output.messages` are Opt-In. Checked 2026-11-02 against semantic-conventions-genai commit 244465e.
- [Resource Quotas | Kubernetes](https://kubernetes.io/docs/concepts/policy/resource-quotas/): quotas limit aggregate resource consumption per namespace. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Pod Security Standards | Kubernetes](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and [Application security checklist](https://kubernetes.io/docs/concepts/security/application-security-checklist/): `runAsNonRoot`, dropping ALL capabilities, RuntimeDefault seccomp, `automountServiceAccountToken: false` and `readOnlyRootFilesystem: true` as hardening settings. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Volumes | Kubernetes](https://kubernetes.io/docs/concepts/storage/volumes/) and [Use Port-Forwarding to Access Applications in a Cluster](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/): `emptyDir` `sizeLimit`; port-forward listens on 127.0.0.1. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Pods | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/): containers in a Pod share the network namespace, including the IP address and ports. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Rootless mode tips | Docker](https://docs.docker.com/engine/security/rootless/tips/): `--cpus`, `--memory` and `--pids-limit` work in rootless mode only with cgroup v2 and systemd, and are otherwise ignored; `docker info` showing `none` as Cgroup Driver means the conditions are not met. Checked 2026-11-02 against docker-docs commit 53581df.
- [Publish or expose ports | Docker](https://docs.docker.com/engine/network/port-publishing/): published ports are reachable from outside the host by default; adding 127.0.0.1 restricts them to the Docker host; releases older than 28.0.0 let same-L2 hosts reach localhost-published ports. Checked 2026-11-02 against docker-docs commit 53581df.
- [Job rules | GitLab](https://docs.gitlab.com/ci/jobs/job_rules/) and [Predefined variables](https://docs.gitlab.com/ci/variables/predefined_variables/): `rules:if` with `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`, the `changes` list form, and the meaning of both variables. Checked 2026-11-02 against gitlabhq commit d7b9a61.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM03 lists licensing risks; LLM04 states that malicious pickling in models from shared repositories can execute code when the model is loaded; LLM02 and LLM10 cover sensitive information disclosure and unbounded consumption. Checked 2026-11-02 against owasp-llm commit 99f4395.

### Not verified

- Nothing was run: the fetch script, CI job and container and pod manifests were not executed.
- That protecting the default branch is sufficient control for the promotion job; GitLab docs were read only for the rule syntax.
- Which scanner supports which weight formats, and that a tensor-only format such as a tensor-only weight format cannot run code on load; check the scanner and format documentation.
- Licence terms of any model, MDM and disk-encryption settings, and the data-class mapping, which rests on the internal data classification standard, not an external source.
- NIST AI Risk Management Framework: not reachable locally, kept as governance framing only.
- Engineering guidance, not claim by claim: allowlists, digest pinning, mirror use, update cadence, systemd limits and the "when local is the wrong answer" questions.

## Sources

- [MCP specification, Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): loopback binding and Origin validation against DNS rebinding; the same requirement appears in the 2025-06-18 revision.
- [Inference server security guide](https://docs.vllm.ai/en/latest/usage/security/): API key scope limits, unauthenticated endpoints, insecure-by-default inter-node traffic.
- [OpenTelemetry GenAI span conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md) and [client inference](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/client-inference.md): content attributes are opt-in and may hold personal data.
- [Kubernetes resource quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/): the team-level resource budget analogy.
- [Publish or expose ports | Docker](https://docs.docker.com/engine/network/port-publishing/): publishing to loopback only.
- [Job rules | GitLab](https://docs.gitlab.com/ci/jobs/job_rules/): rules syntax used in the promotion job.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): governance framing; not reachable for review, see Not verified.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): threat framing for sensitive information disclosure, supply chain, model poisoning and unbounded consumption.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
