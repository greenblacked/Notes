---
title: "Security 01: Security basics every DevOps engineer must know"
description: "Practical security for ops work: keep secrets out of Git, rotate leaks, least privilege, phishing-resistant MFA, signed commits, hooks and a safer CI supply chain."
type: guide
tags:
  - learning
  - security
  - gcp
  - ci-cd
  - supply-chain
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 6 h | You need: [[learn/git-merge-rebase-and-undo|Git 02: Merge, rebase, conflicts and undoing mistakes]], [[learn/gcp-iam-and-service-accounts|GCP 02: IAM and service accounts]] and [[learn/terraform-state-modules-and-pipelines|Delivery 05: Terraform state, remote backends, modules and pipelines]] | Lab: Lab A (Linux) for the Git exercises, Lab C (the GCP sandbox project) for the Secret Manager and IAM exercises, both from [[learn/lab-setup|Start 01: Set up your lab]]

Most security incidents in operations are not clever. A key committed to Git. A token with far more rights than the job needed. A person who clicked a login page that was not the real one. A CI job that ran code nobody had looked at. This lesson teaches the small set of habits that stop most of them, and gives you a lab exercise for each one.

> [!note] What was run
> Nothing in this lesson was run for this page: there was no `gitleaks` binary, `gcloud` or GCP project in the environment where it was written, and the Git, SSH signing and hook steps were not run either. The commands and sample output follow the official documentation and are **not verified**. Rule IDs, flag names and the exact text of tool output change between versions, so compare with your own output. All keys and tokens in this lesson are fake, and the fake key is built at run time so that no secret-looking text sits in the page.

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your security team, auditor or counsel decides what your organisation requires.

## What you will learn

- How to think about a system in one page (a small threat model) so you know what you are protecting.
- How to keep secrets out of Git and what to do, in order, when one leaks.
- How `.gitignore` really works, and how scanners and hooks help as layers (never as guarantees).
- What least privilege, MFA, phishing awareness and signed commits mean in practice.
- How to make a CI pipeline harder to abuse: pinning, lock files, small tokens and no static keys.
- How to use AI tools without leaking secrets or customer data.

## A one-page threat model

Before you pick controls, write down what you are protecting and who or what could hurt it. It takes ten minutes and prevents effort in the wrong place. Use four questions: what are we protecting, what can go wrong, what do we do about it, and how would we know?

For a small web service on GKE with a Git repository and a pipeline, a one-page version looks like this:

| Asset                   | What can go wrong                             | Likely path                                              | Control (this lesson)                           |
| ----------------------- | --------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Cloud credentials       | Someone else uses them to read or delete data | Key committed to Git; stolen laptop; phished login       | No keys in Git, short-lived credentials, MFA    |
| Source code and history | A malicious change is merged                  | Stolen account; unreviewed push                          | Branch protection, signed commits, review       |
| The pipeline            | It runs attacker code with deploy rights      | Poisoned dependency; changed pipeline file; stolen token | Pinning, small tokens, protected branches, OIDC |
| Customer data           | It leaks through logs, backups or AI prompts  | Debug logging; pasting data into a tool                  | Log rules, data handling, AI rules              |
| Your own accounts       | An attacker signs in as you                   | Phishing; reused password; MFA prompt spam               | Phishing-resistant MFA, a password manager      |

That table is the lesson in one picture. The senior-level version, with trust boundaries and a method, is [[standards/platform-threat-modelling]].

## Secrets: never in Git, and why Git is forever

A **secret** is anything that proves who you are or unlocks something: passwords, API keys, tokens, private keys, service account key files, database URLs with passwords.

**Never commit a secret.** Git stores every version of every file forever, in every clone. Deleting the file in the next commit removes it from the latest version only. Anyone can still read it with `git log -p` or by checking out an older commit. A public repository is scanned by bots within minutes; a private one is still copied to every developer's laptop, every CI cache and every backup.

Where should secrets live instead?

| Option                                | Good for                                            | Weakness                                                                                             |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Environment variables                 | Simple, works everywhere                            | Visible to every process in the container, to `docker inspect`, to crash dumps and sometimes to logs |
| A secret manager (GCP Secret Manager) | Production. Access is by IAM, versioned and audited | An extra dependency; you must manage who can read each secret                                        |
| Files mounted at run time             | Certificates, bigger secrets                        | Needs a secure source to mount from (a secret manager again)                                         |

The usual approach on GKE is: store the secret in **Secret Manager**, give only the workload's service account permission to read it, and let the application or a sync tool read it at run time ([[patterns/external-secrets-with-secret-manager]]). Environment variables are fine as the _delivery_ method for a secret that came from a manager, not as the _storage_.

Two more habits:

- **Rotate.** Every secret should have a plan for replacing it. If replacing a secret is scary, you have not practised it, and you will not be able to do it quickly during a leak.
- **Scan history, not just the latest commit.** A secret that was removed three months ago is still in the repository. Scanners can walk the whole history (see below).

## `.gitignore`: what it does and what it does not

`.gitignore` tells Git which untracked files to leave alone. It is a convenience, not a security control, but a good one keeps `.env` files and keys out of your commits by accident.

```gitignore title=".gitignore"
# Local environment and keys: never commit.
.env
.env.*
!.env.example
*.pem
*.key
*.tfstate
*.tfstate.*

# Build output only at the repository root.
/build/
```

The rules that surprise people:

- **A leading `/` anchors the pattern** to the folder of the `.gitignore`. `/build/` ignores `./build/` but not `src/build/`. Without the slash, `build/` matches a folder named `build` at any depth.
- **A trailing `/` matches directories only.**
- **`!` re-includes** something an earlier rule ignored (`!.env.example` above). It cannot bring back a file if a **parent directory** is ignored: Git never looks inside an ignored folder.
- **Files that are already tracked stay tracked.** Adding `secrets.json` to `.gitignore` does nothing for a file that was committed before. Stop tracking it with `git rm --cached secrets.json` (and treat its contents as leaked, because it is in history).
- **Rules can come from more than one place.** The repository's `.gitignore`, `.git/info/exclude` (only your clone) and a global file named by `core.excludesFile` all count. When a file is ignored and you do not know why, ask Git:

```bash
git check-ignore -v build/x
```

```text
.gitignore:1:/build/	build/x
```

(That is the output for a `.gitignore` whose first line is `/build/`; the line number is the line of the matching pattern in your file.) The output is `source file : line number : pattern`, a tab, then the path you asked about. Exit code `0` means ignored, `1` means not ignored. Exercise 1 uses it.

## Scanners and hooks: layers, not guarantees

A **secret scanner** looks for text that matches known secret formats (cloud keys, tokens, private key headers) and for high-entropy strings. Use it in three places: on your machine before commit, in CI on every merge request, and on the full history once.

**gitleaks** is a common open-source scanner. In current releases the commands are `gitleaks git` (scan a repository's commits), `gitleaks dir` (scan files in a folder) and `gitleaks stdin` (scan piped text). Older tutorials show `gitleaks detect` and `gitleaks protect`; those were superseded in v8.19 and later, so if you see them, check your version and the current README.

```bash
gitleaks git --redact -v .      # scan the history of the repository in the current folder
gitleaks dir --redact -v .      # scan the files, ignoring history
```

`--redact` hides the secret value in the report, which matters when the report goes into a CI log. By default a scan that finds something exits with a non-zero code, so it fails a pipeline.

**detect-secrets** (from Yelp) is another tool. It keeps a baseline file of known findings so a team can adopt it on an old repository without fixing everything first.

> [!warning] Check before relying on this
> Subcommand names, flags and rule IDs differ between gitleaks versions (the `detect` and `protect` commands were replaced in v8.19). Run `gitleaks --help` and `gitleaks git --help` for your version, and read the project README before you wire it into CI. See also [[patterns/secret-scanning-pre-commit-and-ci]].

Scanners miss things: unknown formats, secrets split across lines, secrets in binary files, passwords with no pattern. They also flag harmless strings. So treat them as a **net**, not a wall. The real protection is not to put secrets in files to begin with.

## A secret leaked: what to do, in order

Say a scanner finds a cloud key in a commit that was pushed. The order matters. The wrong order loses time while the key is live.

1. **Revoke or rotate the secret first.** Assume it is already copied. Make the old value stop working: delete the service account key, rotate the password, revoke the token. Everything else can wait for this.
2. **Create a replacement and deploy it** where it is used, by a safe path (a secret manager), so nothing breaks.
3. **Audit use.** Look at the audit logs for the credential from the time it was exposed: where was it used from, and what did it touch? ([[patterns/gcp-audit-logs-siem]]). That tells you whether this is an incident or a near miss. If anything unusual happened, hand over to your incident process ([[runbooks/incident-response]]).
4. **Then clean the repository**, if your policy says to. Removing the secret from history needs a rewrite with a tool such as `git filter-repo` (for example `git filter-repo --replace-text expressions.txt`) followed by a **force push**, and every clone, fork and cache keeps the old history until it is re-cloned. Do that only as your team's policy allows, never silently on a shared branch, and never instead of rotating. Because the secret is already revoked, history cleanup is about tidiness and reducing noise for scanners, not about safety.
5. **Add the missing control** (a pre-commit hook, a CI scan, a better secret path) and write a short note on what happened.

The full procedure is in [[runbooks/leaked-credential-rotation]]. Practise the steps on a fake key (exercise 2) so the first real one is not your first.

## Least privilege for people and workloads

**Least privilege** means every person and every program gets only the access needed for its job, for as long as needed. It limits what a mistake or a stolen credential can do.

- **Grant at the narrowest scope.** A role on one bucket is better than the same role on a project. A role on a project is better than on the organization.
- **Use the narrowest role.** `roles/storage.objectCreator` can create objects. `roles/storage.admin` can do everything with storage. Prefer predefined narrow roles over `Owner` or `Editor`.
- **Give workloads their own identity.** One service account per workload, no shared accounts, and no downloaded key files; on GKE use Workload Identity ([[patterns/gke-workload-identity]]). See [[learn/gcp-iam-and-service-accounts]] for the basics.
- **Prefer short-lived access** (impersonation, Workload Identity Federation) to long-lived keys.
- **Review.** Access that is never reviewed only grows.

You will grant a bucket-level role and test what it allows and what it blocks in exercise 4.

## MFA: not all second factors are equal

**Multi-factor authentication** (MFA) asks for something more than a password. It stops most stolen-password attacks, but the kind of second factor decides how well it holds up.

| Method                         | How it works                                            | Weakness                                                                                       |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| SMS code                       | A code sent by text message                             | SIM swapping, interception. The weakest. Avoid when you can.                                   |
| TOTP app                       | A 6-digit code that changes every 30 seconds            | A fake site can ask for the code and use it at once (real-time phishing).                      |
| Push approval                  | "Approve this sign-in?" on your phone                   | **MFA fatigue**: an attacker with your password sends prompt after prompt until you tap "Yes". |
| FIDO2 / passkey / security key | A cryptographic proof that is bound to the real website | Needs a device or key; recovery needs planning. **Phishing-resistant.**                        |

The important property of FIDO2 and passkeys is that the browser signs a challenge for the **exact website** you are on. A fake login page at a look-alike domain gets nothing useful, however convincing it looks.

Practical rules:

- Use a **passkey or hardware key** for the accounts that matter most: cloud console, Git hosting, email, password manager, and the identity provider.
- Keep **recovery codes** in your password manager or a safe place, and keep **two** registered methods (for example a passkey and a hardware key), so a lost phone does not lock you out.
- If a push prompt arrives that **you did not start**, never approve it. Deny it, and report it: someone has your password.

> [!warning] Check before relying on this
> Guidance on authenticators changes. NIST's digital identity guidelines are published as SP 800-63-4 (with SP 800-63B for authentication), and CISA publishes a fact sheet on phishing-resistant MFA. **Verify the current revision and wording** on the NIST and CISA sites before you quote them in a policy.

## Phishing for people who run systems

If you can reach production, you are a high-value target, and the messages are written for ops staff: a fake single sign-on page after an "expired session", an urgent "your VPN account will be disabled, reset now" email, a message from "the CTO" asking for a quick favour, a "failed deployment" link to a look-alike CI domain.

How to check, in a few seconds:

- **Did I start this?** Unexpected prompt, unexpected reset, unexpected link: stop.
- **Look at the address, not the text.** The real domain is the part just before the first single `/`. `login.example.com.verify-session.example.net` belongs to `example.net`.
- **Do not use the link.** Open the service from your own bookmark or type the address.
- **Verify by a second channel**: call or message the person on a number or chat you already know. "Urgent" is a tactic, not a reason.
- **Let the password manager check the domain.** If it does not offer to fill in a login, the site may not be the real one.
- **Report it**, even if you did not click. Others got the same message.

## Commit and tag signing with SSH

Git trusts what you tell it: `git config user.name` can be set to anything, so a commit that says it is from your colleague may not be. A **signature** proves a commit or tag was made by the holder of a private key.

Git can sign with an SSH key (Git 2.34 or newer, and a recent OpenSSH; verify for your versions), so you do not need a separate GPG setup:

```bash
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git config gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
git config commit.gpgsign true
```

Signing needs a key pair. Verifying needs a list of keys you trust, the **allowed signers file**: one line per person with an email (the principal) and their public key:

```text title="~/.config/git/allowed_signers"
you@example.com ssh-ed25519 AAAA... (your public key)
```

Then `git commit -S` signs (or every commit, with `commit.gpgsign true`), `git tag -s v1.2.0` signs a tag, and `git log --show-signature` shows the result. On GitHub and GitLab you upload the same public key as a **signing key** (separate from the login key), and the host shows a **Verified** badge next to signed commits.

Signing proves _who_, not _that the change is good_. It matters most together with branch protection: the host can require signed commits on protected branches. Be clear about its limit: if an attacker steals your private key, they can sign as you, so protect keys with a passphrase or a hardware key.

## Git hooks: useful, but not policy

A **hook** is a script Git runs at a point in its workflow, for example `pre-commit` before a commit is created. By default hooks live in `.git/hooks/`, which is not part of the repository, so they are not shared. To share hooks with a team, keep them in a folder in the repository and point Git there:

```bash
git config core.hooksPath .githooks
```

The `pre-commit` framework (a tool and a `.pre-commit-config.yaml` file) does the same in a more managed way, with hooks fetched from other repositories at pinned versions.

Two facts decide how you use them:

- **Hooks do not enforce anything.** They run on each person's machine, only if installed, and `git commit --no-verify` skips them. Use them for fast feedback (a scanner, a formatter). Enforce rules where the user cannot skip them: in CI and in the Git host.
- **Hooks are code.** When you clone a repository and run its setup (`make setup`, `pre-commit install`, `npm install`), you let that repository's scripts run on your machine. Treat tooling from a repository you did not write as untrusted code: read it first, run it in a throwaway container or VM, and never in a place where your cloud credentials or SSH keys are within reach.

## Server-side protection

What the Git host enforces is what you can rely on:

- **Branch protection** (GitHub) or **protected branches** (GitLab): no direct push to the main branch, merge request required, approvals required, status checks must pass, no force-push, no deletion.
- **Push rules / secret push protection** that reject commits containing known secret formats before they reach the server (availability and name depend on the product and plan; check yours).
- **Required signed commits** on protected branches, if you use signing.
- **Limited admin and bypass rights**, and the same rules for everyone, including admins.

## The CI supply chain

Your pipeline holds powerful credentials and runs code from many sources: your repository, base images, third-party actions or templates, and every dependency. An attacker who can change any of them can run code with your deploy rights. The OWASP Top 10 CI/CD Security Risks lists the common weaknesses (for example insufficient flow control, inadequate identity and access management, dependency chain abuse, poisoned pipeline execution and insufficient credential hygiene; check the current list for the exact wording).

Controls that pay off quickly:

- **Pin by digest or commit SHA, not by moving tag.** A tag such as `:latest`, `:3` or `@v4` can be repointed. A digest cannot.

  ```yaml
  image: alpine@sha256:<digest> # Change: the digest of the exact image you tested (docker pull prints it).
  ```

  ```yaml
  # In a GitHub Actions workflow: a full commit SHA, with the version in a comment.
  - uses: actions/checkout@<full-commit-sha> # Change: the commit of the release you reviewed.
  ```

  Pinning means you must update on purpose, so use an update bot ([[patterns/automated-dependency-updates]]).

- **Lock files**: commit `package-lock.json`, `poetry.lock`, `.terraform.lock.hcl`, and install from them (`npm ci`), so builds use the versions you reviewed.
- **Dependency and image scanning** in the pipeline, with a rule for what blocks a release ([[patterns/sonarqube-quality-gates]] covers code quality gates; [[standards/vulnerability-management-slas]] covers response times).
- **Least-privileged CI tokens.** The default job token should read only what it must. Give deploy rights only to jobs on protected branches, and use separate identities per environment.
- **No static cloud keys in CI variables.** Use **OIDC / Workload Identity Federation**: the CI platform proves its identity to Google Cloud, and gets a short-lived token for one service account. There is nothing to leak or rotate ([[architecture/iam-groups-and-ci-workload-identity-federation]]).
- **Protect the pipeline definition.** Changes to `.gitlab-ci.yml` or workflow files need the same review as code, and untrusted merge requests (forks) must not get secrets.
- **Know what you ship.** SBOMs and build provenance are covered in [[compliance/sbom-generation-and-storage]] and [[compliance/slsa-build-provenance]].

## Using AI tools without leaking

An AI assistant is a third party. What you paste into it leaves your control.

- **Never paste** secrets, tokens, private keys, customer data, personal data, or internal hostnames and configuration into an AI tool that your organisation has not approved for that data.
- **Redact first**: replace real values with placeholders (`example.com`, `192.0.2.10`, `REDACTED`) before you ask for help with a config or a log.
- **Treat generated code and commands as untrusted** until you have read and understood them, especially anything that runs `curl | sh`, changes IAM, or disables a check.
- **Do not give an agent more access than you would give a new intern**: read-only by default, no production credentials ([[ai/securing-ai-agents-in-ci-and-cloud]]).

The owner's catalogue of AI skills is at <https://ai.szolotov.com>. Apply the rules above to anything you use from any catalogue, this one included.

## Hands-on exercises

> [!warning] Costs money
> Exercises 3 and 4 create a secret and a small bucket in your GCP lab project. They cost very little but are billed resources, and prices change (check the current Secret Manager and Cloud Storage pricing pages). The cleanup commands are at the end of each exercise. Check with `gcloud secrets list` and `gcloud storage buckets list`.

Prepare a throwaway Git repository:

```bash
rm -rf ~/sec-lab && mkdir -p ~/sec-lab && cd ~/sec-lab
git init -b main
git config user.name  "Lab User"            # Change: your name.
git config user.email "you@example.com"     # Change: your email.
```

### Exercise 1: See why a file is ignored

1. Create an anchored rule and two folders:

   ```bash
   printf '/build/\n' > .gitignore
   mkdir -p build src/build
   touch build/x src/build/y
   ```

2. Ask Git about each file:

   ```bash
   git check-ignore -v build/x ; echo "exit: $?"
   git check-ignore -v src/build/y ; echo "exit: $?"
   ```

   Expected (illustrative):

   ```text
   .gitignore:1:/build/	build/x
   exit: 0
   exit: 1
   ```

   The first file is ignored by line 1 of `.gitignore`. The second prints nothing and exits `1`: the leading `/` anchored the rule to the top folder, so `src/build/` is not ignored.

3. Remove the leading slash (`printf 'build/\n' > .gitignore`) and run the second command again. Expected: `.gitignore:1:build/	src/build/y` and `exit: 0`.

If you see something else: if the first command prints nothing, you are not in the repository folder or the `.gitignore` file is missing. If a file you expected to be ignored shows up in `git status`, it is already tracked: `git ls-files build/x` will list it.

### Exercise 2: Find a fake key with gitleaks, then walk the rotation

1. Install gitleaks from its releases or your package manager, and note the version: `gitleaks version`.

2. Commit a fake AWS-style key. The key is built at run time from two pieces, so no key-shaped text sits in this page:

   ```bash
   printf 'AWS_ACCESS_KEY_ID=%s%s\n' AKIA Z5K2Q7XW3NRT4PLM > deploy.env
   git add deploy.env
   git commit -m "Add deploy config"
   ```

3. Scan the history:

   ```bash
   gitleaks git --redact -v .
   ```

   Expected (illustrative; fields and the rule ID depend on your version):

   ```text
   Finding:     AWS_ACCESS_KEY_ID=REDACTED
   Secret:      REDACTED
   RuleID:      aws-access-token
   Entropy:     3.6
   File:        deploy.env
   Line:        1
   Commit:      3f2a9c1...
   ...
   leaks found: 1
   ```

   Check the exit code with `echo $?`. Expected: `1`.

4. Now **delete the file and commit the deletion**, then scan again:

   ```bash
   git rm -q deploy.env && git commit -qm "Remove deploy config"
   gitleaks git --redact -v .
   ```

   Expected: it still reports `leaks found: 1`, in the older commit. That is why deleting the file is not enough.

5. Write out the rotation steps for this key, as you would in a real incident (a text file is fine):
   1. Revoke the key (for a Google Cloud service account key: `gcloud iam service-accounts keys list --iam-account=SA_EMAIL`, then `gcloud iam service-accounts keys delete KEY_ID --iam-account=SA_EMAIL`).
   2. Create and deploy a replacement through a secret manager.
   3. Read the audit logs for use of the key since the commit time.
   4. Decide with your team whether to rewrite history; if yes, `git filter-repo`, force push, and ask everyone to re-clone.
   5. Add a pre-commit scan and a CI scan.

If you see something else: if gitleaks finds nothing, check `gitleaks version` and run `gitleaks git --help`; an older version may need `gitleaks detect --source .` instead. If the rule did not fire on this fake value, a newer ruleset may filter it; write a different well-formed fake and note the ruleset change. A `command not found` means gitleaks is not on your `PATH`.

### Exercise 3: Replace a hard-coded key with a Secret Manager read

1. Start with the bad version in `app.py`:

   ```python title="app.py"
   """Print which payments key the app would use (never print the key itself)."""
   API_KEY = "EXAMPLE_NOT_A_REAL_KEY"   # BAD: a secret in source code

   print(f"using a key of {len(API_KEY)} characters")
   ```

   Commit it so you have a diff to compare. Run `python3 app.py`. Expected: `using a key of 22 characters`.

2. Create the secret in your lab project. The value is a placeholder:

   ```bash
   PROJECT_ID="lab-yourname-123456"   # Change: your lab project ID.
   gcloud services enable secretmanager.googleapis.com --project "$PROJECT_ID"
   printf '%s' 'EXAMPLE_NOT_A_REAL_KEY' | gcloud secrets create payments-api-key \
     --project "$PROJECT_ID" --replication-policy=automatic --data-file=-
   ```

   Expected (illustrative): `Created secret [payments-api-key].`

3. Replace the hard-coded value with a read. Install the client in a virtual environment first (`python3 -m venv .venv && . .venv/bin/activate && pip install google-cloud-secret-manager`), and sign in for Application Default Credentials (`gcloud auth application-default login`):

   ```python title="app.py"
   """Print which payments key the app would use (never print the key itself)."""
   import os

   from google.cloud import secretmanager

   PROJECT_ID = os.environ["GOOGLE_CLOUD_PROJECT"]
   SECRET_NAME = os.environ.get("PAYMENTS_SECRET", "payments-api-key")


   def read_secret(project_id: str, name: str) -> str:
       client = secretmanager.SecretManagerServiceClient()
       path = f"projects/{project_id}/secrets/{name}/versions/latest"
       response = client.access_secret_version(request={"name": path})
       return response.payload.data.decode("utf-8")


   API_KEY = read_secret(PROJECT_ID, SECRET_NAME)
   print(f"using a key of {len(API_KEY)} characters")
   ```

4. Run it and look at the diff:

   ```bash
   GOOGLE_CLOUD_PROJECT="$PROJECT_ID" python3 app.py
   git diff --stat
   ```

   Expected: `using a key of 22 characters` again, and a diff in which the line with the literal value is gone and no secret text is added.

5. Clean up: `gcloud secrets delete payments-api-key --project "$PROJECT_ID"`.

If you see something else: `PermissionDenied` means your identity cannot read the secret: in production only the workload's service account gets `roles/secretmanager.secretAccessor` on that one secret. `KeyError: 'GOOGLE_CLOUD_PROJECT'` means the variable was not set. `ModuleNotFoundError` means the virtual environment is not active. Note that `latest` follows rotation automatically but can also pick up a bad new version; production setups often pin a version and roll forward on purpose (verify for your needs).

### Exercise 4: A least-privilege grant on one bucket

1. Create a service account and a bucket, and let yourself impersonate the account for the test:

   ```bash
   PROJECT_ID="lab-yourname-123456"          # Change: your lab project ID.
   BUCKET="${PROJECT_ID}-uploads"
   SA="lab-uploader"
   SA_EMAIL="${SA}@${PROJECT_ID}.iam.gserviceaccount.com"
   ME="you@example.com"                      # Change: your Google account.

   gcloud iam service-accounts create "$SA" --project "$PROJECT_ID" --display-name "Lab uploader"
   gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT_ID" \
     --location europe-west4 --uniform-bucket-level-access --public-access-prevention
   gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
     --member="user:${ME}" --role="roles/iam.serviceAccountTokenCreator"
   ```

2. Grant **one** narrow role on **one** bucket:

   ```bash
   gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
     --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectCreator"
   ```

   Role bindings can take a minute to take effect.

3. Test what the account can and cannot do:

   ```bash
   echo hello > hello.txt
   gcloud storage cp hello.txt "gs://${BUCKET}/hello.txt" --impersonate-service-account="$SA_EMAIL"
   gcloud storage ls "gs://${BUCKET}" --impersonate-service-account="$SA_EMAIL"
   ```

   Expected (illustrative): the copy succeeds (`Completed files 1/1`), and the listing fails:

   ```text
   ERROR: (gcloud.storage.ls) HTTPError 403: lab-uploader@lab-yourname-123456.iam.gserviceaccount.com
   does not have storage.objects.list access to the Google Cloud Storage bucket.
   Permission 'storage.objects.list' denied on resource (or it may not exist).
   ```

   The account can **write** new objects and cannot **list or read** them. That is least privilege: it can do its one job and nothing else.

4. Clean up:

   ```bash
   gcloud storage rm --recursive "gs://${BUCKET}"
   gcloud iam service-accounts delete "$SA_EMAIL" --project "$PROJECT_ID"
   ```

If you see something else: if the copy also fails with a permission error, wait a minute and retry. If your `gcloud` version reads the destination object first, it may need a permission that `objectCreator` does not have (read the error; do not fix it by granting `Owner`). If the listing succeeds, the account has a broader role from somewhere else (check the project IAM). A `TokenCreator` error means the impersonation binding in step 1 did not apply.

### Exercise 5: Sign a commit with an SSH key

1. Create a signing key (a passphrase is recommended), and the allowed signers file:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_signing -C "you@example.com"   # Change the email.
   mkdir -p ~/.config/git
   printf 'you@example.com %s\n' "$(cut -d' ' -f1,2 ~/.ssh/id_ed25519_signing.pub)" > ~/.config/git/allowed_signers
   ```

2. Configure Git in the lab repository (no `--global`, so your other repositories are unchanged):

   ```bash
   git config gpg.format ssh
   git config user.signingkey ~/.ssh/id_ed25519_signing.pub
   git config gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
   ```

3. Make a signed commit and look at it:

   ```bash
   echo "signed" > signed.txt
   git add signed.txt
   git commit -S -m "Add a signed file"
   git log --show-signature -1
   ```

   Expected (illustrative):

   ```text
   commit 9d1c4e2...
   Good "git" signature for you@example.com with ED25519 key SHA256:Abc...
   Author: Lab User <you@example.com>
   ...
       Add a signed file
   ```

4. Look at an unsigned commit with `git log --show-signature` for the earlier ones. Expected: no `Good "git" signature` line for them.

If you see something else: `error: gpg.ssh.allowedSignersFile needs to be configured` means step 2 or the file path is wrong. `No principal matched` means the email in `allowed_signers` differs from the commit's email. `unsupported` or `unknown option` errors point to an old Git (before 2.34) or OpenSSH: update them. On GitHub or GitLab, add the public key as a **signing key** to see the Verified badge.

### Exercise 6: A hook that blocks `DEBUG=true`

1. Create a shared hooks folder and a `pre-commit` hook:

   ```bash
   mkdir -p .githooks
   cat > .githooks/pre-commit <<'EOF'
   #!/usr/bin/env bash
   set -euo pipefail
   if git diff --cached -U0 | grep -E '^\+.*DEBUG=true' >/dev/null; then
     echo "pre-commit: DEBUG=true found in the staged changes. Remove it or keep it in a local .env." >&2
     exit 1
   fi
   EOF
   chmod +x .githooks/pre-commit
   git config core.hooksPath .githooks
   ```

2. Try to commit the bad line:

   ```bash
   echo 'DEBUG=true' > app.env
   git add app.env
   git commit -m "Add app env"
   echo "exit: $?"
   ```

   Expected (illustrative):

   ```text
   pre-commit: DEBUG=true found in the staged changes. Remove it or keep it in a local .env.
   exit: 1
   ```

   Run `git log --oneline -1` and confirm no new commit was made.

3. Now skip it on purpose: `git commit --no-verify -m "Add app env"`. Expected: the commit succeeds. That is why a hook is feedback, not policy; a CI check on the same rule is the real gate.

If you see something else: if the commit went through at step 2, the hook is not executable (`chmod +x`), `core.hooksPath` is not set in this repository, or the folder name differs. If you get `env: bash\r: No such file`, the file has Windows line endings.

### Exercise 7: Turn on a passkey

1. In the settings of your Git host account (and, as time allows, your Google account), find the security section and add a **passkey** or **security key** as a sign-in method. The menu names change, so look for "Passkeys", "Security keys" or "Two-factor authentication".
2. Download or print the **recovery codes** and store them in your password manager.
3. Add a **second** method (another key or an authenticator app).
4. Sign out, then sign in again.

Expected: the sign-in asks for the passkey or key (a touch, a fingerprint or a PIN), and no code is typed.

If you see something else: if you are only asked for an SMS or app code, the passkey was not registered or the site offers it as an extra, not a replacement. Check which methods are registered and remove the SMS fallback if your policy allows.

## Common mistakes

- **Deleting the file and calling it fixed.** Why it bites: the secret is still in the history, in every clone. Fix: revoke and rotate first; clean history only by policy.
- **Rewriting history before rotating.** Why it bites: copies exist elsewhere, and the key is still live. Fix: rotate in the first minutes; rewrite later.
- **A silent force-push to remove a secret from a shared branch.** Why it bites: it breaks everyone's clones and hides what happened. Fix: agree on it with the team, announce it, and record it.
- **Trusting the scanner.** Why it bites: it misses unusual formats and passwords. Fix: keep secrets out of files; use scanners as a net.
- **Believing `.gitignore` protects a tracked file.** Why it bites: tracked files stay tracked. Fix: `git rm --cached`, then rotate.
- **Broad roles "to make it work".** Why it bites: one bug or stolen token can do anything. Fix: find the missing permission and grant just that, on the narrowest resource.
- **Downloaded service account keys in CI variables.** Why it bites: they never expire and are easy to copy. Fix: Workload Identity Federation.
- **Approving a push prompt you did not start.** Why it bites: it lets the attacker in. Fix: deny, report, and change the password.
- **Pinning to `:latest` or a version tag.** Why it bites: the content behind it can change under you. Fix: pin by digest or commit SHA and update with a bot.
- **Treating hooks as enforcement.** Why it bites: `--no-verify` and missing installs skip them. Fix: enforce in CI and on the Git host.
- **Running a cloned repository's setup script on a machine with your credentials.** Why it bites: it is arbitrary code. Fix: read it first, use a throwaway environment.
- **Pasting a log with tokens into an AI tool.** Why it bites: the data leaves your control. Fix: redact first; use approved tools.

## Check your understanding

1. Why is deleting a committed secret file not enough, and what do you do first?
2. Why is phishing-resistant MFA (passkeys, FIDO2) better than a TOTP code or a push prompt?
3. Why pin images by digest and actions by commit SHA instead of by tag?
4. Why can a Git hook not be used to enforce a policy, and where should the policy be enforced?
5. A service account must upload files to one bucket and nothing else. Which grant do you make?
6. Your scanner finds nothing. Does that mean the repository has no secrets?

> [!question]- Answers
>
> 1. Git keeps every version in history and in every clone, so the secret can still be read from older commits. First revoke or rotate the secret so it stops working, then audit its use, and only then (if policy says so) clean the history.
> 2. A passkey or FIDO2 key signs a challenge for the exact website, so a fake site at another domain gets nothing usable. A TOTP code can be typed into a fake site and replayed at once, and a push prompt can be approved by mistake or under repeated prompts (MFA fatigue).
> 3. Tags can be moved to different content, so the same reference can give different code tomorrow, for example after a compromise of the upstream project. A digest or commit SHA identifies one exact content, so changes happen only when you update the pin on purpose.
> 4. Hooks run on each person's machine, only if installed, and can be skipped with `--no-verify`. Enforce policy where the user cannot skip it: in CI, with protected branches and required checks on the Git host.
> 5. Grant a narrow role such as `roles/storage.objectCreator` on that one bucket (not on the project) to a dedicated service account. It can create objects, and listing or reading is denied.
> 6. No. Scanners find known formats and high-entropy strings; they miss unknown formats, split or encoded values, and plain passwords. Use them as a net, and design so that secrets are never in files.

## Next steps

Next lesson: [[learn/observability-signals-and-dashboards|Observability 01: Metrics, logs and traces, and reading a Grafana dashboard]]. Previous lesson: [[learn/terraform-state-modules-and-pipelines|Delivery 05: Terraform state, remote backends, modules and pipelines]].

To go deeper:

- [[runbooks/leaked-credential-rotation]] is the full procedure for the leak case.
- [[patterns/external-secrets-with-secret-manager]] shows how workloads on GKE read secrets safely.
- [[patterns/secret-scanning-pre-commit-and-ci]] wires scanners into hooks and pipelines.
- [[patterns/automated-dependency-updates]] keeps pinned versions fresh.
- [[patterns/sonarqube-quality-gates]] adds code-quality and security gates to merge requests.
- [[standards/platform-threat-modelling]] turns the one-page model into a method.
- [[compliance/index|The compliance section]] covers audit-oriented controls, such as [[compliance/access-reviews-gcp-and-gke]] and [[compliance/slsa-build-provenance]].
- AI skills catalogue (owner's): <https://ai.szolotov.com>. See also [[ai/securing-ai-agents-in-ci-and-cloud]].
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

Nothing in this lesson was run (see the note near the top). The commands and examples follow the sources below; pages change, so check them for the versions you use.

- OWASP Cheat Sheet Series: Secrets Management, Authentication, and CI/CD Security (https://cheatsheetseries.owasp.org/). Version not verified.
- OWASP Top 10 CI/CD Security Risks (https://owasp.org/www-project-top-10-ci-cd-security-risks/). Not verified: the current list and wording.
- NIST SP 800-63-4, Digital Identity Guidelines, and SP 800-63B (https://pages.nist.gov/800-63-4/). Not verified: the current revision and section numbers; check before you cite.
- CISA, "Implementing Phishing-Resistant MFA" fact sheet (https://www.cisa.gov/). Not verified: the current title and link.
- git-scm.com documentation: `gitignore`, `githooks`, `git-config` (including `gpg.format`, `gpg.ssh.allowedSignersFile`, `core.hooksPath`) (https://git-scm.com/docs). Not verified: the Git version in which SSH signing appeared (believed to be 2.34).
- GitHub documentation, "Managing commit signature verification", and GitLab documentation on signed commits with SSH keys (https://docs.github.com/, https://docs.gitlab.com/). Not verified for your plan and version.
- gitleaks README and releases (https://github.com/gitleaks/gitleaks). Not verified: the exact version in which `detect` and `protect` were superseded by `git`, `dir` and `stdin` (v8.19 is the version given in the course notes), and the rule IDs.
- git-filter-repo (https://github.com/newren/git-filter-repo).
- Google Cloud documentation: Secret Manager, IAM roles for Cloud Storage (`roles/storage.objectCreator`), service account impersonation, Workload Identity Federation (https://cloud.google.com/secret-manager/docs, https://cloud.google.com/iam/docs). Not verified: permission lists for the roles in your environment.
