---
title: "Git 03: Pull requests and code review"
description: Open small, well-described pull requests, review infrastructure changes with a checklist, and set up CODEOWNERS and protected branches on GitHub or GitLab.
type: guide
tags:
  - learning
  - ci-cd
  - security
  - team-process
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 4 h | You need: [[learn/git-merge-rebase-and-undo|Git 02: Merge, rebase, conflicts and undoing mistakes]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]], plus a free personal GitHub or GitLab account with one private practice repository for exercises 6 and 7

A pull request (GitHub, Bitbucket) or merge request (GitLab) is the place where a change stops being private. Others read it, run automated checks on it and decide whether it may enter the shared branch. In infrastructure work, review is also one of your main safety controls: a Terraform or Kubernetes change goes live shortly after the merge. This lesson teaches both sides: how to send a change that is easy to approve, and how to review one so that real problems are caught and people stay willing to review your work.

> [!note] What was run
> The local Git commands in exercise 1 and the reviewer search commands in exercises 3 to 5 were run on Ubuntu 24.04.5 LTS with Git 2.43.0 on 2026-10-17, with a local bare repository as the remote. Everything that depends on GitHub or GitLab (templates, CODEOWNERS, protected branches, merge buttons) was **not run** for this lesson. Product names, menu labels and plan tiers change, so treat those parts as a description to check against the current documentation. The Terraform and Dockerfile snippets are examples to read and review; they were not applied to any cloud project.

## What you will learn

- What review is for, and what it is not for.
- How to prepare a pull request: self-review, local checks, a small size, and a split between refactor and behaviour change.
- How to write a description that tells the reviewer what, why, how it was tested, and the risk and rollback.
- How to answer review comments, and how to label your own comments as must-fix, nit or question.
- A reviewer checklist for infrastructure changes, with three worked reviews.
- How CODEOWNERS, required approvals and protected branches work, on GitHub and on GitLab, and what a merge strategy does to history.

## What review is for

Review has three jobs.

1. **Correctness.** A second pair of eyes finds mistakes the author cannot see: a wrong CIDR, a missing rollback path, an unhandled error.
2. **Sharing knowledge.** At least two people now know how the change works, why it exists and where it lives. This is how teams stop depending on one person.
3. **Reducing risk.** The reviewer asks, "what happens if this goes wrong, and how will we know?" That question is more valuable than any style comment.

It is not for showing that the reviewer is smarter, for enforcing taste that a formatter could enforce, or for the author to hand responsibility to someone else. **The author stays responsible for the change.** An approval means "I read this and I see no blocking problem", not "I take the blame". Automated tools (formatters, linters, tests, security scans) should do everything a machine can do, so humans spend their attention on design, risk and clarity. See [[standards/code-review]] for the standard a team can adopt.

## Before you open the pull request

A pull request is a request for somebody's time. Make it cheap to review.

1. **Review your own diff first.** Read it as if someone else wrote it, in the review screen of your hosting service or with `git diff main...HEAD`. You will find debug lines, stray files and unclear names before anyone else sees them.
2. **Run the checks locally.** Formatters, linters, tests and for Terraform `terraform fmt -check` and `terraform validate`. A pull request that fails the first automated check wastes the reviewer's trust.
3. **Keep it small.** Small changes get reviewed faster, get fewer mistakes through, and are easier to revert. A common guideline is that a reviewer can hold a change of a few hundred lines in their head; bigger ones tend to receive a skim and an approval. There is no exact limit that applies everywhere. Let your team agree on a rough size.
4. **Do one thing.** Separate a refactor (renaming, moving code, reformatting; no change in behaviour) from a behaviour change. When they are mixed, the reviewer has to check every renamed line for hidden behaviour changes, so the real change gets lost. A mechanical change is quick to review when it stands alone.
5. **Check the commits.** Each commit should make sense alone, as taught in [[learn/git-mental-model-and-daily-workflow|Git 01]]. If your history is messy, tidy it with the interactive rebase from [[learn/git-merge-rebase-and-undo|Git 02]] before you ask for review, or rely on squash-on-merge if your team uses it.
6. **Keep the branch fresh.** If the target branch has moved, rebase your branch onto it (your own branch only) or merge the target into it, depending on your team rule, and re-run the checks.

### Writing the description

A reviewer cannot read your mind. The description is where you explain what the diff cannot. Use a short, fixed template so nothing is forgotten. Both hosting services let a repository define a default template: GitHub reads `.github/pull_request_template.md`, and GitLab reads Markdown files in `.gitlab/merge_request_templates/` (a file named `Default.md` is used by default). Check the current documentation for the exact lookup rules.

```markdown title=".github/pull_request_template.md"
## What

One or two sentences: what this change does.

## Why

The problem or ticket (link it). Why now, and why this approach.

## How I tested it

Commands run and what you saw. For Terraform: the plan summary line
and a note on every destroy or replace. For Helm: the rendered diff.

## Risk and rollback

What could go wrong, who or what is affected, how we would notice
(dashboard or alert), and exactly how to undo it.

## Notes for the reviewer

Where to start, what is deliberately out of scope, open questions.
```

Two habits make a big difference. State the **risk** honestly (a pull request that says "no risk" for a firewall change is a red flag, not a comfort). And write the **rollback** as a step, not a hope: "revert this commit and re-apply", or "set the variable back to `3` and run the pipeline".

### Draft pull requests

Open a **draft** pull request when you want early feedback or a place for CI to run, but you do not want a formal review yet. On GitHub it is "draft pull request"; on GitLab a merge request is marked draft with a `Draft:` title prefix (older versions used `WIP:`). Mark it ready when it is. Draft status also tells your teammates not to spend time on it yet.

## Responding to review

- **Say thank you and assume good intent.** The reviewer is spending time on your work.
- **Answer every comment**: make the change and say so, or explain why not. Do not leave comments unanswered, and do not mark a thread resolved unless it is. Who resolves a thread (the author or the commenter) is a team habit.
- **Disagree with reasons.** "I considered that; it adds a dependency we do not have, so I left it" is useful. Silence or irritation is not.
- **Do not take it personally.** A comment is about the diff, not about you. If the tone is a problem, raise it privately.
- **Push fixes as new commits while review is in progress** so the reviewer can see what changed since their last look. Squash them at merge time or with an autosquash rebase before the last round. Force-pushing a rewritten branch in the middle of a review can make the reviewer lose their place (and rewrites commits the reviewer may already have commented on). Say so in the thread if you do it.

### Labelling comments

When you review, mark how much each comment matters. It saves the author guessing which comments block the merge.

| Label       | Meaning                                                                         | Blocks the merge?  |
| ----------- | ------------------------------------------------------------------------------- | ------------------ |
| `must:`     | Wrong, unsafe or breaking. Must change (or be argued down) before merging.      | Yes                |
| `should:`   | Clearly better, you would change it, but the author may disagree with a reason. | Usually no         |
| `nit:`      | A small preference such as naming or wording. Safe to ignore.                   | No                 |
| `question:` | You do not understand something. The answer may change your view.               | Not until answered |
| `praise:`   | Something good. Say it when you see it.                                         | No                 |

These exact labels are a convention you agree with your team, not a feature of GitHub or GitLab. Some teams use a published scheme, such as Conventional Comments (see Sources).

An **actionable** comment says what is wrong, why it matters, and what would fix it. Compare "this is bad" with "`must:` this firewall rule opens SSH to the whole internet. Restrict `source_ranges` to the office or VPN range, or use identity-aware access instead of a public SSH port."

### Tone and time

- Comment on the code, not the person. Ask questions instead of giving orders where you are unsure ("what happens when the list is empty?").
- Suggest, and give the reason. Offer a concrete fix when you have one. Both services support a "suggested change" that the author can apply with one click.
- Respond quickly. A pull request waiting for days blocks the author and makes batches grow bigger, which makes review worse. Google's published review guide recommends responding within one business day at most (check the guide for the current wording); pick a number for your team and measure it (see [[management/dora-metrics]] for the delivery metrics this influences).
- Do not approve to be nice, and do not block over taste.

## The reviewer checklist for infrastructure changes

Application code reviews look at logic. Infrastructure reviews also look at **blast radius**: what a mistake would break, and for how long. Use this list as a start, and extend it for your own stack. The standard in [[standards/code-review]] has the long version.

| Area            | Ask                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The real change | For Terraform, is the `plan` attached and read? Does it contain a destroy or a replace ("must be replaced") on a database, disk, cluster, bucket or IAM binding?                          |
| Access          | Is each IAM role as narrow as it can be? Is it bound on the smallest resource? No `roles/owner` or `roles/editor`, no public member such as `allUsers` without a stated reason.           |
| Network         | Does a firewall rule or load balancer open `0.0.0.0/0`? To which port? Is a narrower range possible?                                                                                      |
| Secrets         | No credentials, keys or tokens in the diff, in variables files or in the plan output you pasted. They come from a secret manager (see [[patterns/external-secrets-with-secret-manager]]). |
| Versions        | Provider, module, chart and base-image versions are pinned. No `latest`.                                                                                                                  |
| Idempotency     | Is it safe to apply twice? Does a script or job behave if it is re-run halfway?                                                                                                           |
| Rollback        | Is there a way back? If not, is that stated and agreed? A one-way migration needs a different review.                                                                                     |
| Observability   | If it breaks, will an alert fire or a dashboard show it? Is there a log to read?                                                                                                          |
| Tests and gates | Did the pipeline's policy and security checks run? See [[patterns/terraform-plan-policy-checks]] and [[patterns/sonarqube-quality-gates]].                                                |
| Scope           | Does the diff do only what the description says? Anything extra is a question.                                                                                                            |

Automate the items in this list that a machine can check (policy-as-code on the plan, a Dockerfile linter, a secret scanner) and keep the human review for judgment. A human should not be the only thing between a `0.0.0.0/0` rule and production.

## Repository rules: CODEOWNERS, approvals and protected branches

Review that depends on goodwill does not survive a bad day. The hosting service can enforce it.

### CODEOWNERS

A `CODEOWNERS` file maps paths to the people or teams who must be asked to review changes to them. The pattern syntax follows `.gitignore`. On GitHub, the file lives at `.github/CODEOWNERS`, `CODEOWNERS` in the root or `docs/CODEOWNERS`. GitLab reads `CODEOWNERS` from the root, `docs/` or `.gitlab/`. When several patterns match, the **last** matching pattern generally decides, so put general rules first and specific ones after.

```text title=".github/CODEOWNERS"
# Replace the example-org/... teams with real teams in your organisation.
# Last matching pattern wins: general first, specific last.

*                        @example-org/platform
/terraform/              @example-org/platform
/terraform/iam/          @example-org/security @example-org/platform
/.github/workflows/      @example-org/platform
Dockerfile               @example-org/platform
```

For GitLab, the same idea uses sections in square brackets, and can require a number of approvals per section:

```text title="CODEOWNERS (GitLab)"
# Replace example-group/... with real groups or users.
[Terraform]
/terraform/ @example-group/platform

[IAM changes] 2
/terraform/iam/ @example-group/security @example-group/platform
```

> [!warning] Check before relying on this
> CODEOWNERS behaviour depends on the product, version and plan. For example, whether an owner must be a team with write access, whether sections and per-section approval counts exist, whether the rule that requires owner approval is available on a free or a paid tier, and what happens when the pull request author is the only owner. Read the current GitHub and GitLab documentation for the plan you use before you rely on this for security.

### Required approvals and protected branches

Mark the shared branches as **protected**, so nobody can push to them directly or force-push them. Then add rules to merge into them. The names differ:

| Idea                                       | GitHub (branch protection rule or ruleset)                                | GitLab                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| No direct pushes, no force-push            | "Require a pull request before merging" and block force pushes            | Protected branch: set "Allowed to push" to nobody, disallow force push  |
| Number of approvals                        | "Required approvals"                                                      | Merge request approval rules                                            |
| Owners must approve                        | "Require review from Code Owners"                                         | "Code owner approval" on the protected branch (plus approval rules)     |
| Approvals go stale when the code changes   | "Dismiss stale pull request approvals when new commits are pushed"        | "Remove all approvals when commits are added to the source branch"      |
| The author cannot approve their own change | Enforced by the platform: an author cannot approve their own pull request | Setting "Prevent approval by author" in the approval rules              |
| Checks must pass                           | "Require status checks to pass"                                           | "Pipelines must succeed"                                                |
| Conversations resolved                     | "Require conversation resolution before merging"                          | "All threads must be resolved"                                          |
| Even admins follow the rules               | Do not allow bypassing the settings                                       | Do not allow admins or maintainers to bypass (where the settings allow) |

The labels in this table are paraphrased from memory of the products and are likely to have changed. Treat it as a map of which feature to look for, then read the live settings page.

> [!warning] Check before relying on this
> Which of these features are available depends on the plan tier (for example, some branch protection and approval features are limited on free plans for private repositories, and GitLab approval rules and code owner features differ by tier). Verify on the current pricing and documentation pages of your provider.

**Why the author does not approve their own change:** the whole point of review is an independent look. If the person who wrote the change can also approve it, the control protects against nothing. Two people must be involved: one writes, another reviews. Some teams add a rule that someone who pushed commits to the branch also cannot be the approver (check whether your platform supports it).

### Merge strategies and history

When you press the merge button you usually choose how the history looks. All three work; pick one per repository and say it in the contributing guide.

| Strategy         | What lands on the target                                   | Good for                                        | Cost                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge commit     | All branch commits plus a merge commit                     | Keeping the real history and each PR as a unit  | Noisy graph; messy "WIP" commits stay unless the author cleaned them                                                                                                             |
| Squash and merge | One new commit with the PR title as subject                | A clean, linear target; messy branches are fine | The individual commits are gone from the target; `git bisect` and `git blame` see one big commit; a long-running branch that continues after a squash causes confusing conflicts |
| Rebase and merge | Each branch commit replayed on the target, no merge commit | A linear history that keeps each commit         | The commits get new IDs; every commit must be good because each one is kept                                                                                                      |

With squash, **the PR title and description become the commit message**, so write them well. With merge or rebase, the quality of each commit message matters. Names differ on GitLab ("merge commit", "merge commit with semi-linear history", "fast-forward merge", and a separate "squash commits" option); check them in the project's merge settings.

## Hands-on exercises

Exercises 1 to 5 run on your lab VM with a local repository and need no account. Exercises 6 and 7 need a private practice repository on GitHub or GitLab and were not run for this lesson. Use only a repository of your own with no real data.

Start with the setup. It gives every exercise a throwaway Git home (your real `~/.gitconfig` is not read in this shell):

```bash
export HOME="$(mktemp -d)"
cd "$(mktemp -d)"
git config --global user.name "Lab User"
git config --global user.email "lab@example.com"
git config --global init.defaultBranch main
```

Expected: no output. If you see something else: an error from `mktemp` means `/tmp` is not writable; use a folder under your home directory and set `HOME` to it.

1. **Split a large change into three pull requests.** A colleague (you) made one branch with a rename, a behaviour change and some documentation. Make the repository, the big branch and a bare remote.

   ```bash
   git init -q --bare remote.git
   git clone -q remote.git pr-lab
   cd pr-lab
   mkdir -p lib deploy docs
   for i in $(seq 1 300); do echo "old_name_$i=value_$i"; done > lib/names.env
   printf 'retries=0\ntimeout=30\n' > deploy/retry.conf
   echo "# Deploy notes" > docs/deploy.md
   git add .
   git commit -m "Add baseline"
   git push -q -u origin main

   git switch -c feature/big-change
   sed -i 's/^old_name_/service_name_/' lib/names.env
   git commit -am "Rename variables"
   printf 'retries=3\ntimeout=10\n' > deploy/retry.conf
   git commit -am "Add retries and shorter timeout"
   for i in $(seq 1 40); do echo "Step $i: describe the deploy step."; done >> docs/deploy.md
   git commit -am "Document deploy steps"
   git diff --stat main...feature/big-change
   git diff --check main...feature/big-change
   ```

   Expected (illustrative): a stat of three files, `lib/names.env | 600 ++++...----`, `deploy/retry.conf | 4 +-` and `docs/deploy.md | 40 ++`, and a summary of `3 files changed, 342 insertions(+), 302 deletions(-)`. `git diff --check` prints nothing (no whitespace errors). The rename hides a two-line behaviour change in a 600-line diff: that is exactly the problem.
   If you see something else: if the warning `You appear to have cloned an empty repository` appears, ignore it. If a number differs, the loop counts or the `sed` pattern differ; the shape matters.

   Split it. Each branch starts from `main` and takes exactly one file from the big branch:

   ```bash
   git switch -q -c refactor/rename-variables main
   git restore --source=feature/big-change --staged --worktree -- lib/names.env
   git commit -m "Rename name variables"
   git switch -q -c feature/retry-policy main
   git restore --source=feature/big-change --staged --worktree -- deploy/retry.conf
   git commit -m "Add retries and shorter timeout"
   git switch -q -c docs/deploy-steps main
   git restore --source=feature/big-change --staged --worktree -- docs/deploy.md
   git commit -m "Document deploy steps"
   for b in refactor/rename-variables feature/retry-policy docs/deploy-steps; do
     echo "== $b"; git diff --shortstat main...$b
   done
   ```

   Expected: three small reviews. The rename branch shows `1 file changed, 300 insertions(+), 300 deletions(-)`, the retry branch `1 file changed, 2 insertions(+), 2 deletions(-)`, and the docs branch `1 file changed, 40 insertions(+)`. The risky change can now be read in one minute, and the rename can be reviewed by sampling because it is mechanical.
   If you see something else: if `git restore --source` is not recognised, your Git is older than 2.23: use `git checkout feature/big-change -- <path>`. If one file contained both a rename and a behaviour change, use `git checkout -p feature/big-change -- <path>` to pick hunks.

   Prove that nothing was lost. Merge the three small branches into `main` in a scratch way and compare with the original:

   ```bash
   git switch -q main
   for b in refactor/rename-variables feature/retry-policy docs/deploy-steps; do git merge -q --no-edit $b; done
   git diff --stat feature/big-change main
   ```

   Expected: no output from the last command, which means the two have identical contents. Splitting changed how the work is reviewed, not what lands. In real life you would push the three branches and open three pull requests (`git push -u origin <branch>`), ideally with the rename merged first.
   If you see something else: a listed file means a hunk was left out or doubled. Find it with `git diff feature/big-change main`.

2. **Write a description a peer can act on.** Put the template in the lab repository, then write the description for the retry change. Use the template headings from this lesson.

   ```bash
   mkdir -p .github
   cat > .github/pull_request_template.md <<'EOF'
   ## What

   ## Why

   ## How I tested it

   ## Risk and rollback

   ## Notes for the reviewer
   EOF
   git add .github/pull_request_template.md
   git commit -m "Add pull request template"
   cat .github/pull_request_template.md
   ```

   Expected: the five headings are printed, and the commit succeeds. Then write the description on paper or in a file for `feature/retry-policy`. A good answer (use your own words) reads like this:

   ```markdown
   ## What

   Retry failed deploy steps up to 3 times and lower the step timeout from 30 s to 10 s.

   ## Why

   Deploys fail on short network blips (ticket link here). A short timeout with retries
   fails faster on a real outage and survives a blip.

   ## How I tested it

   Ran the deploy script against the lab environment with the network cut for 5 s:
   it retried twice and succeeded. Ran it with the target down: it gave up after
   3 tries in about 30 s and exited non-zero.

   ## Risk and rollback

   A slow but healthy step (over 10 s) would now be cut off and retried, which could
   duplicate work if the step is not idempotent. The deploy steps here are idempotent
   (checked). Watch the deploy duration on the pipeline dashboard. Roll back by
   reverting this commit; no state change to undo.

   ## Notes for the reviewer

   Start with deploy/retry.conf. The rename is in a separate pull request.
   ```

   Check your own description against these questions: can a reviewer who has never seen the ticket tell what changes, why, what was run, what could go wrong, and how to undo it? Does it name a measurable signal to watch?
   If you see something else: if the commit fails with `nothing to commit`, check that the heredoc ended with `EOF` at the start of a line. A description that says only "fixes deploys" fails the questions above.

3. **Review a Terraform change that opens SSH to the world.** Create the practice change.

   ```bash
   cd ..
   git init -q review-lab
   cd review-lab
   mkdir -p terraform app
   cat > terraform/network.tf <<'EOF'
   resource "google_compute_firewall" "allow_ssh" {
     name      = "allow-ssh"
     network   = "default"
     direction = "INGRESS"

     source_ranges = ["203.0.113.0/24"]
     target_tags   = ["bastion"]

     allow {
       protocol = "tcp"
       ports    = ["22"]
     }
   }
   EOF
   cat > terraform/storage.tf <<'EOF'
   resource "google_storage_bucket" "assets" {
     name                        = "example-assets"
     location                    = "EU"
     uniform_bucket_level_access = true
   }
   EOF
   printf 'FROM debian:stable-slim\nCMD ["sleep", "infinity"]\n' > app/Dockerfile
   git add .
   git commit -m "Add baseline"
   git switch -c feature/open-ssh
   sed -i 's#203.0.113.0/24#0.0.0.0/0#' terraform/network.tf
   sed -i 's/example-assets"/example-assets-v2"/' terraform/storage.tf
   sed -i 's#FROM debian:stable-slim#FROM nginx:latest#' app/Dockerfile
   git commit -am "Open SSH, rename bucket, switch base image"
   git diff main...HEAD -U0 | grep -nE '^\+.*(0\.0\.0\.0/0|:latest)'
   git diff main...HEAD --stat
   ```

   Expected: the `grep` prints the added lines that contain `0.0.0.0/0` and `:latest` (with diff line numbers, which differ from file line numbers), and the stat shows three files changed. This is a reviewer's first pass: let a machine flag the obvious patterns, then read the lines around them.
   If you see something else: no `grep` output means the `sed` commands did not match; open `terraform/network.tf` to check. (A plain `grep` is a helper, not a control: use a real policy check in your pipeline.)

   Now write the review comment for the firewall rule. A good answer, with the label and the reason, is:

   ```text
   must: terraform/network.tf, line 6. `source_ranges = ["0.0.0.0/0"]` opens SSH (tcp/22) on
   every instance tagged `bastion` to the whole internet. Restrict it to the office or VPN range
   (for example `["203.0.113.0/24"]`, replace with ours), or remove the public rule and use
   identity-aware access to reach the host. If a wide range is really needed, explain why in
   the description and name the compensating control. Blocking until this is changed.
   ```

   Expected outcome of the review: **request changes** (blocking). The author narrows the range, you re-check the new plan, and you approve.
   If you see something else: if you want to be sure what the fix looks like, restore the original with `git diff main...HEAD -- terraform/network.tf` and see that the old line was the narrow range.

4. **Review a bucket rename that forces replacement.** Read the diff for `terraform/storage.tf` with `git diff main...HEAD -- terraform/storage.tf`.

   Expected: one changed line, `name = "example-assets"` becoming `name = "example-assets-v2"`. It looks harmless. The plan would not be:

   ```text
   # google_storage_bucket.assets must be replaced
   -/+ resource "google_storage_bucket" "assets" {
         ~ name = "example-assets" -> "example-assets-v2" # forces replacement
           # (other attributes hidden)
       }

   Plan: 1 to add, 0 to change, 1 to destroy.
   ```

   _Illustrative plan output; the exact text depends on the provider version._ A Cloud Storage bucket name cannot be changed in place, so Terraform destroys the old bucket and creates a new, empty one. The data in the old bucket is not copied. Depending on `force_destroy`, the apply either fails because the old bucket is not empty, or deletes the objects (check the current provider documentation for the exact behaviour). Either way it is a blocking comment:

   ```text
   must: terraform/storage.tf, line 2. Changing `name` forces replacement of the bucket
   (the plan shows destroy and create). Bucket names are immutable and the objects
   do not move. If you only want a different Terraform resource label, rename the
   resource and add a `moved` block, which changes the address and not the bucket.
   If the bucket itself must have a new name: create the new bucket as a separate
   resource, copy the objects (for example with `gcloud storage cp` or `rsync`),
   switch the readers over, and remove the old one in a later pull request after
   checking nothing uses it. Please attach the plan once changed.
   ```

   Expected outcome: **request changes** (blocking), because the change loses data or breaks the apply.
   If you see something else: if you think a `moved` block fixes a renamed bucket name, re-read the comment: `moved` tells Terraform that a resource moved to a new address in the configuration. It does not rename the real object.

5. **Review a Dockerfile that uses `latest`.** Run `git diff main...HEAD -- app/Dockerfile`.

   Expected: `-FROM debian:stable-slim` and `+FROM nginx:latest`, and a switch of the whole base image. The tag `latest` changes whenever the maintainers push; the same Dockerfile builds a different image next week, so builds are not reproducible and a security fix or a breaking change can arrive without any commit. This is a **non-blocking** comment if the team has a policy to fix it later, and blocking if your pipeline enforces pinned images:

   ```text
   should: app/Dockerfile, line 1. `nginx:latest` is not reproducible. Pin to a version you
   have tested, and optionally the digest, so a rebuild gives the same image and updates are a
   reviewed change. For example, pass the version in as a build argument:
   `ARG NGINX_VERSION` then `FROM nginx:${NGINX_VERSION}`, with the value set in CI. Also, why
   the change from debian:stable-slim to nginx? The description does not say.
   See patterns/dockerfile-hardening.
   ```

   Expected outcome: **approve with comments** if the rest is fine and the team treats pinning as a follow-up, **request changes** if pinning is enforced. The question about the base image change is a real `question:` because a base-image switch changes the whole runtime.
   If you see something else: if you are unsure whether it should block, check your team's standard. See [[patterns/dockerfile-hardening]] for how pinning fits into image security.

6. **CODEOWNERS requests a review automatically (hosted, not run).** In your private practice repository on GitHub or GitLab, add a `CODEOWNERS` file as shown above, with yourself or a second account as the owner of `/terraform/`. Commit it to the default branch. Then branch, change a file in `terraform/`, push the branch and open a pull request or merge request.

   Expected: the owner is added as a requested reviewer without anyone choosing them. If you then turn on the rule that requires code owner approval for the default branch, the merge button stays disabled until the owner approves. Test it by changing a file outside `/terraform/`: the owner is not requested.
   If you see something else: if no reviewer is requested, check the file path and name, the branch it is on, whether the owner has access to the repository, and the plan tier (see the callout above). A solo account may not be able to request a review from itself or approve its own change, which is the rule working as intended.

7. **End-to-end flow (hosted, not run).** On the same practice repository, push the branch `feature/retry-policy` from exercise 1 and open it as a **draft** pull request. Use the description you wrote. Ask a friend or a second account to leave one `nit:` and one `must:` comment. Answer both, push a fix as a new commit, mark the pull request ready, and merge it with your team's chosen strategy. Look at the resulting history with `git log --oneline --graph` after pulling.

   Expected: a draft that CI runs on; a ready pull request after your fixes; a merge that appears as a merge commit, a single squashed commit or a rebased series, depending on the strategy you chose.
   If you see something else: if the merge button is disabled, the page lists the unmet rule (missing approval, failing check, unresolved thread). That is the protection working.

Cleanup: close the terminal, or delete the temporary directory. Delete the practice repository on the hosting service when you have finished with it.

## Common mistakes

- **One huge pull request.** Why it bites: nobody reviews 900 lines properly, so the review becomes a skim and the real bug passes. Fix: split by purpose (refactor, behaviour, docs), and merge the mechanical change first.
- **Mixing a refactor with a behaviour change.** Why it bites: the reviewer cannot tell which lines matter. Fix: separate pull requests.
- **A description of "fix" or "update".** Why it bites: the reviewer must reverse-engineer the intent, and a future reader has no history of why. Fix: use the template; always give the why, the test and the rollback.
- **Reviewing only the diff of a Terraform file.** Why it bites: a one-line change can destroy a resource (the bucket rename above). Fix: read the plan, not only the code.
- **Blocking on taste.** Why it bites: the author learns that review is a fight, and starts avoiding reviewers. Fix: label `nit:` and let it go, or automate the style rule.
- **Approving without reading ("LGTM").** Why it bites: the approval gives false safety. Fix: say what you checked, or say you only looked at part of it.
- **Force-pushing during review.** Why it bites: the reviewer loses the history of their comments. Fix: push fixes as new commits during review and tidy at the end, announcing it.
- **Leaving a pull request for days.** Why it bites: conflicts grow and the author's context fades. Fix: agree a response time, and review in the first part of the working day.
- **Letting the author approve or merge around the rules.** Why it bites: the control does not control anything. Fix: protected branches, required approvals and no bypass for admins.
- **Pasting a secret into a comment or description.** Why it bites: it is visible to everyone with access and stays in the history. Fix: never paste secrets; if it happened, rotate (see [[runbooks/leaked-credential-rotation]]).

## Check your understanding

1. Why do small pull requests produce better reviews and fewer incidents?
2. What makes a review comment actionable? Rewrite "this is risky" so that it is.
3. Why is it a bad idea for the author to approve their own change?
4. A pull request changes `name` on a `google_storage_bucket` and nothing else. What is the risk, and what do you ask for before approving?
5. What does CODEOWNERS do, and what does it not do on its own?
6. You can choose between merge commit, squash and rebase-merge. Name one reason to pick squash and one reason against it.

> [!question]- Answers
>
> 1. A small change fits in the reviewer's head, so they actually read it. Mistakes have fewer places to hide, review is fast, a bug is easier to bisect to its cause, and a revert undoes one thing. Large changes get a skim and an approval.
> 2. It says what is wrong, why it matters and what would fix it, and says whether it blocks. For example: "`must:` this role is granted on the whole project, but the job only writes to one bucket. Grant `roles/storage.objectCreator` on that bucket instead, so a leaked key cannot write elsewhere."
> 3. The reason for review is an independent look. If the author can also approve, the control is only a click and checks nothing. Two different people must be involved.
> 4. Changing a bucket's `name` forces replacement: the old bucket is destroyed (or the apply fails if it has objects) and a new empty one is created, so data is lost or the apply breaks. Ask for the plan, and for a safe approach: keep the name, or create the new bucket, copy the objects, switch readers and remove the old one later. A `moved` block does not rename the real bucket.
> 5. It maps paths to owners and requests their review automatically on a change to those paths. On its own it only requests; it forces an approval only when the branch protection setting that requires code owner review is enabled (and the plan supports it).
> 6. For squash: a clean linear history, and messy "WIP" commits do not reach the target. Against: the individual commits disappear, so `git bisect` and `git blame` see one large commit, and a long-running branch that continues after a squash can produce confusing conflicts.

## Next steps

Next stage: scripting, starting with [[learn/bash-scripting-fundamentals|Scripting 01: Bash scripting fundamentals]]. Previous lesson: [[learn/git-merge-rebase-and-undo|Git 02: Merge, rebase, conflicts and undoing mistakes]].

For going deeper as a senior engineer:

- [[standards/code-review]] for a review standard for infrastructure code that a team can adopt.
- [[patterns/sonarqube-quality-gates]] for automated quality gates that remove style and basic-bug comments from human review.
- [[patterns/terraform-plan-policy-checks]] to check the plan automatically for destroys and open ranges.
- [[patterns/dockerfile-hardening]] for image pinning and other Dockerfile review points.
- [[management/dora-metrics]] for how review time shows up in delivery metrics.
- Using AI to help review: the owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com). Use an assistant to explain unfamiliar code or to suggest questions to ask, never to replace your own reading, and never paste secrets, customer data or internal configuration into one that your organisation has not approved.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Google Engineering Practices, "The Standard of Code Review", "What to look for in a code review", "Writing good CL descriptions", "Small CLs", "Speed of code reviews" and "How to handle reviewer comments" (https://google.github.io/eng-practices/review/).
- GitHub Docs: about pull requests, about protected branches and rulesets, about code owners, creating a pull request template, merge methods (https://docs.github.com). Not verified: the current names of settings and which plan tiers include each feature.
- GitLab Docs: merge requests, protected branches, merge request approvals, code owners, merge request templates, merge methods (https://docs.gitlab.com). Not verified: the current names of settings and which tiers include each feature.
- Git documentation: `git-diff`, `git-restore`, `git-range-diff` (https://git-scm.com/docs).
- Conventional Comments (https://conventionalcomments.org). Not verified against the current site.
- Terraform documentation: `moved` blocks and `terraform plan` output; Google provider documentation for `google_storage_bucket` (https://developer.hashicorp.com/terraform and https://registry.terraform.io/providers/hashicorp/google/latest/docs). Not verified: the `force_destroy` behaviour and the text of the plan output for the current provider version.
- Versions checked for the local commands: Git 2.43.0 on Ubuntu 24.04.5 LTS, on 2026-10-17.
