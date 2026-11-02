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
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

## Isolation is layered

Give each coding-agent task a distinct branch and working directory. This prevents accidental file overwrites and makes the diff, test results, and cleanup attributable to one task. It does not make code safe, stop a malicious instruction, or isolate processes and credentials from the host. Use a separate sandbox or runner boundary when the agent executes untrusted commands; see [[sandboxing-coding-agents-on-workstations-and-runners]].

For local agents, Git worktrees provide multiple working directories attached to one repository. They share the repository object storage, the shared `refs/` namespace and the repository config by default, while `HEAD` and the index are per worktree, so a worktree is not a separate security principal or a complete clone boundary. For remote tasks or different trust levels, use separate clones, containers, VMs, or ephemeral runners according to the threat model. Do not infer isolation from the fact that a UI shows a separate task.

## Provisioning and execution

1. **Create task identity.** Allocate a unique task ID, branch, worktree or clone, and temporary credentials. Use a branch naming convention that identifies the issue or task without encoding secrets. Confirm the base commit before execution.
2. **Keep the base clean.** Start from a known commit and avoid sharing a mutable checkout with a human or another agent. Capture the initial status and refuse to reuse a dirty worktree unless its owner explicitly accepts the overlap.
3. **Scope filesystem access.** Expose only the repository and required build cache. Keep home directories, cloud credentials, SSH agents, package-manager tokens, and unrelated repositories outside the agent's accessible path. Mount build caches read-only where practical, or namespace writable caches by task.
4. **Constrain network and credentials.** Default to read-only repository access and no deployment credentials. If dependencies must be fetched, use approved registries and short-lived, narrowly scoped tokens. Separate permission to create a branch or draft pull request from permission to merge or deploy.
5. **Run checks without elevating the agent.** Tests and linters should run under a controlled CI identity. Do not let a repository script invoked by the agent inherit an operator's broad credentials. Protect secrets from untrusted fork and pull-request code; for example, GitLab CI/CD variables can be limited to protected branches and tags, and pipelines from forks do not get the parent project's variables by default. That default does not hold if a merge request pipeline for a fork is run in the parent project, because then all variables become available, so review the fork's `.gitlab-ci.yml` before triggering one.
6. **Review and integrate normally.** Require diff review, required status checks, and protected-branch rules. A successful task completion message is not an approval or a merge authorization.
7. **Reconcile and clean up.** Record task-to-branch/worktree mapping. After the work is merged or abandoned, stop processes, revoke ephemeral credentials, and remove the task worktree through `git worktree remove` (which refuses an unclean worktree unless `--force` is given, so review leftovers first) or delete the clone through the normal cleanup procedure. Preserve logs and artifacts needed for investigation without retaining sensitive prompt contents unnecessarily.

Git worktrees share repository metadata, which creates subtle collision risks: `git worktree add` refuses a branch that is already checked out in another worktree unless `--force` is used, so do not override that safeguard for agents. Because refs under `refs/` are shared (except `refs/bisect`, `refs/worktree` and `refs/rewritten`), branches and tags are shared, and by that rule so is `refs/stash`; one agent can therefore alter them for the others (an inference from the sharing rule, not a documented statement). Allocate unique branches and do not permit two writers to operate on one worktree. Keep machine-readable task metadata outside tracked source if it contains transient runtime details.

## Failure modes and recovery

Isolation can fail through inherited environment variables, mounted credential files, writable shared caches, host sockets, overly permissive CI tokens, or a command launched outside the worktree. Because objects are shared, a worktree also does not stop one process from modifying another task's shared repository objects (an inference from the documented sharing, not a documented statement). Inspect process and mount boundaries, not just directory names.

On detecting cross-task writes, stop further automation, preserve each working tree and relevant logs, identify which task wrote each file, and compare changes against the recorded base. Do not blindly reset or clean the checkout: those operations can erase another contributor's uncommitted work (`git reset --hard` discards local changes and `git clean` removes untracked files). Restore clean state only after the owner has reviewed the captured changes. If credentials may have escaped, revoke them and follow the incident process in [[runaway-or-compromised-ai-agent-response]].

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

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the Git worktree behaviours and the CI variable controls named in this note.

### Sources checked

- [git-worktree](https://git-scm.com/docs/git-worktree): a linked worktree shares everything except per-worktree files such as `HEAD` and `index`; `add` refuses a branch already checked out elsewhere unless `--force`; refs under `refs/` are shared while pseudo refs are per worktree, with `refs/bisect`, `refs/worktree` and `refs/rewritten` not shared (the docs do not mention stashes or concurrent modification of refs and objects; those points in the body are inferences); repository config is shared by default; `remove` refuses unclean worktrees unless `--force`; `prune` and `lock` manage administrative files. Checked 2026-11-02 against git commit 50fe5cc (`Documentation/git-worktree.adoc`).
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/): pipelines from forked projects cannot access the parent project's variables by default; variables can be limited to protected branches and tags; masked and protected variables can still be exposed by malicious code; running a fork merge request pipeline in the parent project makes all variables available to it, so review the fork's `.gitlab-ci.yml` first. Checked 2026-11-02 against gitlabhq commit d7b9a61 (`doc/ci/variables/_index.md`).
- [git-reset](https://git-scm.com/docs/git-reset) and [git-clean](https://git-scm.com/docs/git-clean): reset can discard local changes; clean removes untracked files from the working tree. Checked 2026-11-02 against git commit 50fe5cc (`Documentation/git-reset.adoc`, `Documentation/git-clean.adoc`).
- [GitLab CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/): the job token is described as short-lived and authenticates only certain GitLab features. Checked 2026-11-02 against gitlabhq commit d7b9a61.

### Not verified

- The GitHub Docs pages in Sources (protected branches, Actions secure use) could not be read; the branch protection and required-check statements rest on them and are unchecked.
- Statements about sandboxes, container, VM and runner boundaries, credential scoping, network limits, cache mounts and cleanup of logs are engineering guidance, not documented claims.
- The links to the sandboxing and agent-response notes are internal and were not part of this review.
- Nothing was run.

## Sources

- [Git documentation: git-worktree](https://git-scm.com/docs/git-worktree): worktree behavior and management; it does not describe a security sandbox.
- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): branch protection and required review/check controls.
- [GitHub Docs: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use): security risks and permission boundaries for workflow execution.
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/): protected variables and fork pipeline access.
- [GitLab CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/): short-lived job token.
