---
title: SonarQube vs Semgrep vs CodeQL for static analysis
description: Comparing SonarQube, Semgrep and CodeQL on what they analyse, custom rules, CI fit, licensing and triage cost for a GitLab and Jenkins team.
type: tool
tags:
  - tools
  - sonarqube
  - security
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Static analysis tools look similar from the outside: run a scanner, get a list of findings. They differ in what they understand about code, how hard custom rules are to write, and how much triage they create. This note compares SonarQube, Semgrep and CodeQL for a team on GitLab CI and Jenkins. Quality-gate configuration is in [[sonarqube-quality-gates]] and is not repeated here.

> [!info] Not checked against current releases
> Versions, supported languages, editions, licence terms and prices were not checked when this note was written. Confirm them in the current documentation, especially CodeQL's terms for private repositories and Semgrep's edition split.

## Criteria

- What the tool analyses: code quality, security patterns, or full dataflow.
- How you write a custom rule for a problem unique to your codebase.
- How it fits CI on GitLab and Jenkins, and where results show up.
- How it handles old code: baselines and new-code focus.
- Licensing and hosting.
- The triage cost per finding.

## At a glance

| Concern        | SonarQube                                        | Semgrep                                                | CodeQL                                            |
| -------------- | ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| Main strength  | Code quality, coverage, security hotspots, gates | Fast pattern matching, easy custom rules               | Deep semantic and dataflow queries                |
| Analysis model | Rule-based analyzers per language                | Syntax-aware pattern matching (taint in some editions) | Builds a database of the code, then queries it    |
| Custom rules   | Plugins, or custom rules in supported languages  | YAML rules, readable in minutes                        | QL query packs; a language to learn               |
| Speed          | Moderate                                         | Fast                                                   | Slower: needs a build or extraction               |
| Result UI      | SonarQube server dashboard                       | CLI, SARIF, optional platform                          | SARIF; GitHub code scanning UI                    |
| Hosting        | Self-hosted server or vendor cloud               | CLI locally; optional hosted platform                  | CLI; best integrated with GitHub                  |
| Licence        | Editions; check the current docs                 | Open-source engine and rules; check editions           | Check the current docs for private-repository use |

## What each analyses: quality and security rules, pattern matching, semantic dataflow

**SonarQube** covers maintainability (code smells, duplication), reliability (bugs), coverage and security. It is the tool that reports one health picture per project and enforces a gate. Its security depth varies by language and edition.

**Semgrep** matches code patterns that look like the code itself, so a rule such as "calls to `yaml.load` without a safe loader" is a few lines. It is excellent for banning dangerous APIs and enforcing house conventions. Cross-file taint tracking depends on the edition; check the current docs.

**CodeQL** compiles the code into a relational database and runs queries over it. That allows precise questions such as "does user input reach this SQL call through three function calls". It finds bugs the others miss, at the cost of build integration and runtime.

## Custom rules: Sonar rules and plugins, Semgrep YAML, CodeQL query packs

A Semgrep rule:

```yaml title="rules/no-shell-true.yaml"
rules:
  - id: python-subprocess-shell-true
    languages: [python]
    severity: ERROR
    message: subprocess with shell=True; pass an argument list instead.
    pattern: subprocess.$FUNC(..., shell=True, ...)
```

Custom SonarQube rules usually mean writing a plugin in Java for the analyzer in question, which is a project in itself; many teams use only the shipped rules and tune the quality profile instead. CodeQL custom queries are written in QL and shipped as query packs; they are the most powerful and the most expensive to maintain. Choose by how often you will write rules: weekly means Semgrep; rarely and with a security team means CodeQL.

## CI commands

```bash title="sonarqube.sh"
# Token held as a masked CI variable (SONAR_TOKEN); host URL as SONAR_HOST_URL
sonar-scanner \
  -Dsonar.projectKey=example-service \
  -Dsonar.sources=. \
  -Dsonar.host.url="$SONAR_HOST_URL"
```

```bash title="semgrep.sh"
# Local scan, no account needed; SARIF for the CI artefact
semgrep scan --config p/ci --sarif --output semgrep.sarif

# With a platform account: diff-aware scans in merge requests.
# SEMGREP_APP_TOKEN must be a masked CI variable, never committed.
semgrep ci
```

```bash title="codeql.sh"
codeql database create db --language=python --source-root .
codeql database analyze db --format=sarif-latest --output=codeql.sarif <suite>
```

Replace `<suite>` with a query suite name for your language and version (see `codeql resolve queries` and the pack documentation); it is not a literal. Compiled languages need a build command passed to database creation.

GitLab CI example publishing SARIF as an artefact:

```yaml title=".gitlab-ci.yml"
semgrep:
  stage: test
  image: semgrep/semgrep:0.0.0 # pin a tested version
  script:
    - semgrep scan --config p/ci --sarif --output semgrep.sarif --error
  artifacts:
    when: always
    paths: [semgrep.sarif]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

SARIF (Static Analysis Results Interchange Format) is the common denominator: all three can emit or import it, so a single viewer or a dashboard can aggregate them. On Jenkins, archive the SARIF file and publish it with a warnings plugin, or send it to the platform you use.

## Baselines, new-code focus and false-positive triage

Turning on a scanner on a ten-year-old repository yields thousands of findings. Do not fix them all, and do not ignore them either.

- **SonarQube**: gate on **new code** only (the "clean as you code" approach), so existing debt does not block merges but cannot grow.
- **Semgrep**: use diff-aware scanning in merge requests, or a baseline commit, so only findings introduced by the change are reported.
- **CodeQL**: compare alerts against the default branch and fail only on new ones.
- Triage rules: every ignored finding needs a reason and an owner; mark false positives in the tool rather than deleting rules; review the suppression list quarterly.
- Start with a small, high-precision rule set. Developers stop reading a tool that cries wolf.

## Licensing and hosting (check the current docs)

SonarQube has a free community edition and paid editions with additional languages, branch analysis and security features; check the current docs for which edition you need and how it is priced. Semgrep's engine and community rules are open source, while the hosted platform and some advanced rules and analysis are commercial. CodeQL is free for open-source repositories on GitHub, and use on private code has licence conditions; check the current docs before using it on GitLab or Jenkins. Self-hosting SonarQube means running a server and a database, with upgrades and backups on you.

## Running two together without double-reporting

Running SonarQube and Semgrep together is common: Sonar for quality gates and coverage, Semgrep for custom security rules. To avoid double-reporting:

- Assign ownership: Sonar owns quality and coverage; Semgrep owns house rules and banned APIs; secrets are handled by [[secret-scanning-pre-commit-and-ci]].
- Disable overlapping rules in one tool rather than suppressing duplicates by hand.
- Gate on one tool's result per concern, and show the other as informational.
- Aggregate SARIF in a single place if you want one list.

## When to choose which

- **SonarQube** when you want one dashboard for quality, coverage and basic security with a merge gate, and are willing to run the server.
- **Semgrep** when you need fast scans, easy custom rules and low friction in merge requests.
- **CodeQL** when you have a security team that will write queries, and the build integration cost is acceptable.

## Recommendation

Use SonarQube (or its cloud offering) as the quality gate with new-code conditions, add Semgrep for custom and house rules in merge requests, and add CodeQL only if you have a security engineer to own queries and your licence situation allows it. Keep the gate small and the baseline honest. Reconsider if you move to GitHub as the primary host (CodeQL becomes much cheaper to operate) or if Sonar's edition pricing outgrows its value. AI-assisted review is a separate layer; see [[ai-code-review-bots]]. Scanner gating for images lives in [[jfrog-xray-vs-trivy-vs-grype]], and the CI systems themselves are compared in [[gitlab-ci-vs-jenkins]].

## Related

- [[sonarqube-quality-gates]]
- [[secret-scanning-pre-commit-and-ci]]
- [[gitlab-ci-vs-jenkins]]
- [[jfrog-xray-vs-trivy-vs-grype]]
- [[ai-code-review-bots]]

## Sources

- [SonarQube Server documentation](https://docs.sonarsource.com/sonarqube-server/)
- [Semgrep documentation](https://semgrep.dev/docs/)
- [CodeQL documentation](https://codeql.github.com/docs/)
- [GitHub code scanning documentation](https://docs.github.com/en/code-security/code-scanning)
