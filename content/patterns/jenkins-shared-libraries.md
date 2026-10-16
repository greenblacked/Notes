---
title: Jenkins shared libraries
description: How to structure, version, test and consume a Jenkins shared library, with Kubernetes pod agents, credential handling and a full Jenkinsfile example.
type: pattern
tags:
  - patterns
  - jenkins
  - ci-cd
  - kubernetes
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A shared library turns copy-pasted Jenkinsfiles into reviewed, versioned code. The goal is that an application Jenkinsfile is 20 lines that say what the service is, while the library holds how we build, scan and deploy. The mechanism is documented on jenkins.io under "Extending with Shared Libraries"; the details below are the parts that matter in production.

If you are choosing between Jenkins and GitLab CI for a new service, read [[gitlab-ci-vs-jenkins]]. The GitLab equivalent of this note is [[gitlab-ci-pipeline-structure]].

## Library structure

```text
my-shared-lib/
  vars/
    standardPipeline.groovy     # global step: standardPipeline(...)
    standardPipeline.txt        # help text shown in the pipeline syntax reference
    notifyTeam.groovy
  src/
    org/example/ci/
      Version.groovy            # plain Groovy classes
      HelmRunner.groovy
  resources/
    podTemplates/
      maven-helm.yaml           # loaded with libraryResource
  test/
    groovy/                     # unit tests
  build.gradle
```

- **`vars/`** holds global variables and steps. Each file `foo.groovy` becomes a step `foo(...)` when it defines `call()`. This is the public API of the library; keep it small and stable.
- **`src/`** holds ordinary Groovy classes in packages, imported with `import org.example.ci.Version`. Use it for logic that is easier to test than a step. Classes in `src/` do not have the pipeline steps in scope, so pass `steps` (or `this`) in explicitly.
- **`resources/`** holds non-Groovy files such as pod YAML, shell scripts and templates. Read them with `libraryResource 'podTemplates/maven-helm.yaml'`.

A step with a config map is the usual shape:

```groovy title="vars/standardPipeline.groovy"
def call(Map config = [:]) {
  def cfg = [
    imageRepo: config.imageRepo ?: error('imageRepo is required'),
    chartPath: config.chartPath ?: 'helm/app',
    namespace: config.namespace ?: 'default',
    deployBranch: config.deployBranch ?: 'main',
  ]

  pipeline {
    agent {
      kubernetes {
        yaml libraryResource('podTemplates/maven-helm.yaml')
        defaultContainer 'maven'
      }
    }
    options {
      timeout(time: 45, unit: 'MINUTES')
      disableConcurrentBuilds()
      buildDiscarder(logRotator(numToKeepStr: '30'))
    }
    stages {
      stage('Build and test') {
        steps {
          sh 'mvn -B -ntp verify'
        }
        post {
          always { junit 'target/surefire-reports/*.xml' }
        }
      }
      stage('Push image') {
        steps {
          withCredentials([usernamePassword(
            credentialsId: 'artifactory-ci',
            usernameVariable: 'REG_USER',
            passwordVariable: 'REG_PASS')]) {
            sh '''
              set +x
              mvn -B -ntp jib:build \
                -Djib.to.image="${IMAGE}" \
                -Djib.to.auth.username="${REG_USER}" \
                -Djib.to.auth.password="${REG_PASS}"
            '''.stripIndent()
          }
        }
      }
      stage('Deploy') {
        when { branch cfg.deployBranch }
        steps {
          container('helm') {
            sh "helm upgrade --install app ${cfg.chartPath} --namespace ${cfg.namespace} --set image.tag=${env.GIT_COMMIT.take(8)} --atomic --wait --timeout 5m"
          }
        }
      }
    }
  }
}
```

This sketch assumes the Maven project configures the Jib plugin and that `IMAGE` is set in the environment; adapt it to your build.

## Versioning the library

Loading the library from a moving branch means any merge to the library can break every pipeline at once. Treat it as a dependency:

- Tag releases with semantic versions (`v1.2.0`) and have consumers pin to a tag: `@Library('platform-lib@v1.2.0') _`.
- Keep the default version in Manage Jenkins, System, Global Trusted Pipeline Libraries on a stable branch or the latest tag, and allow the default to be overridden so a team can test a feature branch with `@Library('platform-lib@feature/helm-3') _`.
- Do not tick "Load implicitly" for a library that changes often; implicit loading hides which version a build used.
- Breaking changes get a major version bump. Keep the previous major supported for a stated period and announce the migration (see [[stakeholder-communication]]).
- Record the library version in the build description so a failed build can be traced to its code.

Shared libraries defined at folder level are not "trusted": their code runs inside the Groovy sandbox and needs script approvals for restricted methods. Libraries configured globally by an administrator run outside the sandbox. Keep the global one small and reviewed, because anyone who can change it can run arbitrary code on the controller.

## Consuming the library

```groovy title="Jenkinsfile"
@Library('platform-lib@v1.2.0') _

standardPipeline(
  imageRepo: 'artifactory.example.com/docker/my-service',
  chartPath: 'helm/my-service',
  namespace: 'my-service',
  deployBranch: 'main'
)
```

The trailing underscore is required when the annotation is not followed by an import. For custom pipelines that still reuse helpers, write a normal declarative pipeline and call steps (`notifyTeam(...)`) from inside it.

## Pod templates for Kubernetes agents

With the Kubernetes plugin, each build gets a fresh Pod. Keep the pod spec in `resources/` so every service uses the same, reviewed definition:

```yaml title="resources/podTemplates/maven-helm.yaml"
apiVersion: v1
kind: Pod
metadata:
  labels:
    jenkins-agent: maven-helm
spec:
  serviceAccountName: jenkins-agent
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
  containers:
    - name: maven
      image: maven:3-eclipse-temurin-21
      command: ["sleep"]
      args: ["infinity"]
      resources:
        requests:
          cpu: "1"
          memory: 2Gi
        limits:
          memory: 2Gi
    - name: helm
      image: alpine/helm:latest
      command: ["sleep"]
      args: ["infinity"]
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          memory: 128Mi
```

Notes:

- The plugin adds a `jnlp` container to each pod to connect back to the controller; you do not declare it unless you want to override it.
- Containers that do work must stay alive. `sleep infinity` keeps them running; the pipeline runs commands in them with `container('name') { ... }` or via `defaultContainer`.
- Set requests and limits on every container, or builds will be scheduled as best effort and evicted first. Sizing guidance is in [[kubernetes-resource-requests-and-limits]].
- Pin image tags; `latest` is shown here only to keep the example short.
- Give the agent a dedicated Kubernetes ServiceAccount and use Workload Identity Federation for Google Cloud access instead of key files; see [[gke-workload-identity]].

## Credentials

- Store secrets in the Jenkins credentials store (or an external provider) and reference them by ID. Never put secrets in the Jenkinsfile, library or pod YAML.
- Use `withCredentials([...])` to scope a secret to a block. Jenkins masks the value in the console log, but masking is not a security boundary: a command that transforms the value (base64, splitting) can print it unmasked.
- Prefer single quotes for `sh` bodies that reference secrets. With double quotes Groovy interpolates the secret into the command string, which can leak it into process listings and logs. With single quotes the shell expands the environment variable.
- Use the most specific binding: `usernamePassword`, `string`, `file`, `sshUserPrivateKey`. Use short-lived tokens where the target system supports them.
- Restrict who can use which credentials through folder-scoped credentials, not one global set.
- Rotate on exposure; the process is in [[leaked-credential-rotation]].

## Testing the library

- **Unit tests** with JenkinsPipelineUnit (a Gradle or Maven test dependency) load `vars/*.groovy` with a mocked pipeline DSL and assert on which steps were called. They are quick and catch typos and wrong arguments.
- **Plain classes in `src/`** are tested with ordinary Spock or JUnit tests. Move logic here whenever you can; it is the cheapest code to test.
- **Integration**: keep a sample repository whose Jenkinsfile uses `@Library('platform-lib@<branch>') _`, and run it on a non-production Jenkins before tagging a release.
- **Lint**: validate declarative syntax with the Jenkins API (`/pipeline-model-converter/validate`) in CI for the library's examples.
- **Release flow**: merge to main, run tests, tag `vX.Y.Z`, publish release notes. Consumers update their pin through a pull request.

JenkinsPipelineUnit cannot execute real steps, so treat it as a check of your own logic and wiring, not of the plugins.

## Pitfalls

- **CPS limitations.** Pipeline code runs through a continuation-passing-style interpreter. Some Groovy constructs (closures passed to `.each`, non-serialisable objects across steps) fail or behave oddly. Keep heavy logic in methods annotated `@NonCPS` only when it does not call pipeline steps.
- **Non-serialisable objects.** Holding a `Matcher` or an open stream across a step fails when the build is paused and resumed.
- **Global state.** Variables in `vars/` scripts are shared per build, not per library; do not use them as a cache across builds.
- **Unpinned library.** The most common cause of "the pipeline broke and nothing changed in my repo".
- **Controller load.** Heavy Groovy and string processing run on the controller. Push work into `sh` steps on agents.
- **Secrets in parameters.** Build parameters are visible in the UI and logs. Use credentials, not string parameters, for secrets.

## Related

- [[helm-chart-conventions]]: what the deploy stage assumes about the chart.
- [[artifact-promotion-artifactory]]: promoting the built image rather than rebuilding it.
- [[sonarqube-quality-gates]]: add a quality gate stage to `standardPipeline`.
