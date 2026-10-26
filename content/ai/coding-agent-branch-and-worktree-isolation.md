---
title: Branch and worktree isolation for coding agents
description: Separate concurrent agent changes and limit their credentials while preserving normal review and integration controls.
type: guide
tags:
  - ai
  - ci-cd
  - gitlab-ci
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Isolation is layered

Give each coding-agent task a distinct branch and working directory. This prevents accidental file overwrites and makes the diff, test results, and cleanup attributable to one task. It does not make code safe, stop a malicious instruction, or isolate processes and credentials from the host. Use a separate sandbox or runner boundary when the agent executes untrusted commands; see [[sandboxing-coding-agents-on-workstations-and-runners]].

For local agents, Git worktrees provide multiple working directories attached to one repository. They share repository object storage and refs, so a worktree is not a separate security principal or a complete clone boundary. For remote tasks or different trust levels, use separate clones, containers, VMs, or ephemeral runners according to the threat model. Do not infer isolation from the fact that a UI shows a separate task.

## Provisioning and execution

1. **Create task identity.** Allocate a unique task ID, branch, worktree or clone, and temporary credentials. Use a branch naming convention that identifies the issue or task without encoding secrets. Confirm the base commit before execution.
2. **Keep the base clean.** Start from a known commit and avoid sharing a mutable checkout with a human or another agent. Capture the initial status and refuse to reuse a dirty worktree unless its owner explicitly accepts the overlap.
3. **Scope filesystem access.** Expose only the repository and required build cache. Keep home directories, cloud credentials, SSH agents, package-manager tokens, and unrelated repositories outside the agent's accessible path. Mount build caches read-only where practical, or namespace writable caches by task.
4. **Constrain network and credentials.** Default to read-only repository access and no deployment credentials. If dependencies must be fetched, use approved registries and short-lived, narrowly scoped tokens. Separate permission to create a branch or draft pull request from permission to merge or deploy.
5. **Run checks without elevating the agent.** Tests and linters should run under a controlled CI identity. Do not let a repository script invoked by the agent inherit an operator's broad credentials. Protect secrets from untrusted fork and pull-request code.
6. **Review and integrate normally.** Require diff review, required status checks, and protected-branch rules. A successful task completion message is not an approval or a merge authorization.
7. **Reconcile and clean up.** Record task-to-branch/worktree mapping. After the work is merged or abandoned, stop processes, revoke ephemeral credentials, and remove the task worktree or clone through the normal cleanup procedure. Preserve logs and artifacts needed for investigation without retaining sensitive prompt contents unnecessarily.

Git worktrees share repository metadata, which creates subtle collision risks: two agents may attempt to check out the same branch, alter shared refs, or use a shared index or stash workflow incorrectly. Allocate unique branches and do not permit two writers to operate on one worktree. Keep machine-readable task metadata outside tracked source if it contains transient runtime details.

## Failure modes and recovery

Isolation can fail through inherited environment variables, mounted credential files, writable shared caches, host sockets, overly permissive CI tokens, or a command launched outside the worktree. A worktree also does not stop one process from modifying another task's shared repository objects. Inspect process and mount boundaries, not just directory names.

On detecting cross-task writes, stop further automation, preserve each working tree and relevant logs, identify which task wrote each file, and compare changes against the recorded base. Do not blindly reset or clean the checkout: those operations can erase another contributor's uncommitted work. Restore clean state only after the owner has reviewed the captured changes. If credentials may have escaped, revoke them and follow the incident process in [[runaway-or-compromised-ai-agent-response]].

When an agent cannot write, first distinguish intended policy from configuration failure. Do not solve a permission failure by granting repository-wide or organization-wide write access. Re-evaluate whether the requested action actually needs a write token.

## Decision checklist

- Does each concurrent task have a unique branch and writable directory?
- Is the initial commit and clean/dirty state recorded?
- Are shared Git metadata, caches, sockets, and mounts understood?
- Are credentials short-lived, least-privilege, and unavailable to routine test commands?
- Are network access and artifact retention bounded?
- Are merge, release, and deploy permissions withheld from autonomous execution?
- Is there a safe procedure to preserve changes before cleanup or reset?

Use the smallest isolation that contains the task's realistic risk. A trusted documentation edit may need only a separate worktree and review. A task that runs arbitrary repository scripts needs process, filesystem, and credential isolation in addition to branch separation.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Git documentation: git-worktree](https://git-scm.com/docs/git-worktree): worktree behavior and management; it does not describe a security sandbox.
- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): branch protection and required review/check controls.
- [GitHub Docs: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use): security risks and permission boundaries for workflow execution.
