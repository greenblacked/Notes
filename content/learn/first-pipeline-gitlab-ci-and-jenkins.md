---
title: "Delivery 02: Your first pipeline in GitLab CI and Jenkins, artifacts and YAML pitfalls"
description: "Write a first pipeline in GitLab CI and Jenkins side by side, pass files with artifacts, speed it up with a cache and avoid YAML traps."
type: guide
tags:
  - learning
  - ci-cd
  - gitlab-ci
  - jenkins
  - security
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 6 h | You need: [[learn/ci-cd-concepts-and-branching|Delivery 01: CI and CD from the ground up, with branching strategies]] | Lab: Option A, the Ubuntu LTS VM (or the container from Option B) from [[learn/lab-setup|Start 01: Set up your lab]], plus Docker from the Lab B tools for Jenkins and a free GitLab.com account for GitLab CI

In the last lesson a pipeline was an idea and a Bash script. Now you write one that a real CI system runs. This lesson teaches the two systems you will meet most often, GitLab CI and Jenkins, side by side, so that you see which ideas are shared (stages, jobs, variables, artifacts) and which are only syntax.

Both systems are configured with a file in your repository, and for GitLab that file is YAML. YAML looks simple and has several traps that waste hours, so the lesson starts there.

> [!note] What was run
> The YAML typing drills in exercise 9 (the `NO`, `1.10`, `0x1F` and duplicate-key results) were run with Python 3.13 and PyYAML 6.0.1 on Ubuntu on 2026-10-17. The GitLab CI and Jenkins files, the `yamllint` and CI Lint steps and the `jf` commands were **not** run for this page: they follow the official documentation listed under Sources. Pipeline logs, job numbers, durations and timestamps in the sample output are illustrative, and yours will differ. Check anything marked "not verified" against the current documentation before you rely on it.

## What you will learn

- The YAML rules that break pipelines: spaces not tabs, implicit typing, quoting, block scalars, anchors and `extends`, duplicate keys, and how to check a file before you push it.
- How a `.gitlab-ci.yml` is built (stages, jobs, `variables`, `default`, `workflow`, `rules`), why each job starts in a fresh container, and how to read the pipeline page.
- How a declarative `Jenkinsfile` is built (`agent`, `options`, `environment`, `stages`, `when`, `post`, credentials), and how it differs from a scripted pipeline and from a multibranch job.
- The difference between an artifact, a cache and a workspace, and how each system passes files between jobs and keeps downloads fast.
- How to keep secrets out of logs, and the first step toward "build once, promote many".

## YAML you must know first

YAML is a text format for nested data: maps (`key: value`), lists (`- item`) and scalars (strings, numbers, booleans, null). GitLab CI is written in it, and so are Kubernetes manifests, Helm values and many other files you will edit. The format is forgiving to read and unforgiving to write, so learn the rules that matter.

> [!note] Jenkins is not YAML
> A `Jenkinsfile` is Groovy code. Everything in this section applies to `.gitlab-ci.yml` and to the other YAML files you meet, not to the Jenkinsfile.

### Indentation: spaces, never tabs

Indentation shows nesting. YAML forbids tabs for indentation, so use spaces (two per level is the convention) and set your editor to insert spaces.

```yaml title="ok.yml"
build:
  script:
    - echo "two spaces per level"
```

A tab in the indentation gives an error in most parsers. This is what Python's PyYAML printed for a tab before `script:` (the first lines of its message, from the run described above):

```text
while scanning for the next token
found character '\t' that cannot start any token
  in "<unicode string>", line 2, column 1:
```

The wording is different in every parser, but the problem and the fix are the same: replace the tab with spaces.

### Implicit typing: the parser guesses

An unquoted value is not always a string. The parser looks at it and guesses a type. This is the source of the most surprising bugs. The classic examples, with the result from PyYAML 6.0.1 (YAML 1.1 rules):

| You write (unquoted) | You may get      | Why it bites                                             |
| -------------------- | ---------------- | -------------------------------------------------------- |
| `country: NO`        | `false`          | "Norway problem": `NO` and `no` can be booleans          |
| `flag: yes`          | `true`           | `yes` and `on` can be booleans too                       |
| `python: 3.10`       | `3.1` (a number) | The trailing zero is lost, so `3.10` becomes `3.1`       |
| `mask: 0x1F`         | `31`             | A `0x` prefix reads as a hexadecimal number              |
| `q: "1.10"`          | `"1.10"` string  | Quotes force a string, which is the fix                  |
| `n: '0x1F'`          | `'0x1F'` string  | Single quotes work the same way and do not interpret `\` |

In the YAML 1.1 specification `y`, `n`, `Y` and `N` are booleans too, but PyYAML 6.0.1 keeps them as strings; other parsers differ. The newer YAML 1.2 specification removed most of these boolean words, but many parsers and tools still follow the 1.1 rules, and you do not control which parser reads your file. The safe habit is simple: **quote any value that is a version, a code, an ID, or a word that could be a boolean or number.** A Python version in CI (`image: python:3.10`) is inside a longer string and is fine; a bare `version: 3.10` is the trap.

### Strings, block scalars and chomping

Use quotes when a value contains `:` followed by a space, starts with a special character such as `*`, `&`, `!`, `%`, `@` or a backtick, or must stay a string.

For several lines of text, such as a script, use a block scalar:

- `|` keeps line breaks (literal). Use it for shell code.
- `>` folds line breaks into spaces (folded). Use it for long sentences.
- A trailing `-` (`|-`, `>-`) removes the final newline; `+` keeps all trailing newlines. The default (`|`) keeps exactly one.

Results from the same run:

```text
s: |       -> 'one\ntwo\n'
f: >       -> 'one two\n'
k: |-      -> 'one'
```

In GitLab, a script line with a colon and a space in it, such as `echo "build: done"`, must be quoted or written as a block scalar, or the YAML parser reads it as a map.

### Anchors, aliases and `extends`

YAML lets you name a block with an anchor (`&name`) and reuse it with an alias (`*name`) or merge it (`<<: *name`). GitLab supports this, but it also has its own mechanism that is easier to read in the pipeline editor: a hidden job (a name that starts with a dot) plus `extends`.

```yaml title=".gitlab-ci.yml (fragment)"
.python-job:
  image: python:3.12-slim
  before_script:
    - python --version

unit-tests:
  extends: .python-job
  script:
    - python -m unittest -v
```

Use `extends` when you can. Reach for anchors only when `extends` does not fit (for example to reuse a list inside one job). GitLab also has `!reference` to reuse a part of another job; see the documentation.

### Duplicate keys

A map should not repeat a key. Many parsers do not complain: they keep the last one and silently discard the first. PyYAML did exactly that:

```text
a: 1
a: 2      -> {'a': 2}
```

In a pipeline this means the second `script:` or `rules:` in a job replaces the first without a warning. A linter catches it.

### Checking a file before you push

Two checks save most failed pipelines:

- **yamllint** is a linter for YAML syntax and style. It reports tabs, duplicate keys and wrong indentation. Install it from your package manager or `pip` in the lab, then run `yamllint .gitlab-ci.yml`.
- **GitLab CI Lint** checks that the YAML is a valid _pipeline_, not just valid YAML. It lives in the web UI (Build > Pipeline editor, then the Validate tab; menu names move between versions, so look for "CI Lint"). It reports errors such as an unknown key.

Valid YAML is not a valid pipeline. `yamllint` will happily pass `scrpt:` where you meant `script:`, because it is a perfectly good key. CI Lint will not.

> [!warning] Check before relying on this
> The location of CI Lint in the GitLab menu, and the exact wording of its messages, change between GitLab versions. The exact `yamllint` output also depends on its version and your configuration. Look at the current documentation pages listed under Sources.

## GitLab CI: the anatomy of `.gitlab-ci.yml`

GitLab CI reads `.gitlab-ci.yml` at the root of your repository. A **runner** (a program on some machine) picks up each **job**, and jobs are grouped into **stages** that run one after another. Jobs in the same stage may run in parallel.

```yaml title=".gitlab-ci.yml"
stages:
  - build
  - test

variables:
  APP_VERSION: "1.0.0" # Quoted: a version is not a number. Change: your app version.

default:
  image: python:3.12-slim # Change: a Python image tag that is supported today. Pin a tag, never "latest".
  interruptible: true

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH

build-job:
  stage: build
  script:
    - echo "Building version $APP_VERSION"
    - python --version

test-job:
  stage: test
  script:
    - echo "Testing version $APP_VERSION"
    - python -c "print('tests pass')"
```

What each keyword does:

| Keyword          | Meaning                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `stages`         | The ordered list of stages. A job without `stage:` goes to `test`.                                    |
| `variables`      | Environment variables for every job. A job can set its own.                                           |
| `default`        | Settings applied to every job unless the job overrides them (`image`, `before_script`, `cache`, ...). |
| `workflow:rules` | Decides whether the **whole pipeline** is created at all. If no rule matches, there is no pipeline.   |
| `image`          | The container image the job runs in (on a Docker or Kubernetes runner).                               |
| `script`         | The commands. Required for a normal job. The job fails on the first command that exits non-zero.      |
| `before_script`  | Commands that run before `script`, in the same shell. A failure here fails the job.                   |
| `rules`          | Decide whether **one job** runs and how (`when`, `allow_failure`, `variables`).                       |

The `workflow:rules` above avoids the common problem of two pipelines for one push (one for the branch, one for the merge request). It creates a merge request pipeline when there is one, skips the branch pipeline when a merge request is open for that branch (`when: never`), and creates a branch pipeline otherwise. Check the GitLab documentation on "switching between branch pipelines and merge request pipelines" before you copy it into a real project.

### Every job starts clean

Each job runs in a **new** container made from the `image`. When the job ends, the container is thrown away. Anything the first job built (files in the working directory that are not committed, packages it installed, environment variables it exported) is gone when the second job starts. That is the whole reason artifacts and caches exist, and it is the answer to the first check question.

The reason is good: a clean start makes a job repeatable. "It worked in the build job" cannot hide a missing step.

### `rules` instead of `only` and `except`

`rules` is the current way to decide when a job runs. The older `only` and `except` keywords still work, but GitLab's documentation says `rules` is the preferred way and the older keywords are not actively developed. Write new pipelines with `rules`.

```yaml title=".gitlab-ci.yml (job)"
deploy-placeholder:
  stage: deploy
  script:
    - echo "Pretend to deploy $APP_VERSION"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Rules are evaluated top to bottom, and the first match decides. If none matches, the job is not added. A rule can also say `when: manual`, `when: never` or `allow_failure: true`.

> [!warning] Check before relying on this
> "Not actively developed" is how the GitLab documentation describes `only` and `except` at the time of writing. Whether they are formally deprecated, and in which version they would be removed, was not verified. Read the current "rules" and "only/except" pages. Also check the default `allow_failure` of a `when: manual` rule in your GitLab version.

### Predefined variables, and your own

GitLab sets many `CI_*` variables in every job. A few you will use all the time:

| Variable              | Holds                                                       |
| --------------------- | ----------------------------------------------------------- |
| `CI_COMMIT_SHA`       | The full commit hash                                        |
| `CI_COMMIT_SHORT_SHA` | The first eight characters of it                            |
| `CI_COMMIT_BRANCH`    | The branch name (not set in tag pipelines)                  |
| `CI_COMMIT_TAG`       | The tag name (only in tag pipelines)                        |
| `CI_DEFAULT_BRANCH`   | The project's default branch, usually `main`                |
| `CI_PIPELINE_SOURCE`  | Why the pipeline exists: `push`, `merge_request_event`, ... |
| `CI_PROJECT_DIR`      | Where the repository is checked out in the job              |
| `CI_JOB_TOKEN`        | A short-lived token for calling GitLab itself               |

Your own variables come from three places: `variables:` in the YAML, project or group settings (**Settings > CI/CD > Variables**), or a manual pipeline run. Settings are the place for secrets, with these flags:

- **Masked**: the value is hidden in job logs. Masking has format rules (a minimum length and a limited set of characters), so a value may be refused; check the documentation. Masking is a safety net against accidents, not a reason to print secrets.
- **Protected**: the variable is only given to pipelines running on protected branches and protected tags. A job on a feature branch does not see it, which stops a stray branch from reading your production token.
- **Hidden** variables, which are never shown again in the UI, exist in recent versions (verify for your version).

Never put a secret in `.gitlab-ci.yml`. It is in Git history for good.

### Reading the pipeline page

Open **Build > Pipelines** (older versions: **CI/CD > Pipelines**). Each pipeline row shows a status, the commit and the stages as circles. Click a pipeline to see the graph: stages from left to right, jobs inside them. Click a job to read its log. A job log starts with the runner and the image it pulled, then shows `$ command` for each script line with its output, and ends with `Job succeeded` or `ERROR: Job failed: exit code 1`. The status words you will see are `passed`, `failed`, `running`, `pending`, `skipped`, `manual` and `canceled`. Always read the log from the first red line upward, not the last line down: the last line only repeats that the job failed.

## Jenkins: the declarative `Jenkinsfile`

Jenkins is a server (the **controller**) that schedules work on **agents** (machines or containers). Its pipelines are written in a `Jenkinsfile` stored in your repository. There are two syntaxes:

- **Declarative**: a fixed structure (`pipeline { agent ... stages { ... } post { ... } }`) that Jenkins can validate. Start here.
- **Scripted**: free-form Groovy (`node { ... }`). It is more powerful and easier to turn into a mess. You meet it in older pipelines and shared libraries ([[patterns/jenkins-shared-libraries]]).

```groovy title="Jenkinsfile"
pipeline {
    agent any

    options {
        timeout(time: 10, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
    }

    environment {
        APP_VERSION = '1.0.0'
    }

    stages {
        stage('Build') {
            steps {
                sh 'echo "Building version ${APP_VERSION}"'
            }
        }
        stage('Test') {
            steps {
                sh 'echo "Testing version ${APP_VERSION}"'
            }
        }
        stage('Deploy placeholder') {
            when { branch 'main' }
            steps {
                sh 'echo "Pretend to deploy ${APP_VERSION}"'
            }
        }
    }

    post {
        always {
            echo "Build finished with status: ${currentBuild.currentResult}"
        }
        failure {
            echo 'Something failed: read the first red stage.'
        }
        cleanup {
            cleanWs()
        }
    }
}
```

What each block does:

| Block / step       | Meaning                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`            | Where the pipeline runs. `any` means any available agent. You can ask for a label or a container (`agent { docker { image '...' } }`, which needs the Docker Pipeline plugin).   |
| `options`          | Pipeline-wide settings. `timeout` aborts a stuck build, `timestamps()` stamps the log (needs the Timestamper plugin), `disableConcurrentBuilds()` queues instead of overlapping. |
| `environment`      | Environment variables. Also where `credentials()` binds a secret.                                                                                                                |
| `stages` / `stage` | The ordered steps, each with `steps`. A stage appears as a box in the stage view.                                                                                                |
| `when`             | A condition that skips a stage (`branch`, `expression`, `tag`, ...). `branch` works only in multibranch pipelines.                                                               |
| `post`             | Runs after the stages, by outcome: `always`, `success`, `failure`, `unstable`, `cleanup`. `cleanup` runs last, after all the other conditions, whatever the result.              |
| `sh`               | Runs a shell command on the agent. A non-zero exit code fails the stage.                                                                                                         |

Notice the single quotes in `sh 'echo "${APP_VERSION}"'`. In Groovy, single quotes mean "pass this text to the shell as it is", so the **shell** expands `${APP_VERSION}`. Double quotes would make Groovy expand it first. That matters for secrets: see the next section.

> [!warning] Check before relying on this
> Plugin names and the set of available steps depend on what is installed in your Jenkins and its version. `timestamps()` and `cleanWs()` come from plugins (Timestamper and Workspace Cleanup). If the pipeline fails with "No such DSL method", the plugin is missing. The Pipeline Syntax page in your own Jenkins (Snippet Generator) is the source of truth for your version.

### Multibranch pipelines

A plain Pipeline job runs one Jenkinsfile for one branch. A **multibranch pipeline** job scans a repository, creates a sub-job for each branch and pull request that contains a `Jenkinsfile`, and runs each one. This is what you want for a normal team workflow, and it is the only place where `when { branch 'main' }` and the `BRANCH_NAME` variable make sense.

### Secrets with `credentials()`

Jenkins stores credentials (secret text, username and password, SSH keys, files) in its credential store and gives them an ID. Bind one with `credentials('id')` in `environment`:

```groovy title="Jenkinsfile (fragment)"
environment {
    LAB_TOKEN = credentials('lab-token')    // Change: the ID of a "Secret text" credential you created.
}
stages {
    stage('Use secret') {
        steps {
            sh 'echo "token length: ${#LAB_TOKEN}"'   // single quotes: the shell reads the variable, Jenkins masks the value
        }
    }
}
```

Jenkins masks the value in the log, which shows `****` if it is printed. A username and password credential gives you three variables: `NAME`, `NAME_USR` and `NAME_PSW`. Masking is a safety net: it can be bypassed (for example by printing the value in pieces), so never print secrets on purpose.

## Artifacts, caches and workspaces

Three words are easy to mix up:

| Thing         | What it is                                                               | Purpose                                                 | Lifetime                       |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------ |
| **Workspace** | The directory where one job runs                                         | Scratch space for that job                              | One job; GitLab discards it    |
| **Artifact**  | Files a job deliberately **saves** and publishes with the pipeline       | Pass results to later jobs and keep outputs to download | Until it expires (you set it)  |
| **Cache**     | Files you **reuse** between pipelines to save time (downloads, packages) | Speed. A cache is a hint, not a guarantee.              | Best effort; it can be missing |

The test: if the pipeline is **wrong** without the files, they are an artifact. If it is only **slower** without them, they are a cache.

### GitLab artifacts and `needs`

```yaml title=".gitlab-ci.yml (two jobs)"
build-job:
  stage: build
  script:
    - mkdir -p dist
    - echo "app ${APP_VERSION} ${CI_COMMIT_SHORT_SHA}" > dist/version.txt
  artifacts:
    paths:
      - dist/
    expire_in: 1 week

test-job:
  stage: test
  needs:
    - job: build-job
      artifacts: true
  script:
    - test -f dist/version.txt
    - cat dist/version.txt
```

By default GitLab downloads the artifacts of all jobs in earlier stages into a job. With `needs` you name exactly which jobs a job depends on. A job with `needs` can start as soon as those jobs finish, without waiting for the whole previous stage, which makes the pipeline faster. Use `expire_in` so artifacts do not fill your storage ([[standards/artifact-retention-policy]]).

### GitLab cache and keys from files

```yaml title=".gitlab-ci.yml (job with a cache)"
install-deps:
  stage: build
  variables:
    PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"
  cache:
    key:
      files:
        - requirements.txt
    paths:
      - .cache/pip/
  script:
    - pip install -r requirements.txt
```

The cache **key** decides which cache to use. `key: files:` builds the key from the files you list, so the key changes exactly when `requirements.txt` changes. That is the right behaviour: new dependencies, new cache; same dependencies, reuse. A fixed key such as `key: main` keeps an old cache forever and hides problems.

Caches are stored by the runner (or in object storage if the runners are configured that way), and a different runner may not have yours. Treat the cache as a bonus. Never put anything in it that the pipeline needs for correctness.

> [!warning] Check before relying on this
> The log messages for a cache hit and miss, and whether GitLab adds a suffix such as `-protected` to the key, depend on the GitLab and runner versions. Read your own job log and compare it with the "caching" documentation.

### Jenkins artifacts, `stash` and `unstash`

Jenkins has the same ideas with different names.

```groovy title="Jenkinsfile (fragment)"
stage('Build') {
    steps {
        sh 'mkdir -p dist && echo "app ${APP_VERSION} ${GIT_COMMIT}" > dist/version.txt'
        archiveArtifacts artifacts: 'dist/**', fingerprint: true
        stash name: 'dist', includes: 'dist/**'
    }
}
stage('Test') {
    steps {
        unstash 'dist'
        sh 'test -f dist/version.txt && cat dist/version.txt'
    }
}
```

- `archiveArtifacts` saves files with the build so people can download them. `fingerprint: true` records their checksums so Jenkins can show which builds produced and used the same file.
- `stash` and `unstash` move files between stages of **one** build, even across agents. They are for the pipeline, not for keeping results; large stashes are slow.
- `GIT_COMMIT` is set when the job checks out from Git (a multibranch or Pipeline-from-SCM job). In an inline-script job it is empty.

For caching dependencies, Jenkins has no built-in key-based cache. Teams reuse the agent's workspace, mount a volume, or use a plugin. Say "verify for your setup" before you promise a cache.

### Build once, promote many (a preview)

The most important rule of pipelines is to **build the artifact once** and move the _same_ artifact through the environments. If you rebuild for production, what you tested is not what you ship. The next lesson uses this idea to move one version from stage to production. Here is the first half: publishing a built file to a repository such as Artifactory with the JFrog CLI (`jf`).

```bash
# Variables - change these
ARTIFACTORY_URL="https://artifactory.example.com"      # Change: your Artifactory base URL.
REPO="app-generic-local"                                # Change: a generic repository you may write to.
VERSION="1.0.0"

# The access token comes from a masked CI variable, never from the file.
jf config add lab --url="$ARTIFACTORY_URL" --access-token="$ARTIFACTORY_TOKEN" --interactive=false
jf rt upload "dist/*" "${REPO}/app/${VERSION}/"
```

> [!warning] Check before relying on this
> The `jf` commands and flags were not verified. The JFrog CLI changes between versions (the old `jfrog rt` and the `jf rt` commands, the way credentials are configured, and environment variables such as `JF_URL` and `JF_ACCESS_TOKEN`). Run `jf --help`, read the JFrog CLI documentation for your version, and see [[patterns/artifact-promotion-artifactory]] for the production pattern.

## GitLab CI and Jenkins side by side

| Idea                  | GitLab CI                                    | Jenkins (declarative)                                                        |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Pipeline file         | `.gitlab-ci.yml` (YAML)                      | `Jenkinsfile` (Groovy)                                                       |
| Where it runs         | Runners, tagged, usually containers          | Agents, selected by `agent`                                                  |
| Grouping              | `stages`, then jobs inside                   | `stages`, then `stage` blocks with `steps`                                   |
| Run on a condition    | `rules`                                      | `when`                                                                       |
| Variables             | `variables`, project settings                | `environment`, credentials store                                             |
| Secrets               | Masked and protected CI/CD variables         | `credentials()` binding                                                      |
| Always run at the end | `after_script`, or a job with `when: always` | `post { always { ... } }`, `cleanup`                                         |
| Pass files in a run   | `artifacts` + `needs`                        | `stash` / `unstash`                                                          |
| Keep files            | `artifacts` with `expire_in`                 | `archiveArtifacts`                                                           |
| Reuse                 | `extends`, `include`, `!reference`           | Shared libraries                                                             |
| Validate a file       | CI Lint, `yamllint`                          | Declarative linter (`/pipeline-model-converter/validate`), Snippet Generator |
| Where logs are        | Job log page                                 | Console Output                                                               |

Neither is better in the abstract. GitLab CI is built into the platform, so it is quick to start. Jenkins is a separate server you run, and it is very flexible through plugins, at the price of maintenance. The comparison with trade-offs for real teams is in [[tools/gitlab-ci-vs-jenkins]].

## Hands-on exercises

You need a free GitLab.com account for exercises 1 to 3, 7, 8 and 10, Docker for exercises 4 to 6, and a shell with Python 3 for exercise 9. Create a **private** project named `ci-lab` on GitLab.com, clone it, and work inside the clone. Do not put real secrets or company code in it. Shared runners on GitLab.com may need account verification before they run jobs (check the current rules).

### Exercise 1: A two-stage pipeline

1. In your clone, create `.gitlab-ci.yml` with the first example from "The anatomy of `.gitlab-ci.yml`" (the `stages`, `variables`, `default`, `workflow`, `build-job` and `test-job` shown above).
2. Commit and push to the default branch:

   ```bash
   git add .gitlab-ci.yml
   git commit -m "ci: add first pipeline"
   git push origin main
   ```

3. Open **Build > Pipelines**, then open the `build-job` log.

Expected (illustrative): two stages, both green, and the version in the log.

```text
$ echo "Building version $APP_VERSION"
Building version 1.0.0
$ python --version
Python 3.12.x
Job succeeded
```

If you see something else: `This job is stuck` means no runner is available (enable shared runners in **Settings > CI/CD > Runners**, or verify your account). `yaml invalid` on the pipeline row means a syntax error; open the pipeline editor and read the message.

### Exercise 2: A job that rules skip on a branch

1. Add a third stage and the deploy job. Change `stages:` to `[build, test, deploy]` and add:

   ```yaml
   deploy-placeholder:
     stage: deploy
     script:
       - echo "Pretend to deploy $APP_VERSION"
     rules:
       - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
   ```

2. Commit on `main` and push. Then create a branch, change nothing important, and push it:

   ```bash
   git switch -c feature/rules-test
   git commit --allow-empty -m "ci: test rules"
   git push -u origin feature/rules-test
   ```

3. Compare the two pipelines.

Expected: the pipeline on `main` has three green jobs. The pipeline for `feature/rules-test` has only `build-job` and `test-job`; `deploy-placeholder` is not in the graph at all, because no rule matched.

If you see something else: if the feature branch has no pipeline at all, your `workflow:rules` did not match it (the last rule, `if: $CI_COMMIT_BRANCH`, should, unless a merge request is already open for the branch). If the deploy job appears on the branch, check the spelling of `$CI_DEFAULT_BRANCH`.

### Exercise 3: Echo an environment variable

1. Add a job-level variable to `test-job`:

   ```yaml
   test-job:
     stage: test
     variables:
       APP_ENV: dev
     script:
       - echo "Testing version $APP_VERSION in $APP_ENV"
   ```

2. Push and read the log.

Expected: `Testing version 1.0.0 in dev`.

If you see something else: an empty value (`in `) means the variable name in the YAML and in `script` differ, usually by case. Variable names are case-sensitive.

### Exercise 4: Jenkins with three stages

1. Start Jenkins in Docker, bound to your own machine only:

   ```bash
   docker run -d --name jenkins-lab -p 127.0.0.1:8080:8080 -v jenkins_home:/var/jenkins_home jenkins/jenkins:<lts-version>-jdk21   # Change: an LTS tag you checked on Docker Hub
   docker exec jenkins-lab cat /var/jenkins_home/secrets/initialAdminPassword
   ```

2. Open `http://127.0.0.1:8080`, paste the password, install the suggested plugins and create an admin user.
3. Choose **New Item**, name it `first-pipeline`, type **Pipeline**. Under **Pipeline**, choose **Pipeline script** and paste the `Jenkinsfile` from the Jenkins section, but remove the `when { branch 'main' }` line for now, and remove `timestamps()` if the plugin is not installed.
4. Click **Build Now**, then open **Console Output**.

Expected (illustrative):

```text
[Pipeline] stage
[Pipeline] { (Build)
+ echo 'Building version 1.0.0'
Building version 1.0.0
...
Build finished with status: SUCCESS
Finished: SUCCESS
```

The stage view shows three green boxes.

If you see something else: `No such DSL method 'timestamps'` or `cleanWs` means a plugin is missing; remove the line or install the plugin. A page that does not open means the container is not running (`docker ps`).

> [!warning] Keep Jenkins private
> Bind Jenkins to `127.0.0.1` as shown. A Jenkins reachable from the internet with a weak password is a known way to lose a machine. Clean up when you finish the lesson: `docker rm -f jenkins-lab && docker volume rm jenkins_home`.

### Exercise 5: A failing Test stage and `post`

1. Edit the pipeline script. In the `Test` stage use `sh 'echo "Testing"; exit 1'`.
2. Build again and read the console.

Expected (illustrative): the failure and the `post` actions.

```text
+ exit 1
ERROR: script returned exit code 1
...
Something failed: read the first red stage.
...
Finished: FAILURE
```

The `Deploy placeholder` stage is shown as skipped, and the `always`, `failure` and `cleanup` blocks all ran.

If you see something else: if the build is green, the `exit 1` was not in the `Test` stage. If `post` did not run, check that the `post` block is at the `pipeline` level, not inside a stage.

Restore the `Test` stage after this exercise.

### Exercise 6: A stage that only runs on `main` (multibranch)

This needs a Git repository that Jenkins can read. Use the `ci-lab` project on GitLab.com with a read-only deploy token.

1. Commit the complete `Jenkinsfile` (including `when { branch 'main' }`) to `ci-lab` on `main`, and push. Also push the `feature/rules-test` branch with the same file (`git merge main` into it).
2. In Jenkins create **New Item**, type **Multibranch Pipeline**. Add a Git branch source with the HTTPS URL of `ci-lab` and a credential (username and the deploy token as the password). Save and let it scan.
3. Open the job for each branch.

Expected: the `main` build runs all three stages. The `feature/rules-test` build shows `Deploy placeholder` as skipped.

If you see something else: if no branches appear, read the **Scan Repository Log** (usually a wrong URL or credential). If the stage runs on the feature branch, you probably used a plain Pipeline job, where `BRANCH_NAME` is not set.

### Exercise 7: Artifacts and `needs`

1. Replace the jobs in `.gitlab-ci.yml` with the `build-job` and `test-job` from "GitLab artifacts and `needs`". Keep `stages` and `variables`.
2. Push and open the `test-job` log.

Expected (illustrative):

```text
Downloading artifacts for build-job (1234567890)...
$ test -f dist/version.txt
$ cat dist/version.txt
app 1.0.0 1a2b3c4d
Job succeeded
```

The `build-job` page also has a **Browse** button for the artifact.

If you see something else: `No such file or directory` for `dist/version.txt` means the artifact was not uploaded: check `artifacts: paths:` and that the file path is inside the project directory. Then remove `needs:` and see that the default also downloads it, because the jobs are in different stages.

### Exercise 8: Cache miss, hit and a new key

1. Create `requirements.txt` with the single line `pytest>=8,<9` (a real project pins exact versions) and add the `install-deps` job from the cache section. Push.
2. Open the log of the first run, then push an empty commit (`git commit --allow-empty -m "ci: rerun"`) and read the second log.
3. Change `requirements.txt` to `pytest>=8,<9` plus a second line, `pyyaml>=6,<7`, commit and push.

Expected (illustrative): the first run reports that no cache was found and creates one at the end. The second run restores it and pip reports `Requirement already satisfied` or uses cached files. After the change the key differs, so the log reports no cache found again.

```text
Checking cache for 4c9a...-non_protected...
WARNING: file does not exist
Failed to extract cache
```

If you see something else: if the second run also misses, runners may not share a cache (shared runners often do not). That is normal and is exactly why a cache is a hint.

### Exercise 9: The YAML drills

1. Run the typing drill. You need Python 3 and PyYAML (`python3 -c "import yaml"` should not fail; install it in a virtual environment if it does):

   ```bash
   python3 - <<'PY'
   import yaml
   doc = "country: NO\nflag: yes\npy: 3.10\nmask: 0x1F\nquoted: \"3.10\"\n"
   print(yaml.safe_load(doc))
   PY
   ```

   Expected: `{'country': False, 'flag': True, 'py': 3.1, 'mask': 31, 'quoted': '3.10'}`.

2. Run the tab drill. Create a file with a tab before `script:` and lint it:

   ```bash
   printf 'job:\n\tscript: echo hi\n' > tab.yml
   yamllint tab.yml
   ```

   Expected (illustrative, not run for this page): an error that mentions a syntax problem and tabs, with a line and column.

3. Run the CI Lint drill. In the GitLab pipeline editor, change `script:` to `scrpt:` in one job and press **Validate**.

   Expected (illustrative, not run): a message like `jobs:build-job config contains unknown keys: scrpt`, or that the job needs `script`. The file is valid YAML, so `yamllint` passes it.

If you see something else: if `yamllint` is not installed, `pip install yamllint` in a virtual environment. If the typing result differs, your PyYAML or Python version may have different rules; note the version and compare it with the YAML 1.2 rules.

### Exercise 10: Clean up

Delete the `ci-lab` branches you no longer need, remove the Jenkins container and volume (command in the warning above), and keep the `ci-lab` project: the next lessons reuse it.

## Common mistakes

- **Tabs in YAML.** Why it bites: the file fails to parse with a confusing message. Fix: set the editor to spaces and run `yamllint` before every push.
- **Unquoted versions and codes.** Why it bites: `3.10` becomes `3.1` and `NO` becomes `false`, so the pipeline pulls the wrong version or sets the wrong flag. Fix: quote them.
- **Expecting files to survive between jobs.** Why it bites: every job is a fresh container, so a file built in `build` is missing in `test`. Fix: declare `artifacts` (and `needs`) or `stash`.
- **Using a cache for things the pipeline needs.** Why it bites: a cache can be empty on another runner, so the pipeline passes on one runner and fails on another. Fix: artifacts for results, caches only for speed.
- **A cache key that never changes.** Why it bites: stale dependencies are reused for months. Fix: build the key from the lock file (`key: files:`).
- **Artifacts that never expire.** Why it bites: storage and cost grow without limit. Fix: set `expire_in` and follow your retention policy.
- **Secrets in the YAML or in `echo`.** Why it bites: the value is in Git history and in the logs. Fix: masked and protected variables or the Jenkins credential store; print a length or a hash if you must check a value.
- **Double quotes around a secret in a Jenkins `sh` step.** Why it bites: Groovy puts the value into the command line before Jenkins can mask it, and it can leak into logs and process lists. Fix: use single quotes so the shell reads the variable.
- **Putting `branch` conditions in a non-multibranch job.** Why it bites: `BRANCH_NAME` is not set, so the stage never runs. Fix: use a multibranch pipeline.
- **A pipeline that has a `post` cleanup nobody checks.** Why it bites: a failing cleanup hides the real failure. Fix: read the first failing stage first, then the cleanup.

## Check your understanding

1. Why does every GitLab job start from a clean container, and what do you use when a second job needs the first job's files?
2. What is the difference between an artifact and a cache? Give one example of each.
3. Why should you write `python_version: "3.10"` with quotes?
4. In a declarative Jenkins pipeline, when do `post { always }`, `post { failure }` and `post { cleanup }` run?
5. A job should run on the default branch only. Write the GitLab `rules` entry.
6. Your `.gitlab-ci.yml` passes `yamllint` but the pipeline shows `unknown keys: scrpt`. Why did the linter not catch it?

> [!question]- Answers
>
> 1. A clean container makes each job repeatable and independent, so a missing step cannot hide behind leftover files. To pass files forward, declare `artifacts` in the first job and, if you want control, `needs` in the second. In Jenkins use `stash` and `unstash`.
> 2. An artifact is a result that later jobs or people need and that the pipeline depends on, for example the `dist/` folder of a build. A cache is a speed-up that the pipeline works without, for example the pip download directory. If the pipeline is wrong without it, it is an artifact; if it is only slower, it is a cache.
> 3. Unquoted, `3.10` is read as the number 3.1, so the trailing zero is lost and you ask for the wrong version. Quotes make it a string, which keeps `3.10` exactly.
> 4. `always` runs every time, after the stages. `failure` runs only when the build failed. `cleanup` runs last, after all other post conditions, whatever the result, so it is the right place to remove the workspace.
> 5. `rules:` followed by `- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`.
> 6. `yamllint` checks YAML, not GitLab's pipeline schema. `scrpt:` is a legal YAML key, so it passes. CI Lint knows which keys a job may have and rejects the unknown one.

## Next steps

Next lesson: [[learn/environments-releases-and-rollbacks|Delivery 03: Environments, releases, approvals and rollbacks]]. Previous lesson: [[learn/ci-cd-concepts-and-branching|Delivery 01: CI and CD from the ground up, with branching strategies]].

To go deeper:

- [[patterns/gitlab-ci-pipeline-structure]] shows how a production GitLab pipeline is organised.
- [[patterns/jenkins-shared-libraries]] covers reuse across many Jenkinsfiles, and [[patterns/jenkins-controller-and-agent-hardening]] covers running Jenkins safely.
- [[tools/gitlab-ci-vs-jenkins]] compares the two systems in depth.
- [[patterns/artifact-promotion-artifactory]] continues the "build once, promote many" idea.
- [[patterns/secret-scanning-pre-commit-and-ci]] stops secrets before they reach the repository.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

Only the YAML typing and tab drills in exercise 9 were run (Python 3.13, PyYAML 6.0.1, Ubuntu, 2026-10-17). Everything else is explanation from the sources below. Pages change: check them for the version you use.

- GitLab documentation, "CI/CD YAML syntax reference" (https://docs.gitlab.com/ci/yaml/), including `rules`, `needs`, `artifacts`, `cache` and `workflow`. Version not verified.
- GitLab documentation, "CI/CD variables" and "Predefined variables reference" (https://docs.gitlab.com/ci/variables/), including masked and protected variables. Not verified: the masking format rules.
- GitLab documentation, "Caching in GitLab CI/CD" and "Job artifacts" (https://docs.gitlab.com/ci/caching/, https://docs.gitlab.com/ci/jobs/job_artifacts/).
- GitLab documentation, "Validate GitLab CI/CD configuration" for CI Lint (https://docs.gitlab.com/ci/yaml/lint/). Not verified: the menu location in your version.
- Jenkins documentation, "Pipeline Syntax" and "Pipeline Steps Reference" (https://www.jenkins.io/doc/book/pipeline/syntax/, https://www.jenkins.io/doc/pipeline/steps/), including `post`, `when`, `options`, `stash`, `archiveArtifacts` and `credentials()`. Version not verified.
- Jenkins documentation, "Using a Jenkinsfile" and "Multibranch pipelines" (https://www.jenkins.io/doc/book/pipeline/jenkinsfile/, https://www.jenkins.io/doc/book/pipeline/multibranch/).
- YAML Ain't Markup Language (YAML) revision 1.2.2 (https://yaml.org/spec/1.2.2/).
- yamllint documentation (https://yamllint.readthedocs.io/). Not verified: the output for the tab drill.
- JFrog CLI documentation (https://docs.jfrog.com/). Not verified: the `jf` commands and flags.
