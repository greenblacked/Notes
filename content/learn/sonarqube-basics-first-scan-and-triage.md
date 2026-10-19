---
title: "Delivery 09: SonarQube basics: a first scan, the dashboard and triaging issues and hotspots"
description: Run SonarQube in a lab, scan a project, read the dashboard, and triage issues and security hotspots with a reason someone can audit.
type: guide
tags:
  - learning
  - sonarqube
  - ci-cd
  - security
created: 2026-10-19
modified: 2026-10-19
draft: false
---

> [!info] Level: junior-middle | Time: about 3 h | You need: [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02: Your first pipeline in GitLab CI and Jenkins]] | Lab: Docker on the lab VM from [[learn/lab-setup|Start 01: Set up your lab]]

A quality gate in CI is only as good as the people who understand what it says. "The SonarQube check failed" is useless if nobody knows how to read the dashboard, what a security hotspot is, or what it means to mark a finding as accepted. This lesson runs SonarQube locally, scans a small project, teaches you to read the result, and, most importantly, how to **triage** findings so that every decision has a written reason someone can audit later. Wiring the gate into a pipeline and tuning it for a team is the job of [[patterns/sonarqube-quality-gates]].

> [!note] Nothing here was run for this page
> The commands, settings and sample output follow the SonarQube documentation and are not verified. Output and screens are illustrative. SonarQube's editions, image tags, UI wording and issue taxonomy change between releases, so everything marked "check the current docs" must be checked against the version you run.

## What you will learn

- What SonarQube analyses, and the difference between overall code and new code.
- How to run the server and the scanner in containers, with the host setting the server needs.
- How to create a project and a token, and pass the token without putting it in the command line.
- How to read the dashboard: ratings, the default quality gate and the new-code definition.
- How to triage issues and security hotspots, and how to record a decision someone can audit.

## What SonarQube analyses

SonarQube is a code-quality and code-security platform. A **scanner** reads your source (and, optionally, test and coverage reports) and sends the results to the **server**, which stores them, applies a quality gate and shows them in a dashboard. What it reports:

- **Issues.** Problems found by rules in the code: bugs, vulnerabilities and code smells (the older vocabulary) or, in newer versions, issues classified by software quality and impact (maintainability, reliability, security). Check the current docs for the taxonomy of your version.
- **Security hotspots.** Code that is security-sensitive but not necessarily wrong: using a regular expression on user input, setting a cookie without a flag, calling a command. A hotspot needs a **human to review it**; the tool cannot know if the use is safe.
- **Coverage.** The share of lines or conditions that your tests exercise. SonarQube does not run your tests: it reads a coverage report that your test tool produced.
- **Duplication.** The share of duplicated blocks of code.
- **Complexity** and size metrics.

### Overall code and new code

The most useful idea in the product is **new code**. The overall code of a ten-year-old project has thousands of old findings, and a gate that fails on all of them blocks every change. A gate that looks at **new code only** says: whatever you change or add must meet the bar, and the old debt is managed separately. This is sometimes called the "clean as you code" approach. What counts as new code is a setting per project: for example "since the previous version", "the last N days", "since a reference branch", or a specific date. Check the current docs for the options in your version, and choose a definition that matches how your team releases.

## Running the server

The official Docker image runs a single container with an embedded database, which is fine for a lab and **not** for anything you care about: the embedded database is for evaluation only. A real installation uses an external PostgreSQL database, and the documentation lists the supported versions (check the current docs).

SonarQube uses an embedded search engine (Elasticsearch) that requires a Linux kernel setting on the host. If it is too low, the server fails to start:

```bash title="host settings for the embedded search engine (Linux VM)"
sysctl vm.max_map_count
sudo sysctl -w vm.max_map_count=524288      # Change: use the value the current docs give for your version
```

`sysctl -w` lasts until reboot. To keep it, add the line `vm.max_map_count=524288` to a file under `/etc/sysctl.d/`. The documentation also asks for a minimum for open file limits. Both numbers have changed between versions, so read the install requirements for yours (check the current docs) and do not copy the value from this page without checking.

```bash title="start the lab server"
docker network create sonar-lab 2>/dev/null || true
docker volume create sonar_data
docker volume create sonar_extensions
docker volume create sonar_logs

docker run -d --name sonarqube --network sonar-lab \
  -p 127.0.0.1:9000:9000 \
  -v sonar_data:/opt/sonarqube/data \
  -v sonar_extensions:/opt/sonarqube/extensions \
  -v sonar_logs:/opt/sonarqube/logs \
  sonarqube:<tag>        # Change: a tag you checked on Docker Hub for the edition you want
```

- **Image tag naming.** The official `sonarqube` image has tags for the edition (community, developer, enterprise) and for the release line (for example long-term-support and latest releases). The naming scheme has changed over time. Check the image page on Docker Hub for the current tags and pick a specific version, not `latest`.
- **Editions and features.** Which languages, branch analysis, pull request decoration and security rules you get depends on the edition (Community Build, Developer, Enterprise, Data Center) and the licence terms. Check the current docs before you plan around a feature, and read the licence before you use it at work.
- Bind to `127.0.0.1` as shown. The server holds your source-code findings, and a lab instance with the default password is not something to expose.

Wait for the log line saying SonarQube is operational (`docker logs -f sonarqube`), then open `http://127.0.0.1:9000`. The initial administrator login and the forced password change are described in the install documentation for your version; change the default password immediately.

## A project and a token

In the UI, create a local project (name `lab-app`, project key `lab-app`) and choose to analyse it locally. SonarQube offers to generate a **token**. Tokens authenticate the scanner without a password.

- Token **types** differ: a _user token_ acts as that user, a _project analysis token_ is limited to analysing one project, and a _global analysis token_ can analyse any project. The names and availability vary by version (check the current docs). Prefer the narrowest one that works, which for CI is a project analysis token, and give it an expiry.
- Treat it as a secret. Save it to a file with mode 600 for the lab.

Pass the token to the scanner through the **environment**:

```bash
export SONAR_TOKEN="$(cat ~/.lab-sonar-token)"
```

The scanner reads `SONAR_TOKEN` automatically. Do **not** use `-Dsonar.token=...` (or the older `-Dsonar.login=...`) on the command line: command-line arguments are visible to every user on the machine in `ps` and in `/proc/<pid>/cmdline`, and they are recorded in shell history and often in CI logs. The same rule applies to any secret you pass to a tool.

## The scanner

The scanner is a separate program. In a lab, run the official container, join it to the same Docker network and mount the source:

```ini title="sonar-project.properties"
sonar.projectKey=lab-app
sonar.projectName=lab-app
sonar.sources=src
sonar.exclusions=**/node_modules/**,**/vendor/**,**/*.min.js
sonar.sourceEncoding=UTF-8
```

```bash title="run the scanner against the lab server"
export SONAR_HOST_URL="http://sonarqube:9000"     # the server as seen from the scanner container

docker run --rm --network sonar-lab \
  -e SONAR_HOST_URL \
  -e SONAR_TOKEN \
  -v "$PWD:/usr/src" \
  sonarsource/sonar-scanner-cli:<tag>             # Change: a tag you checked on Docker Hub
```

- **`sonar.projectKey`** identifies the project on the server. It must match the project you created.
- **`sonar.sources`** is the directory (or list) to analyse. **`sonar.exclusions`** lists patterns to skip: dependencies, generated code, minified files. Excluding vendor code removes noise, but excluding your own code to make the gate pass defeats the purpose.
- **`-e SONAR_TOKEN`** with no value passes the variable from your shell **by name**, so the secret is not written in the command line.
- **Networking.** Both containers are on the `sonar-lab` network, so the scanner reaches the server by its container name. If you run the scanner on the host instead, use `http://127.0.0.1:9000`. A scanner that cannot reach the server fails with a connection error, not an analysis error.
- Build tools like Maven, Gradle and .NET have their own scanner integrations; for a first scan the CLI scanner is enough.

When the scan completes, the log prints a link to the project dashboard. Analysis is finished on the server a moment later (the server processes the report in the background).

## Reading the dashboard

The overview tab shows, for new code and for overall code:

- **Quality gate status.** Passed or Failed, with the conditions that decide it. The default gate (called "Sonar way" in current versions; check the current docs) looks at **new code**: for example no new issues of a certain severity, enough coverage on new code, limited duplication, and every new security hotspot reviewed. The exact conditions are version-dependent and you can define your own gate.
- **Ratings.** Letters A to E for reliability, security and maintainability. They are computed from issues and from the size of the code, and the thresholds are documented.
- **Coverage.** Zero or "not computed" until you give the scanner a report from your test tool (for Python a Cobertura/XML report, for Java JaCoCo, and so on, with the property that the language plugin expects). SonarQube does not run tests, so a missing report is not a failure of your tests.
- **Duplications** and **security hotspots** (with the share reviewed).

The **new code** period is on the project's settings page. If the first analysis shows every old issue as "new", the definition is probably "since a date" or "since previous version" with no previous version, and the baseline needs setting. Look at it before you judge the gate.

## Triage

Triage is deciding, for each finding, what happens to it, and recording why. The goal is that a gate stays green because the code is good or because a person made a _documented_ decision, not because findings were silenced.

### Issues

An issue has a type or quality (bug, vulnerability, code smell; or reliability, security, maintainability), a severity or impact, a rule, a location and an effort estimate. Open the issue and read the rule description: it explains the risk and shows compliant and noncompliant examples. Then choose:

1. **Fix it.** This is the default. Commit a fix and the next analysis closes the issue.
2. **False positive.** The tool is wrong: the rule does not apply to this code. Mark it with a comment that says _why_ in a sentence a stranger can check ("the value is a constant defined at line 12, never user input").
3. **Accepted** (previously called "won't fix" in some versions). The finding is true but you choose to live with it, for a reason and for now: a risk accepted with an owner. The name of the status and what is available depend on the version (check the current docs).

Every false-positive or accepted decision gets a comment with the reason, and for risk acceptances, an owner and a revisit date. A "false positive" with no comment is an unauditable suppression. Exceptions to the gate itself follow [[compliance/policy-exception-and-waiver-process]]; the review habits in [[standards/code-review]] apply to the fix. A tool-wide rule is tuned in the quality profile, not by marking each finding.

### Security hotspots

A hotspot is not a bug. It is a place where a **person must decide** if the code is safe. Statuses in current versions are _To review_ and _Reviewed_, and a reviewed hotspot is marked _Safe_, _Acknowledged_ or _Fixed_ (the names have changed between versions, so check the current docs). The review has a defined process:

1. Open the hotspot and read the "What is the risk?" and "Assess the risk" sections.
2. Decide: is the sensitive operation reachable with untrusted input, and is the protection present?
3. If yes, fix it and mark it _Fixed_ (or let the next analysis do so). If it is safe, mark it _Safe_ **with a comment** that names the reason. If it is a real risk you will accept for now, mark it _Acknowledged_ with an owner.

The default gate requires new hotspots to be reviewed, so a pipeline can fail on an unreviewed hotspot. That is by design: someone must look.

### Mapping to CWE and OWASP

Rules reference the standard classifications: **CWE** (Common Weakness Enumeration, for example CWE-89 for SQL injection) and the **OWASP Top 10** categories. In the rule description, and as filters in the Issues and Security Hotspots views, you can group findings by them. That is useful for reports ("how many injection findings are open") and for mapping to your vulnerability standard. Do not treat a tool's category as proof of compliance with any framework. Sources: [CWE](https://cwe.mitre.org/) and the [OWASP Top Ten](https://owasp.org/www-project-top-ten/).

### Deadlines

How fast a security finding must be fixed is a policy question, not a SonarQube setting. This lesson gives no numbers: your deadlines come from [[standards/vulnerability-management-slas]].

SonarQube analyses source code; it does not find secrets reliably and is not a dependency scanner. For credentials in code use [[patterns/secret-scanning-pre-commit-and-ci]], which catches them before a commit.

## Hands-on exercises

You need Docker on the lab VM. All screens and output are illustrative; this lesson was not run.

1. **Set the host and start the server.**

   ```bash
   sysctl vm.max_map_count
   sudo sysctl -w vm.max_map_count=524288
   ```

   Then run the `docker run` command from the server section and follow `docker logs -f sonarqube`.
   Expected: a log line that SonarQube is operational, and the login page at `http://127.0.0.1:9000`.
   If you see something else: if the container exits with a bootstrap check failure about `vm.max_map_count` or file descriptors, the kernel setting is too low; read the requirement in the docs for your version. If it exits with memory errors, give the VM more RAM.

2. **Change the password and create a project.** Log in with the initial credentials from the docs, change the password, and create the project `lab-app` with key `lab-app`.
   Expected: an empty project and an offer to set up an analysis.
   If you see something else: if the UI asks for an external DevOps platform binding, choose the local/manual option.

3. **Create a token and store it.** Generate a project analysis token (or the narrowest type your version offers) and save it:

   ```bash
   ( umask 077; read -rs -p 'Token: ' t && printf '%s' "$t" > ~/.lab-sonar-token )
   ```

   Expected: a file readable only by you.
   If you see something else: never paste the real token into a shared terminal history or a note; if you did, revoke it in the UI and create another.

4. **Create a small project to scan.**

   ```bash
   mkdir -p ~/sonar-lab/src && cd ~/sonar-lab
   cat > src/app.py <<'EOF'
   import hashlib


   def checksum(data: bytes) -> str:
       return hashlib.md5(data).hexdigest()


   def greet(name):
       return "hello " + name
   EOF
   cat > sonar-project.properties <<'EOF'
   sonar.projectKey=lab-app
   sonar.sources=src
   sonar.sourceEncoding=UTF-8
   EOF
   ```

   Expected: two files. Note that `hashlib.md5` is deliberately weak, as a thing a security rule may flag.
   If you see something else: nothing to see yet; the scan comes next.

5. **Run the first scan.**

   ```bash
   export SONAR_TOKEN="$(cat ~/.lab-sonar-token)"
   export SONAR_HOST_URL="http://sonarqube:9000"
   docker run --rm --network sonar-lab -e SONAR_HOST_URL -e SONAR_TOKEN \
     -v "$PWD:/usr/src" sonarsource/sonar-scanner-cli:<tag>
   ```

   Expected: `EXECUTION SUCCESS` and a link to the dashboard. The project shows a quality gate status.
   If you see something else: `Not authorized` means the token is wrong or lacks the right for this project. `Connection refused` or an unknown host means the scanner is not on the `sonar-lab` network or the URL is wrong. `Project not found` means the key differs from the one on the server.

6. **Read the dashboard.** Open the project. Write down: the gate status and its conditions, the three ratings, the coverage figure, and the definition of new code.
   Expected: coverage is not computed, and the gate is either passed or shows which condition failed.
   If you see something else: if the gate fails only on "coverage", that is expected for a project with no coverage report.

7. **Triage an issue and a hotspot.** Open the Issues tab, pick one (for example the missing type hints or an unused-style rule), read the rule description, and decide: fix it. Open Security Hotspots, find the weak hash hotspot, read the risk, and decide whether it is safe for a checksum you use only for cache keys.
   Expected: you can state, in a sentence, why the finding is safe or not.
   If you see something else: if no hotspot appears, the Python rule set in your edition or version may not flag it; try another sensitive pattern from the rule list.

8. **Break a file on purpose and see a new issue.** Add a function with an obvious bug, then scan again:

   ```bash
   cat >> src/app.py <<'EOF'


   def unreachable(value):
       return value
       print("never runs")
   EOF
   docker run --rm --network sonar-lab -e SONAR_HOST_URL -e SONAR_TOKEN \
     -v "$PWD:/usr/src" sonarsource/sonar-scanner-cli:<tag>
   ```

   Expected: a new issue for unreachable code appears under "new code", and the gate may fail on new issues.
   If you see something else: if nothing is new, the new-code definition may treat this scan as the first baseline; check the project's new-code setting.

9. **Mark a finding with a reason.** On one issue, set the status to false positive or accepted (whichever your version offers), with a comment of the form "reason, owner, revisit date". Look at the issue's history.
   Expected: the comment and your user name are recorded.
   If you see something else: if you cannot change statuses, your user lacks the permission on the project.

10. **Confirm the token is not exposed.** While a scan is running, in another terminal run `ps aux | grep sonar-scanner`.
    Expected: the token does not appear in the arguments, because it travels in the environment. Then compare with a command that uses `-Dsonar.token=...`, only with a throwaway token, and revoke it afterwards.
    If you see something else: if the token appears, you passed it as an argument; revoke it.

Clean up: `docker rm -f sonarqube; docker volume rm sonar_data sonar_extensions sonar_logs; docker network rm sonar-lab; rm -rf ~/sonar-lab ~/.lab-sonar-token`, and revoke the token in the UI if the server still exists.

## Common mistakes

- **Using the embedded database for anything real.** Why it bites: it is for evaluation and does not support upgrades or scale. Fix: an external PostgreSQL for any shared instance.
- **Skipping `vm.max_map_count`.** Why it bites: the server exits at startup with a bootstrap error. Fix: set the value from the docs for your version and persist it.
- **Passing the token with `-D`.** Why it bites: it shows in `ps`, history and CI logs. Fix: the `SONAR_TOKEN` environment variable.
- **Using an administrator or global token in CI.** Why it bites: one leaked log can read or alter every project. Fix: project analysis tokens with an expiry.
- **Judging the gate on overall code.** Why it bites: old debt blocks every change and people stop trusting the gate. Fix: new-code gates and a plan for the old debt.
- **Excluding your own code to turn the gate green.** Why it bites: it hides the real risk. Fix: exclude generated and third-party code only.
- **Expecting coverage without a report.** Why it bites: coverage reads zero and the gate fails on it. Fix: produce a report in your test job and point the scanner to it.
- **Marking findings "false positive" without a comment.** Why it bites: nobody can audit or revisit it. Fix: always write the reason, an owner and a date for accepted risks.
- **Treating a hotspot like a bug.** Why it bites: it is a prompt to review, and closing it unseen defeats the point. Fix: read the risk and record the decision.
- **Copying tag names, token types and status names from old posts.** Why it bites: they have changed. Fix: check the current docs.

## Check your understanding

1. What is the difference between an issue and a security hotspot?
2. Why does the default quality gate look at new code, and what does it let a team do with an old project?
3. How do you give the scanner its token without leaving it visible in `ps`?
4. A gate fails on coverage for a project whose tests pass. What is likely missing?
5. What must a "false positive" or "accepted" decision include to be auditable?
6. Why is the embedded database not suitable for a team instance?

> [!question]- Answers
>
> 1. An issue is a problem the rules found in the code. A hotspot is security-sensitive code that may be fine; a human must review it and record a decision.
> 2. Overall code carries years of old findings. A new-code gate requires that whatever you change meets the bar, so an old project can adopt the gate immediately, while old debt is reduced on its own plan.
> 3. Pass `SONAR_TOKEN` as an environment variable (in Docker `-e SONAR_TOKEN` by name) instead of `-D` on the command line.
> 4. A coverage report from the test tool; SonarQube does not run the tests, it reads a report whose path and format the scanner is told about.
> 5. A written reason that someone else can check, who made the decision, and for accepted risks an owner and a revisit date. The status change is recorded in the issue history.
> 6. It is meant for evaluation: it does not scale, is not supported for production use and complicates upgrades. Use an external supported database such as PostgreSQL.

## Next steps

Next lesson: [[learn/terraform-for-each-lifecycle-and-tests|Delivery 10: Terraform for_each, lifecycle rules and terraform test]], or go back to the main path in [[learn/ci-cd-concepts-and-branching|Delivery 01]] and [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02]] to run the scanner as a pipeline job. The next step for SonarQube itself is making the gate part of CI: see [[patterns/sonarqube-quality-gates]].

To go deeper:

- [[patterns/sonarqube-quality-gates]] for gate definitions, branch and pull request analysis, and CI wiring.
- [[patterns/secret-scanning-pre-commit-and-ci]] for finding credentials before they are committed.
- [[standards/vulnerability-management-slas]] for the fix deadlines.
- [[standards/code-review]] for how findings fit into review.
- [[compliance/policy-exception-and-waiver-process]] for exceptions to a gate.
- [[learn/security-basics-for-devops]] for the wider security habits.

## Sources

- SonarQube Server documentation (https://docs.sonarsource.com/sonarqube-server/), including the pages on installing the server from the Docker image and its host requirements, the SonarScanner CLI, quality gates, new code, and security hotspots. The exact paths change between versions; check them.
- Docker Hub, official `sonarqube` image (https://hub.docker.com/_/sonarqube), for current tags and editions.
- CWE, Common Weakness Enumeration (https://cwe.mitre.org/).
- OWASP Top Ten project (https://owasp.org/www-project-top-ten/).
- Not verified: all output (illustrative), image tag naming, the `vm.max_map_count` and file-limit values, edition and feature tiers, token type names, the newer quality and Clean Code taxonomy and its modes, the default gate's conditions, and hotspot and issue status names. Check the current docs.
