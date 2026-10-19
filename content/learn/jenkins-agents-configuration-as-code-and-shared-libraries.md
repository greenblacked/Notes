---
title: "Delivery 07: Jenkins beyond the first pipeline: agents, Configuration as Code and a first shared library"
description: Move builds off the Jenkins controller onto labelled agents, describe the controller in Configuration as Code, and write a pinned shared library.
type: guide
tags:
  - learning
  - jenkins
  - ci-cd
  - security
created: 2026-10-19
modified: 2026-10-19
draft: false
---

> [!info] Level: middle | Time: about 5 h | You need: [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02: Your first pipeline in GitLab CI and Jenkins]] | Lab: the Jenkins container from Delivery 02, plus Docker

In Delivery 02 you ran Jenkins in a container, clicked through the setup wizard, and ran builds on `agent any`. That is a learning setup, and it has three problems that every real Jenkins installation meets: builds run on the controller (the machine that holds every credential and all configuration), the controller's configuration lives in a web UI and a volume nobody can review, and the same Groovy is copied from `Jenkinsfile` to `Jenkinsfile`. This lesson fixes each one: **agents**, **Configuration as Code** (JCasC) with pinned plugins, and a first **shared library**. The senior, team-scale view of libraries and hardening lives in [[patterns/jenkins-shared-libraries]] and [[patterns/jenkins-controller-and-agent-hardening]]; this is the first step towards them.

> [!note] Nothing here was run for this page
> The commands, files and sample output follow the Jenkins documentation and are not verified. Image tags, plugin names and JCasC keys change between versions: everything marked "check the current docs" must be checked against what you install. Output is illustrative.

## What you will learn

- Why builds must not run on the controller, and how to set the built-in node to zero executors.
- How SSH agents and inbound agents differ, how labels route work, and how `agent { docker { ... } }` works.
- How to build a controller image with pinned plugins and describe the configuration in a JCasC YAML file, with secrets coming from the environment.
- How a shared library is laid out, called and pinned to a tag, and why the library's repository needs the protection of production code.
- How to test and roll out a library change.

## Why the controller runs no builds

The controller stores credentials, job configuration and build history, and it can reach every agent and many internal systems. A build is arbitrary code written by whoever can push to a repository. If that code runs **on the controller**, it runs next to all of this, as the same operating system user as Jenkins, and it can read `$JENKINS_HOME`: credential stores, secrets keys, other jobs' workspaces. A pull request that adds `sh 'cat $JENKINS_HOME/secrets/*'` is enough to try.

The rule from the Jenkins controller-isolation guidance is simple: **builds run on agents, and the controller has no executors for builds.**

- Set **Number of executors** on the built-in node to **0** (Manage Jenkins, Nodes, Built-In Node, Configure). With JCasC it is `jenkins: numExecutors: 0` (below).
- Give jobs a label that exists only on agents, so a job with no matching agent waits instead of silently running on the controller.
- Treat the controller like a production server: limited network exposure, a few administrators, backups of `$JENKINS_HOME`, plugins kept to the minimum.

The hardening list is in [[patterns/jenkins-controller-and-agent-hardening]], and the general security habits in [[learn/security-basics-for-devops]].

> [!warning] Never mount `docker.sock` into the controller
> Mounting `/var/run/docker.sock` into the controller container so that "pipelines can use Docker" gives the controller, and anyone who can run a pipeline on it, root on the Docker host: a container started with the socket can mount the host's filesystem. Run Docker builds on **agents** that you accept this risk for, or use a rootless or daemonless builder, and see the hardening pattern for the full discussion.

## Agents

An **agent** is a machine or container that runs the steps of a build. The controller sends it work and receives results. There are two ways to connect an agent.

| Style             | Who starts the connection                                           | Typical use                                                   |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| **SSH agent**     | The controller connects to the agent over SSH.                      | Long-lived VMs the controller can reach; key-based login.     |
| **Inbound agent** | The agent connects to the controller (WebSocket or the agent port). | Agents behind NAT or a firewall, containers, Kubernetes pods. |

Official images exist for both: `jenkins/ssh-agent` (an SSH server the controller logs in to) and `jenkins/inbound-agent` (a process that connects back). Image names, tags and options change, so check the current docs and pin a tag you checked.

An inbound agent in the lab looks like this. First create the node in the UI (Manage Jenkins, Nodes, New Node, "Permanent Agent", name `agent1`, remote root directory `/home/jenkins/agent`, labels `linux docker`), copy its secret, then:

```bash title="start an inbound agent in the lab"
docker network create jenkins-lab-net 2>/dev/null || true
docker network connect jenkins-lab-net jenkins-lab    # the controller container from Delivery 02

JENKINS_URL="http://jenkins-lab:8080"          # the controller as seen from the agent container
# Change: ~/.agent1.env holds the secret from the node page, saved with mode 600:
#   JENKINS_SECRET=<secret from the node page>
# Verify the variable names (JENKINS_URL, JENKINS_AGENT_NAME, JENKINS_SECRET, JENKINS_WEB_SOCKET) in the image docs.
docker run -d --name agent1 --init --network jenkins-lab-net \
  --env-file ~/.agent1.env \
  -e JENKINS_URL="$JENKINS_URL" -e JENKINS_AGENT_NAME=agent1 -e JENKINS_WEB_SOCKET=true \
  jenkins/inbound-agent:<tag>
```

`<tag>` is a tag you have checked on Docker Hub. The connection flags (`-webSocket`, `-url`, `-secret`, `-name`, `-workDir`) differ between versions of the agent, and some versions take them as environment variables instead; check the image documentation. The secret is a credential. The example passes it as an environment variable from a file, not as a `-secret` argument, because command-line arguments show up in `ps` and in `docker inspect`. Environment variables still show in `docker inspect` for anyone with access to the Docker daemon, so outside a lab mount the secret as a file or use your orchestrator's secret mechanism (check the image documentation for a file-based form). Do not paste it into a shared terminal or a script in Git.

### Labels

A **label** is a free-text tag on a node. A pipeline asks for an agent by a label expression, and Jenkins picks any matching idle node:

```groovy title="Jenkinsfile (fragment)"
pipeline {
    agent { label 'linux && docker' }
    stages {
        stage('Build') {
            steps { sh 'uname -a' }
        }
    }
}
```

Use labels for **capabilities** (`docker`, `gpu`, `arm64`, `windows`), not for machine names: a name ties a pipeline to one host, a label lets you add capacity by adding nodes with that label. Keep the label set small and documented.

### Docker agents in a pipeline

With the Docker Pipeline plugin (its plugin id is `docker-workflow`; check the current docs for the name) and Docker installed on the agent, a stage can run in a container, so the toolchain comes from an image and not from the agent:

```groovy title="Jenkinsfile (fragment)"
pipeline {
    agent none
    stages {
        stage('Test') {
            agent {
                docker {
                    image 'python:3.12-slim'      // Change: an image tag you have checked
                    label 'linux && docker'       // the node that has Docker
                    args '--network none'         // optional: no network for a unit-test stage
                }
            }
            steps {
                sh 'python --version'
            }
        }
    }
}
```

Jenkins starts the container on a matching node, mounts the workspace into it and runs the steps inside. Two cautions: the agent user needs access to the Docker daemon, which is a powerful privilege (see the warning above), and a container image you did not choose is code you run, so pin the tag and prefer images from your own registry ([[patterns/dockerfile-hardening]]).

## A custom controller image

The setup wizard and "install suggested plugins" give you a snowflake. A controller you can rebuild from files in Git has three parts: a **pinned plugin list**, a **JCasC file** and a **Dockerfile** that joins them.

### Pinned plugins

```text title="plugins.txt"
configuration-as-code:<version>
workflow-aggregator:<version>
git:<version>
credentials-binding:<version>
docker-workflow:<version>
```

Replace each `<version>` with the version you checked on [plugins.jenkins.io](https://plugins.jenkins.io/). A line without a version installs the latest, which is not reproducible. The `jenkins-plugin-cli` tool in the official image resolves dependencies and downloads the plugins; the plugin ids and the file format are in the image documentation (check the current docs, the names above are examples to verify).

```dockerfile title="Dockerfile.controller"
FROM jenkins/jenkins:<lts-version>-jdk21          # Change: an LTS tag you checked
USER root
# no extra packages needed; stay minimal
USER jenkins
COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
ENV CASC_JENKINS_CONFIG=/var/jenkins_conf
COPY --chown=jenkins:jenkins casc/ /var/jenkins_conf/
```

`runSetupWizard=false` skips the first-run wizard because JCasC configures the instance. `CASC_JENKINS_CONFIG` tells the Configuration as Code plugin where to read YAML: a file, a directory (all `.yaml` files in it) or a URL. Keep plugin updates on purpose: update `plugins.txt` in a merge request, rebuild, and test the new image before it replaces the old one.

### Configuration as Code

The `configuration-as-code` plugin reads YAML and configures Jenkins at startup, so settings are reviewed in Git rather than clicked.

```yaml title="casc/jenkins.yaml"
jenkins:
  systemMessage: "Lab controller. Builds run on agents only."
  numExecutors: 0 # no builds on the controller
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "admin"
          password: "${ADMIN_PASSWORD}" # from the environment, never written here
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
credentials:
  system:
    domainCredentials:
      - credentials:
          - string:
              scope: GLOBAL
              id: "lab-token"
              secret: "${LAB_TOKEN}"
              description: "Lab secret text"
unclassified:
  location:
    url: "http://127.0.0.1:8080/"
```

Notes:

- **Secrets come in through `${VAR}` interpolation** from environment variables (or files, secret stores or Docker secrets, depending on the plugin version; check the docs). The YAML in Git contains only the variable name. A password written into the file ends up in Git history, in the image layers and in every backup.
- The `local` security realm with one user is for the lab. A real controller uses your identity provider; the keys for that depend on the plugin you use.
- The keys under `jenkins:`, `credentials:` and `unclassified:` come from each plugin's schema and change with versions. The plugin has a documentation page in the controller itself (Manage Jenkins, Configuration as Code, Documentation) that lists exactly what your install accepts.
- Credentials created through JCasC are re-created at every start, which is good for reproducibility and means edits made in the UI are lost. Decide what is owned by code and what is owned by people.

Run the image with the secrets in the environment, taken from files, not typed:

```bash title="run the custom controller"
docker build -f Dockerfile.controller -t jenkins-lab:casc .
docker run -d --name jenkins-casc -p 127.0.0.1:8081:8080 \
  -e ADMIN_PASSWORD="$(cat ~/.lab-admin-password)" \
  -e LAB_TOKEN="$(cat ~/.lab-token)" \
  -v jenkins_casc_home:/var/jenkins_home \
  jenkins-lab:casc
```

Bind to `127.0.0.1`, as in Delivery 02. Note that anyone with `docker inspect` rights on this host can read the environment; in real use prefer secret files or an external secret store.

### Export the current configuration

If you already have a controller, do not start from a blank file. In Manage Jenkins, Configuration as Code, use "View Configuration" (or download it) to see the YAML for the live instance, then trim it to what you want to own. The export masks secrets, so do not expect passwords in it. Review it before committing: it may include internal URLs and user lists.

## A first shared library

When ten repositories have the same `build, test, publish` Groovy, copy and paste turns into ten diverging versions. A **shared library** is a Git repository with Groovy code that pipelines import.

### Layout

```text title="lab-lib repository"
lab-lib/
  vars/
    labBuild.groovy      # global step: labBuild(...)
  src/
    org/example/Version.groovy   # plain Groovy classes
  resources/
    org/example/Dockerfile.tmpl  # files loaded with libraryResource
```

- **`vars/`** holds _global variables_, which are the steps your pipelines call. A file `labBuild.groovy` defines the step `labBuild`.
- **`src/`** holds ordinary Groovy classes in packages, for logic that is more than a step.
- **`resources/`** holds static files read with `libraryResource('org/example/Dockerfile.tmpl')`.

### A step with call(Map)

```groovy title="vars/labBuild.groovy"
def call(Map config = [:]) {
    String img    = config.image ?: 'python:3.12-slim'
    String script = config.script ?: 'make test'
    int minutes   = (config.timeoutMinutes ?: 10) as int

    pipeline {
        agent none
        options { timeout(time: minutes, unit: 'MINUTES') }
        stages {
            stage('Build and test') {
                agent { docker { image img; label 'linux && docker' } }
                steps { sh script }
            }
        }
    }
}
```

`call` makes `labBuild(...)` usable like a step. A `Map` parameter keeps the interface readable and lets you add options without breaking callers. A library step can contain a whole declarative pipeline, as here, or just a stage-level helper. Prefer **small, composable steps** and defaults that are safe, and validate the input (fail early with a clear message) rather than trusting the caller.

### Using the library, pinned to a tag

```groovy title="Jenkinsfile"
@Library('lab-lib@v0.1.0') _

labBuild(image: 'python:3.12-slim', script: 'pytest -q', timeoutMinutes: 15)
```

`@Library('name@version') _` loads the library named `lab-lib` at the version after the `@`: a **tag**, a branch or a commit. The underscore is needed when the annotation is not followed by an import. **Pin to a tag** (`v0.1.0`). A library pinned to `main` changes every pipeline that uses it at the next build, with no change in the pipeline's own repository to review; that is the same supply-chain risk as an unpinned CI `include`. Release the library with tags and update the pin on purpose.

### Trusted and sandboxed libraries

Where the library is configured decides how much it can do:

- **Global (trusted) libraries**, configured by an administrator in Manage Jenkins (or in JCasC). Their code runs **outside the Groovy sandbox**: it can call almost any Jenkins or Java API. Only administrators can add them, and every line in them is privileged code.
- **Folder or job-level libraries**, configured by users who can configure those folders. Their code runs in the **sandbox**, which limits the methods it may call and requires administrator approval for others (script approval).

Because trusted library code is effectively administrator code, **the library repository needs the protection of production code**: protected branches, required reviews, restricted write access, and signed or protected tags. Whoever can push to it can run anything on the controller's Groovy runtime. "Load implicitly" (the library is loaded by every pipeline without `@Library`) makes this worse, so use it sparingly.

In JCasC, a global library looks like the block below. The exact key names and the nesting of the SCM retriever depend on the plugin versions you installed: check the current docs and the in-controller documentation page.

```yaml title="casc/library.yaml"
unclassified:
  globalLibraries:
    libraries:
      - name: "lab-lib"
        defaultVersion: "v0.1.0"
        implicit: false
        allowVersionOverride: true
        retriever:
          modernSCM:
            scm:
              git:
                remote: "https://git.example.com/ci/lab-lib.git"
                credentialsId: "lab-lib-readonly"
```

`allowVersionOverride: true` lets a Jenkinsfile choose a different version with `@Library('lab-lib@v0.2.0')`. If you set it to false, only the default applies, which is stricter and useful for a security-critical library.

## Credentials in a library and in a pipeline

Delivery 02 showed `credentials('id')` in `environment`, which binds a secret for the whole pipeline or stage. A library step often needs the secret only for a few lines. Use `withCredentials`, which scopes the binding to a block:

```groovy title="vars/labPublish.groovy"
def call(Map config = [:]) {
    withCredentials([string(credentialsId: config.credentialsId ?: 'lab-token', variable: 'LAB_TOKEN')]) {
        sh '''
            set +x                        # make sure the shell does not echo commands
            ./scripts/publish.sh          # reads LAB_TOKEN from its environment
        '''
    }
}
```

- The secret exists only inside the block, and Jenkins masks it in the log.
- Single-quote the `sh` script so Groovy does not interpolate the secret into a string that may be logged; the shell reads the environment variable.
- **Never echo a secret**, never pass it as a command-line argument (it appears in the process list), and never write it to a file in the workspace.
- A library should take the credential **ID** as a parameter and never contain a value.

## Testing and rolling out a library

A library change can break every pipeline that uses it, so test it before you release a tag.

- **Replay.** On any build, "Replay" lets you edit the Jenkinsfile and the library code in the UI and re-run once, without committing. It is the fastest way to try a change on a real pipeline. It is for experiments: changes are not saved, and a user who can replay can run edited code, so it requires permission.
- **A test pipeline.** Keep a small repository whose Jenkinsfile loads the library at a branch (`@Library('lab-lib@feature/new-step') _`) and exercises each step.
- **JenkinsPipelineUnit.** A third-party framework for unit-testing pipeline and library Groovy with Gradle or Maven, mocking steps such as `sh`. It is a community project, not part of Jenkins; evaluate its maintenance and compatibility with your Jenkins version before you depend on it.
- **Release process.** Merge, tag (`v0.2.0`), then update the consumers' pins one repository at a time, starting with the least critical. Keep old tags available so a bad release can be rolled back by changing the pin back.

## Hands-on exercises

You need the Jenkins container from Delivery 02, Docker, and a Git repository you can push to (the `ci-lab` project, or a new private `lab-lib`). All output is illustrative.

1. **Stop builds on the controller.** In the UI, set the built-in node's executors to 0. Create a Pipeline job with `agent any` and run it.
   Expected: the build waits with a message that there is no executor or no node with the label.
   If you see something else: if it still runs, you changed a different node, or a leftover Docker-based agent matched. Check Manage Jenkins, Nodes.

2. **Add an inbound agent.** Create the node `agent1` with labels `linux docker`, then start the agent container from the Agents section.
   Expected: the node page shows the agent connected and the waiting build from exercise 1 starts on `agent1`.
   If you see something else: if the agent exits, read `docker logs agent1`. A connection refused means the container is not on the same Docker network as the controller, or the URL is wrong. A secret mismatch means you copied a stale secret.

3. **Route by label.** Change the job to `agent { label 'linux && docker' }` and run `uname -a`. Then use `label 'windows'`.
   Expected: the first runs on `agent1`; the second waits with no matching node. Revert it.
   If you see something else: label matching is case-sensitive and uses exact words; check the node's label field.

4. **Run a stage in a container.** Install the Docker Pipeline plugin (and Docker on `agent1`, for example by mounting the host socket into the lab agent only: acceptable on a throwaway lab, not in real life) and use the `agent { docker { image '...' } }` block from above.
   Expected: the console shows a `docker run` for the image and the command output.
   If you see something else: "Cannot connect to the Docker daemon" means the agent has no Docker access. "docker: not found" means the Docker CLI is missing in the agent image.

5. **Build the custom controller.** Write `plugins.txt` with versions you looked up, `Dockerfile.controller` and `casc/jenkins.yaml` with `numExecutors: 0`. Build and run it as shown, with the secrets from files.
   Expected: no setup wizard, a login page, and Manage Jenkins shows 0 executors on the built-in node and a system message.
   If you see something else: a plugin that fails to install names a missing or incompatible dependency in the build output; fix the version in `plugins.txt`. A JCasC error appears in the controller log at startup and names the offending key; compare it with the in-controller documentation page.

6. **Prove secrets are not in the YAML.**

   ```bash
   grep -rn 'PASSWORD\|LAB_TOKEN' casc/ ; git grep -n -F -f ~/.lab-token || echo "token not in repository"
   ```

   Expected: only the `${...}` references and "token not in repository".
   If you see something else: if the real value appears, remove it, rotate the secret and clean the history ([[runbooks/leaked-credential-rotation]]).

7. **Create the library.** In `lab-lib` add `vars/labBuild.groovy` from above, commit, tag `v0.1.0` and push. Add the library in Manage Jenkins, System, Global Pipeline Libraries (or `casc/library.yaml`), default version `v0.1.0`.
   Expected: the library appears in the configuration page with no error.
   If you see something else: a "Could not resolve" or authentication error means the SCM URL or credential is wrong; use a read-only credential.

8. **Use it from a Jenkinsfile.** In `ci-lab` use `@Library('lab-lib@v0.1.0') _` and `labBuild(script: 'echo hello')`.
   Expected: the build log shows the library being loaded at `v0.1.0` and your command running in the container.
   If you see something else: "No such DSL method 'labBuild'" means the library name or `vars/` file name differs; the step name is the file name without `.groovy`.

9. **See why pinning matters.** Change the step's default `script` on the library's `main` and push. Re-run the pipeline pinned to `v0.1.0`, then pinned to `main`.
   Expected: the pinned build does not change; the `main` build uses the new default.
   If you see something else: if the pinned build changed too, the pipeline's `@Library` line is not pinned or the version override is not what you think.

10. **Try Replay and a scoped credential.** Add `labPublish` from above, create the `lab-token` credential, and call it. Then use Replay to edit the step once.
    Expected: the log shows `****` instead of the token, and the replay runs with your edit without a commit.
    If you see something else: if the token is printed in clear, a command echoed it; remove that command. If Replay is missing, your user lacks the permission.

Clean up: `docker rm -f agent1 jenkins-casc; docker volume rm jenkins_casc_home; docker network rm jenkins-lab-net`, remove `~/.lab-*` secret files you created, and delete the lab library repository if you no longer need it.

## Common mistakes

- **Running builds on the built-in node.** Why it bites: build code runs next to every credential and all configuration. Fix: zero executors on the controller and labels on agents.
- **Mounting the Docker socket into the controller.** Why it bites: it is root on the host for anyone who can run a pipeline. Fix: isolated Docker-capable agents, or a daemonless builder.
- **Plugins without versions.** Why it bites: a rebuild installs different plugins than yesterday, and a bad release reaches production. Fix: pin versions in `plugins.txt`, update in a merge request, test the image.
- **Secrets in the JCasC YAML.** Why it bites: they end up in Git history, in image layers and in backups. Fix: `${VAR}` interpolation from the environment or a secret store.
- **Assuming JCasC keys never change.** Why it bites: an upgrade silently renames a key or fails to start. Fix: read the in-controller documentation page for the installed versions, and test upgrades.
- **Using a library from `main`.** Why it bites: an unreviewed push changes every pipeline. Fix: `@Library('name@tag')`, and update pins deliberately.
- **An unprotected library repository.** Why it bites: a trusted library runs outside the sandbox. Fix: protected branches, reviews and limited write access.
- **Printing a credential.** Why it bites: masking is a safety net that can be bypassed. Fix: `withCredentials`, single-quoted `sh`, never `echo`, and no secrets in arguments.
- **Using labels as machine names.** Why it bites: pipelines tie themselves to one host. Fix: capability labels.
- **Forgetting `agent none` on the top level when stages use their own agents.** Why it bites: an extra executor is held for the whole pipeline. Fix: `agent none` at the top.

## Check your understanding

1. Why should the controller's built-in node have zero executors, and what happens to a job that needs an agent when none matches?
2. What is the difference between an SSH agent and an inbound agent? Which one fits a container on a laptop behind NAT?
3. How do secrets get into a JCasC-configured controller without being in the YAML?
4. What goes in `vars/`, `src/` and `resources/` of a shared library?
5. Why does `@Library('lab-lib@main') _` worry a security reviewer more than `@Library('lab-lib@v0.1.0') _`?
6. What makes a global library "trusted", and what follows for the repository that holds it?

> [!question]- Answers
>
> 1. Builds are arbitrary code, and on the controller they run next to all credentials and configuration. With zero executors, builds go to agents; a job that needs a label that no node has waits in the queue instead of running on the controller.
> 2. An SSH agent is reached by the controller over SSH; an inbound agent connects to the controller. A container on a laptop behind NAT cannot be reached from the controller, so use an inbound agent.
> 3. Through `${VAR}` interpolation: the YAML names the variable, and the value comes from the environment (or a file or secret store) when the container starts.
> 4. `vars/` holds global steps (`name.groovy` with `call`), `src/` holds Groovy classes in packages, and `resources/` holds static files read with `libraryResource`.
> 5. `main` moves: any push changes every pipeline that uses it at the next build, without a review in the consuming repository. A tag is a fixed, reviewable version that you update on purpose.
> 6. A global library configured by an administrator runs outside the Groovy sandbox, so its code is effectively administrator code. The repository needs production protection: protected branches, reviews and a short list of writers.

## Next steps

Next lesson: [[learn/artifactory-repositories-access-and-retention|Delivery 08: Artifactory basics]], where your pipelines get a proper place to publish and resolve artifacts. For the other major CI system compare [[learn/gitlab-ci-rules-dag-matrix-and-includes|Delivery 06: GitLab CI beyond the first pipeline]], whose `include` pinning is the same idea as library pinning. Previous lesson on first pipelines: [[learn/first-pipeline-gitlab-ci-and-jenkins|Delivery 02]].

To go deeper:

- [[patterns/jenkins-shared-libraries]] for library design, versioning and testing at team scale.
- [[patterns/jenkins-controller-and-agent-hardening]] for the full hardening list, including agent-to-controller trust and Docker access.
- [[tools/gitlab-ci-vs-jenkins]] for choosing between the two systems.
- [[learn/security-basics-for-devops]] for secrets and least privilege.

## Sources

- Jenkins documentation, "Managing Nodes" (https://www.jenkins.io/doc/book/managing/nodes/), for built-in node executors, SSH and inbound agents and labels.
- Jenkins documentation, "Controller Isolation" (https://www.jenkins.io/doc/book/security/controller-isolation/), for the reasoning behind no builds on the controller.
- Jenkins documentation, "Installing Jenkins" with Docker (https://www.jenkins.io/doc/book/installing/docker/).
- Configuration as Code plugin (https://plugins.jenkins.io/configuration-as-code/), for `CASC_JENKINS_CONFIG`, secret interpolation and the schema. Check the keys for the versions you install.
- Jenkins Docker image repository (https://github.com/jenkinsci/docker), for `jenkins-plugin-cli`, `plugins.txt` and the `ref` directory.
- Jenkins documentation, "Extending with Shared Libraries" (https://www.jenkins.io/doc/book/pipeline/shared-libraries/), for the layout, `@Library`, versions, trusted and sandboxed libraries and `libraryResource`.
- Docker Pipeline plugin (https://plugins.jenkins.io/docker-workflow/), for `agent { docker { ... } }`.
- Not verified: all output (illustrative), image tags, plugin names and versions, the exact JCasC keys for credentials, security realms and global libraries, the inbound-agent connection flags, and JenkinsPipelineUnit compatibility. Check the current docs.
