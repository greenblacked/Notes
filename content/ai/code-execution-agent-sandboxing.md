---
title: Sandboxing code execution by AI agents
description: Run model-selected code with disposable isolation, bounded resources, controlled inputs, and no ambient credentials.
type: guide
tags:
  - ai
  - security
  - docker
  - linux
created: 2026-10-26
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

An agent that executes code is operating a general-purpose interpreter, not merely calling a safe “calculator” feature. Code may be generated, copied from a repository, downloaded as a dependency, or derived from an untrusted document. The code can be incorrect or malicious without the model recognizing it. Treat every execution request as untrusted input and ensure the runtime limits damage independently of model judgment. This note narrows the existing workstation and runner guidance in [[ai/sandboxing-coding-agents-on-workstations-and-runners]] to the execution boundary itself.

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Define the execution contract

Specify which language runtimes and operations are necessary, whether code is user-authored or model-produced, what files it may read and write, which network destinations it may reach, and what output is returned. Do not expose a general shell when a constrained interpreter or purpose-built operation is sufficient. Treat source code, notebooks, build scripts, package hooks, and generated test fixtures as executable, even if they arrive as “data.”

Pass only task-specific inputs into the sandbox. Use a temporary working directory or disposable volume, with no host home directory, SSH agent, cloud credentials, container socket, production kubeconfig, or other ambient secret. Mount source read-only when the task does not need to modify it. If an output must be retained, copy it out through a narrow, validated channel rather than granting the process a shared writable workspace.

## Layer isolation controls

Use a dedicated low-privilege identity and an isolation boundary appropriate to the threat model. Containerization can reduce exposure, but Docker's own security documentation says the default capabilities and mounts may provide incomplete isolation, alone or combined with kernel vulnerabilities; a container is not automatically a virtual machine. Apply a restrictive syscall profile, drop unnecessary capabilities, avoid privileged mode and host namespaces, use a read-only root filesystem where practical, and restrict devices and mounts. Docker documents seccomp as a Linux kernel feature for restricting the actions available within a container (it needs a Docker build with seccomp and a kernel with `CONFIG_SECCOMP`); it is one layer and not a substitute for filesystem, network, or identity controls.

For Kubernetes workloads, use an appropriate Pod Security Standard and workload-level restrictions. Kubernetes defines Privileged, Baseline, and Restricted policy levels; selecting a label does not prove every runtime or cluster configuration is safe. Verify effective admission policy and runtime configuration. Where a stronger boundary is needed, use a dedicated VM, microVM, or sandboxed runtime (gVisor, for example, moves kernel interfaces into a per-sandbox application kernel to reduce container-escape risk) based on an explicit threat model and operational support. Do not pass untrusted code to a privileged build agent merely because the job is short-lived.

## Bound resources and outputs

Set CPU, memory, process, disk, file descriptor, wall-clock, and output-size ceilings. Apply a hard timeout and terminate the entire execution process tree when it expires. Limit concurrency and queue depth, and budget the model calls used to generate or repair code. Prevent an unbounded loop from consuming the node or the service budget. Return only the necessary output; cap stdout/stderr and treat them as untrusted text that may contain secrets, terminal control sequences, or instructions for a later model.

Disable network access by default. If dependency retrieval or an external API is required, route it through explicit egress policy with narrow destinations and no access to internal control planes. Never assume that package-manager network access is harmless. Keep the sandbox from reaching host or cloud metadata endpoints. Where network is enabled, the receiving service should still authenticate and authorize every request.

## Handle outputs as untrusted

Do not automatically execute artifacts, shell commands, or patches emitted by the sandbox. Validate output format, size, ownership, and intended destination; scan files where appropriate; and route changes through normal human review and CI. If the sandbox creates a binary, record build inputs and provenance as required by [[ai/ai-generated-code-policy-and-provenance]]. A clean sandbox does not establish that generated output is correct, licensed, safe, or reproducible.

Preserve execution metadata: task ID, runtime image digest, policy version, resource limits, input references, output hashes, and exit state. Avoid retaining full source or logs unnecessarily. Keep the sandbox’s logs separate from trusted control messages, and do not allow child output to modify the orchestration policy. Destroy ephemeral instances after collecting approved artifacts.

## Failure cases and verification

Common weaknesses include mounting the host Docker socket (Docker states that anyone controlling its daemon, which needs root unless rootless mode is used, must be trusted), running as root with broad capabilities, sharing a writable cache between tenants, allowing network access to cloud metadata, or leaving detached child processes running after the command reports completion. Another is enforcing a timeout only in the client while the server-side process continues. Test the actual workload boundary with a synthetic non-sensitive fixture that verifies expected denied filesystem, process, and network access. Confirm resource caps and cleanup by observing the runtime and host, not only the model’s response.

Test cancellation, runtime crash, kernel or image update, capacity exhaustion, and output-copy failure. A failed cleanup should quarantine the worker or replace the execution environment rather than reusing an uncertain state. Keep base images patched and pinned by digest, but maintain a controlled update path. For provider or runtime-specific details, consult current documentation because supported isolation features differ across platforms.

## Review checklist

- Is code execution necessary, and can a narrower operation replace a shell?
- Are credentials, host sockets, namespaces, and unrelated files absent?
- Are capabilities, syscalls, filesystem writes, and network routes restricted?
- Are CPU, memory, time, process, disk, concurrency, and output limits enforced?
- Does cancellation stop the whole process tree and clean up the environment?
- Are outputs validated and kept out of automatic execution paths?
- Are runtime image, policy, inputs, and output hashes attributable to a task?
- Has effective isolation been tested in the deployed configuration?

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the Docker, Kubernetes, gVisor and OWASP LLM claims in this note, checked against local copies of those documents.

### Sources checked

- [Docker: Seccomp security profiles](https://docs.docker.com/engine/security/seccomp/): seccomp is a Linux kernel feature restricting actions available within a container; it requires a Docker build with seccomp and `CONFIG_SECCOMP`; the default profile is an allowlist disabling around 44 of 300+ system calls. Checked 2026-11-02 against docker/docs commit 53581df.
- [Docker Engine security](https://docs.docker.com/engine/security/): default capabilities and mounts may provide incomplete isolation, alone or with kernel vulnerabilities; the daemon requires root unless rootless mode is used and only trusted users should control it. Checked 2026-11-02 against docker/docs commit 53581df.
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): Privileged, Baseline and Restricted policy levels; host namespaces and privileged containers are restricted. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [gVisor documentation](https://gvisor.dev/docs/): kernel interfaces move into a per-sandbox application kernel to minimize container-escape risk. Checked 2026-11-02 against google/gvisor commit aa767e4.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM06 Excessive Agency (excessive functionality, permissions, autonomy), LLM05 output entered into a shell or exec leading to code execution, LLM10 rate limiting, timeouts and sandbox techniques. Checked 2026-11-02 against OWASP/www-project-top-10-for-large-language-model-applications commit 99f4395.

### Not verified

- The OWASP Top 10 for Agentic Applications 2026 and NIST AI 600-1 are not available locally; the earlier citation of the agentic list was replaced with the LLM Top 10 2025, and NIST remains listed only as unread context.
- Operational advice (resource ceilings, process-tree termination, egress policy, metadata endpoint blocking, output handling, cleanup and quarantine, digest pinning) is engineering guidance, not a documented claim from the sources above.
- Nothing was run.

## Sources

- [Docker: Seccomp security profiles](https://docs.docker.com/engine/security/seccomp/): syscall filtering behavior and Linux prerequisites.
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): Privileged, Baseline, and Restricted policy levels.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): Excessive Agency (LLM06), Improper Output Handling (LLM05) and Unbounded Consumption (LLM10) risks.
- [gVisor documentation](https://gvisor.dev/docs/): application-kernel sandboxing for containers.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): generative AI risk-management context (not read; see Not verified).
