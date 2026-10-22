---
title: "Kubernetes 08: Authoring a reusable Helm chart: values schema, dependencies, chart tests and packaging"
description: "Turn a working chart into a reusable one: a values schema, pinned dependencies, chart tests, and a versioned package pushed to an OCI registry."
type: guide
tags:
  - learning
  - helm
  - kubernetes
  - supply-chain
created: 2026-10-19
modified: 2026-10-19
draft: false
---

> [!info] Level: middle | Time: about 4 h | You need: [[learn/helm-basics-and-capstone|Kubernetes 06: Helm basics and the capstone chart]] | Lab: kind, plus a local registry container

[[learn/helm-basics-and-capstone|Kubernetes 06]] ended with a list called "What this lesson leaves out": dependencies, `helm test`, sharing charts and a values schema it only mentioned. This lesson picks up that list. A chart that works for you is a chart that renders with your values. A **reusable** chart refuses wrong values early, declares what it depends on, can prove that it works after install, and is published as an immutable, versioned package that other people and pipelines can pin.

> [!note] Nothing here was run for this page
> The commands and files follow the Helm documentation and are not verified. Output is illustrative. Commands follow the Helm major version used in Kubernetes 06; Helm 4 changes some flags, so compare with the release notes and `helm COMMAND --help` for the version you run (check the current docs).

## What you will learn

- When to use `include` instead of `template`, and what `tpl` and `fail` are for in a named template.
- How a `values.schema.json` rejects bad values, and which commands apply it.
- How to declare dependencies in `Chart.yaml` with a version range, a `condition` and an `alias`, and how `helm dependency update` and `build` differ.
- How to debug a render with `helm template --debug --show-only` and `helm lint --strict`.
- How to write a chart test, package the chart with `helm package` and publish it to an OCI registry.
- Why a published chart version must never be changed.

## From working to reusable

The capstone chart in Kubernetes 06 (`web`) has the files you know: `Chart.yaml`, `values.yaml`, `templates/` and `_helpers.tpl`. Take that chart as the starting point for this lesson (copy it to `~/helm/web`). The conventions a team agrees on (naming, labels, structure) are in [[patterns/helm-chart-conventions]], and the CI gates that run on every chart change are in [[patterns/helm-chart-ci-quality-gates]]. This lesson does not copy the Testing or Publishing sections of that pattern; it teaches the mechanics those sections assume, and you can read the pattern for the team rules.

A short checklist of what "reusable" means in practice:

1. Wrong values fail at `helm lint` or `helm template`, not at 3 a.m. in a running cluster.
2. Anything the chart needs from another chart is declared and pinned.
3. A command exists that tells you the release works.
4. The chart is a versioned artifact in a registry, and a version is never overwritten.

## Named templates in more depth

Kubernetes 06 introduced `_helpers.tpl` and `define`. Three details matter once other people use your chart.

### include or template

Both render a named template. Only `include` returns a **string** that you can pipe:

```yaml title="templates/_helpers.tpl"
{{- define "web.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

```yaml title="templates/deployment.yaml (excerpt)"
metadata:
  labels:
    {{- include "web.labels" . | nindent 4 }}
```

`{{ template "web.labels" . }}` is an action, not a function, so you **cannot** write `{{ template "web.labels" . | nindent 4 }}`: the pipe does not work and the YAML indentation breaks. Use `include` whenever you need `nindent`, `indent`, `quote`, `sha256sum` or any other function on the result. Passing `.` (the root context) gives the template access to `.Values`, `.Release` and `.Chart`; if you pass a smaller object, the template sees only that object.

### tpl

`tpl` renders a string as a template. It lets a user put a template expression in a value:

```yaml title="values.yaml (excerpt)"
ingress:
  host: "{{ .Release.Name }}.example.com"
```

```text title="templates/ingress.yaml (excerpt)"
host: {{ tpl .Values.ingress.host . | quote }}
```

It is powerful and risky: a value can now run template logic, including `include` and `lookup`, so you accept template code from whoever controls the values. Use it for a few documented fields (hostnames, annotations), not for everything. Document each `tpl` field in the chart README.

### fail and required

`fail` stops rendering with your message. Use it for conditions that no schema can express:

```yaml title="templates/_validate.tpl"
{{- define "web.validate" -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) -}}
{{- fail "ingress.enabled is true but ingress.host is empty: set ingress.host" -}}
{{- end -}}
{{- end -}}
```

Call it once, from a template that always renders, with `{{- include "web.validate" . -}}` at the top of `templates/deployment.yaml`. For a single missing value, `required` is shorter: `{{ required "image.tag must be set" .Values.image.tag }}`. Schema first, `required` for one key, `fail` for rules between keys.

## values.schema.json

A file named `values.schema.json` next to `values.yaml` is a JSON Schema ([json-schema.org](https://json-schema.org/)) for the values. Helm validates the **merged** values against it, so it catches mistakes in your defaults, in `-f` files and in `--set`.

```json title="values.schema.json"
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": ["image", "replicaCount"],
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20,
      "description": "Number of Pods."
    },
    "image": {
      "type": "object",
      "additionalProperties": false,
      "required": ["repository", "tag"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "tag": { "type": "string", "pattern": "^[A-Za-z0-9_.-]+$" },
        "pullPolicy": { "enum": ["Always", "IfNotPresent", "Never"] }
      }
    },
    "ingress": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "host": { "type": "string" }
      }
    },
    "resources": { "type": "object" }
  }
}
```

What this rejects, with the effect you would otherwise have had:

| Mistake                      | Without a schema                                    | With the schema                            |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `replicacount: 3` (typo)     | Ignored; the default is used.                       | Rejected by `additionalProperties: false`. |
| `replicaCount: "3"` (string) | Rendered as `"3"` and rejected later by Kubernetes. | Rejected: not an integer.                  |
| `image.pullPolicy: Alway`    | Pod fails with `InvalidImagePullPolicy` at runtime. | Rejected: not in the enum.                 |
| `image.tag` missing          | Renders `image: nginx:` or `nginx:null`.            | Rejected: required.                        |

Facts to remember:

- Helm applies the schema on `helm install`, `helm upgrade`, `helm lint` and `helm template`. It does not need a cluster, so it also runs in CI.
- `additionalProperties: false` is strict and catches typos, but it blocks keys that sub-charts or users add. Be strict for your own top-level keys and leave sub-chart values open (a sub-chart has its own schema, applied to its own values).
- Which JSON Schema drafts Helm supports and how errors read depend on the Helm version. Check the current docs; the `draft-07` form above is widely supported.
- A schema documents the chart as a side effect: `description` fields can feed a README generator.

## Dependencies

A chart can depend on other charts, for example a database chart for a test environment. They are declared in `Chart.yaml`:

```yaml title="Chart.yaml"
apiVersion: v2
name: web
description: Example web service
type: application
version: 0.2.0
appVersion: "1.0.0"
dependencies:
  - name: redis
    version: "~19.0.0" # Change: a range you checked in the chart's own repository
    repository: "oci://registry.example.com/charts" # or https://charts.example.com
    condition: redis.enabled
    alias: cache
```

The fields:

- **`version`** is a SemVer range (`~19.0.0` means patch updates within 19.0; `^19.0.0` means minor updates within 19). A range is resolved when you run `helm dependency update`, and the exact result is written to the lock file. Never use `*` or an open range for something you deploy.
- **`repository`** is an `https://` chart repository URL or an `oci://` registry path. The repository must be reachable from the machine that runs the update, with credentials if it is private (`helm repo add` for HTTPS repositories, `helm registry login` for OCI).
- **`condition`** names a value (here `redis.enabled`) that turns the dependency on or off, so the same chart can run with or without it. **`tags`** group several dependencies for switching together.
- **`alias`** lets you include the same chart twice under different names, and it changes the key used in values (`cache:` instead of `redis:`).

Values for a dependency go under its name (or alias) in the parent's `values.yaml`. The parent's `.Values` can also see `global:` values that every sub-chart receives.

### update, build and the lock file

| Command                  | What it does                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `helm dependency update` | Resolves the ranges in `Chart.yaml` against the repositories, downloads the chart archives into `charts/`, writes `Chart.lock`. |
| `helm dependency build`  | Downloads exactly what `Chart.lock` says, and fails if the lock file is out of date with `Chart.yaml`. Does not re-resolve.     |
| `helm dependency list`   | Shows each dependency and its status (`ok`, `missing`, `unpacked`).                                                             |

Use `update` when you intend to change dependency versions, and commit the new `Chart.lock`. Use `build` in CI so that the build uses the versions you reviewed. The lock file also records a digest, so a changed upstream chart under the same version is noticed. Whether to commit the downloaded `charts/*.tgz` depends on the team: most commit `Chart.lock` and ignore `charts/` (add it to `.gitignore` and `.helmignore` as needed) and run `build` in CI. Many Helm commands (`install`, `template`, `lint` on a chart with dependencies) fail with "found in Chart.yaml, but missing in charts/" until you have run one of the two.

Dependencies are third-party code that ends up in your cluster. Pin them, review upgrades like any other dependency ([[patterns/automated-dependency-updates]]), and mirror them into your own registry or repository manager when you can ([[learn/artifactory-repositories-access-and-retention]]).

## Debugging renders

When a template misbehaves, look at what it produced, not at what you meant:

```bash title="render, debug and lint"
helm template web ./web --debug                    # print rendered manifests and the computed values
helm template web ./web --show-only templates/deployment.yaml
helm template web ./web -f values-prod.yaml --set image.tag=1.2.3 --show-only templates/ingress.yaml
helm lint ./web --strict                           # warnings fail the lint
helm lint ./web --strict -f values-prod.yaml       # lint the chart as it will be used
```

- `--debug` shows the merged values and, on a template error, the partly rendered output, so you can see the line that broke.
- `--show-only` limits the output to one template. The path is relative to the chart root.
- `--strict` on `helm lint` turns warnings into failures. Lint a chart once with its defaults and once for each environment's values file, because a schema failure or a `required` call shows up only with those values.
- `helm template` does not talk to the cluster, so it cannot show admission failures or missing CRDs. The full-render check is in [[patterns/helm-chart-ci-quality-gates]].

For a more thorough unit test of templates without a cluster, there is a third-party plugin, `helm-unittest`, in which you describe expected rendered output in YAML test files. It is a community plugin and not part of Helm, so evaluate it and pin its version before you rely on it.

## Chart tests

`helm test` runs checks against an **installed release**. A chart test is a normal Kubernetes object, usually a Pod, in `templates/tests/` that carries the annotation `helm.sh/hook: test`. `helm test` creates it, waits for it to finish, and reports success if its container exits 0.

```yaml title="templates/tests/test-connection.yaml"
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "web.fullname" . }}-test-connection"
  labels:
    {{- include "web.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  restartPolicy: Never
  containers:
    - name: wget
      image: busybox:1.36   # Change: a tag you have checked, ideally from your own registry
      command: ["wget"]
      args: ["-q", "-O", "-", "http://{{ include "web.fullname" . }}:{{ .Values.service.port }}/"]
```

Run it after an install or upgrade:

```bash title="run the chart tests"
helm test web --namespace helm-lab --logs --timeout 2m
```

```text
NAME: web
LAST DEPLOYED: Mon Oct 19 10:15:30 2026
NAMESPACE: helm-lab
STATUS: deployed
...
TEST SUITE:     web-test-connection
Last Started:   Mon Oct 19 10:16:01 2026
Last Completed: Mon Oct 19 10:16:04 2026
Phase:          Succeeded
```

_Illustrative._

- `--logs` prints the test Pod's logs, which is what you need when it fails.
- The **delete policy** keeps test Pods from piling up. `before-hook-creation` removes an old test Pod before a new run (so a re-run does not fail with "already exists"), and `hook-succeeded` removes it after success. Keep failed Pods for inspection by leaving out `hook-failed`.
- A test should prove **the release works**, not repeat unit tests: can I reach the Service, can the app reach its database, does the config load. It runs inside the cluster, with the cluster's DNS and network policies, which is the point.
- Tests need an image to run, so mind the same supply-chain care as for any other image, including a pinned tag and a registry you can reach.

The place of `helm test` in a pipeline (after deploy, before promotion) is covered in [[patterns/helm-chart-ci-quality-gates]].

## Packaging and OCI

`helm package` turns a chart directory into a versioned `.tgz`:

```bash title="package with explicit versions"
helm dependency build ./web
helm package ./web --version 0.2.0 --app-version 1.0.0 --destination ./dist
ls ./dist
```

```text
web-0.2.0.tgz
```

`--version` sets the **chart** version (and therefore the file name) and `--app-version` sets `appVersion`, which overrides what is in `Chart.yaml`. That lets a pipeline stamp a release from a Git tag without editing files. The two versions are independent, as Kubernetes 06 explained.

Charts can be stored in any OCI-compliant registry, the same kind that holds container images. In recent Helm versions OCI support is stable, with a different set of commands from classic chart repositories (check the current docs for the minimum version you need).

```bash title="log in, push, and install by version"
REGISTRY="registry.example.com"            # Change: your registry host
helm registry login "$REGISTRY" --username lab-user --password-stdin < ~/.lab-registry-token

helm push ./dist/web-0.2.0.tgz "oci://${REGISTRY}/charts"
helm show chart "oci://${REGISTRY}/charts/web" --version 0.2.0
helm install web "oci://${REGISTRY}/charts/web" --version 0.2.0 --namespace helm-lab --create-namespace
```

Points that matter:

- The push path is `oci://HOST/NAMESPACE` and the chart name and version come from the package; the pushed reference becomes `oci://HOST/NAMESPACE/NAME:VERSION`. Install and show use the chart name in the URL plus `--version`.
- Always **install by version**. Without `--version` you get "the latest", which is whatever was pushed last or the highest SemVer, and is not a deployment you can reproduce.
- Read the registry token from a file or the environment (`--password-stdin`), never as a `--password` argument, which shows up in process lists and shell history.
- A local test registry such as `registry:2` serves plain HTTP. Helm may then refuse the push or the pull; a `--plain-http` flag exists for this on recent versions and an older `--insecure` option on others. Flag names and defaults change between Helm versions, so run `helm push --help` and check the current docs. Never use plain HTTP outside a local lab.

For an `https` chart repository (an `index.yaml` served over HTTP) the equivalent is `helm repo index` and an upload, then `helm repo add` and `helm install repo/chart`. OCI is simpler to run if you already operate a registry, and it reuses the registry's access control, scanning and retention ([[learn/artifactory-repositories-access-and-retention]]).

### Version immutability

A published chart version is a **promise**: `web 0.2.0` is the same bytes for everyone, forever. If you push a different `0.2.0` over the old one:

- people who already installed it have a release whose chart no longer matches the registry, so a rollback or a comparison is confusing;
- caches (a CI runner, a GitOps controller) keep the old copy and the cluster disagrees with Git;
- an audit cannot say what was deployed.

Treat a pushed version as immutable. Fix forward with `0.2.1`, and set the registry to reject overwrites of an existing tag if it can (a repository setting in most registries; check yours). Record the digest the registry prints on push when you need a stronger pin: an OCI reference can be `chart@sha256:...`. Rolling back a bad release means installing an earlier version, not re-pushing it ([[runbooks/helm-release-rollback]]). Signing and provenance for charts is a larger topic; see the Helm documentation on provenance and how it compares to image signing.

Choosing between Helm and Kustomize for a given problem is a separate question, covered in [[tools/helm-vs-kustomize]].

## Hands-on exercises

You need a kind cluster, Helm and Docker. Work in `~/helm`. Output is illustrative.

1. **Copy the capstone chart.**

   ```bash
   mkdir -p ~/helm && cd ~/helm
   cp -r /path/to/your/web ./web      # Change: where your Kubernetes 06 chart is
   helm lint ./web --strict
   ```

   Expected: `1 chart(s) linted, 0 chart(s) failed`.
   If you see something else: if `--strict` reports warnings such as a missing `icon`, either fix them or note which are acceptable for your team; `--strict` is meant to make you decide.

2. **Prove a typo is invisible without a schema.**

   ```bash
   helm template web ./web --set replicacount=5 | grep -n replicas
   ```

   Expected: `replicas:` shows the default value, not 5; no error.
   If you see something else: if your chart already has a schema, remove it temporarily (`mv web/values.schema.json /tmp/`) to see the contrast.

3. **Add the schema and watch the same command fail.** Save `values.schema.json` from above in `./web` (match the keys of your own `values.yaml`; add any key it is missing, since `additionalProperties: false` rejects them):

   ```bash
   helm template web ./web --set replicacount=5
   helm template web ./web --set replicaCount=abc
   ```

   Expected: both fail with a message naming the key and the violated rule (`additional property replicacount is not allowed`, `expected integer`).
   If you see something else: if a valid command fails with `additional property ... is not allowed`, add that key to the schema. The wording of the error varies by Helm version.

4. **Use `fail` for a rule between keys.** Add `_validate.tpl` and the call, then:

   ```bash
   helm template web ./web --set ingress.enabled=true
   helm template web ./web --set ingress.enabled=true --set ingress.host=web.example.com | head -5
   ```

   Expected: the first fails with your message; the second renders.
   If you see something else: if nothing fails, the `include` of `web.validate` is not in a template that renders; put it at the top of `deployment.yaml`.

5. **Compare `include` and `template`.** In a scratch copy, change one `include ... | nindent 4` to `template ...` with the same pipe.
   Expected: a parse error or broken YAML.
   If you see something else: if it renders, look at the output indentation; a missing `nindent` leaves the labels at the wrong depth.

6. **Add a dependency from a local path.** For a lab with no registry, use a `file://` repository: create a tiny `redis-like` chart with `helm create ./cachechart` from `~/helm`, then add to `Chart.yaml` of `web`:

   ```yaml
   dependencies:
     - name: cachechart
       version: "0.1.0"
       repository: "file://../cachechart"
       condition: cachechart.enabled
   ```

   Because the exercise 3 schema sets `additionalProperties: false`, also add `"cachechart": { "type": "object" }` to `properties` in `values.schema.json`, or exercise 7 will reject `--set cachechart.enabled=...`.

   ```bash
   helm dependency update ./web
   helm dependency list ./web
   cat web/Chart.lock
   ```

   Expected: `charts/cachechart-0.1.0.tgz` exists, `list` shows `ok`, and `Chart.lock` records the version and a `digest`.
   If you see something else: "directory not found" means the `file://` path is relative to the chart directory; fix it. If `list` shows `missing`, you did not run `update` or `build`.

7. **Switch the dependency off with the condition.**

   ```bash
   helm template web ./web --set cachechart.enabled=false | grep -c 'name: web-cachechart'
   helm template web ./web --set cachechart.enabled=true  | grep -c 'name: web-cachechart'
   ```

   Expected: `0`, then a number greater than 0.
   If you see something else: if the first is not 0, the `condition` path does not match the dependency's name or alias.

8. **Write and run a chart test.** Save the test Pod, install, and test:

   ```bash
   kind create cluster --name helm-lab 2>/dev/null || true
   helm upgrade --install web ./web --namespace helm-lab --create-namespace --wait --timeout 3m
   helm test web --namespace helm-lab --logs --timeout 2m
   ```

   Expected: `Phase: Succeeded`.
   If you see something else: read the test Pod logs (`--logs`). A DNS or connection error means the Service name or port in the test is wrong; run `kubectl get svc -n helm-lab`. If the test Pod image cannot be pulled, check the tag.

9. **Break the app and watch the test fail.** Set a wrong port in the Service (`--set service.port=81` if your chart passes it to the targetPort) or scale to zero, then run `helm test` again.
   Expected: `Phase: Failed` and the log of the failing request.
   If you see something else: if it still passes, the test is not testing the thing you broke; make it hit the application path.

10. **Package and push to a local registry.**

    ```bash
    docker run -d --name lab-registry -p 127.0.0.1:5000:5000 registry:2
    helm dependency build ./web
    helm package ./web --version 0.2.0 --app-version 1.0.0 --destination ./dist
    helm push ./dist/web-0.2.0.tgz oci://localhost:5000/charts --plain-http
    helm show chart oci://localhost:5000/charts/web --version 0.2.0 --plain-http | head -5
    ```

    Expected: a `Pushed:` and a `Digest:` line, and then the chart metadata with `version: 0.2.0`.
    If you see something else: `--plain-http` may not exist in your Helm version, or the registry may be treated as insecure by default for `localhost`; run `helm push --help` and follow the docs for your version.

11. **Install by version, then try to overwrite.**

    ```bash
    helm install web2 oci://localhost:5000/charts/web --version 0.2.0 --plain-http -n helm-lab2 --create-namespace
    ```

    Then change a template, repackage as `0.2.0` and push again.
    Expected: the install works. The second push succeeds in the plain `registry:2` (it allows overwrites), which is the point: nothing stops you except discipline and registry settings. Repackage as `0.2.1` instead.
    If you see something else: a registry that refuses the overwrite is configured correctly for production use; use a new version.

Clean up: `helm uninstall web -n helm-lab; helm uninstall web2 -n helm-lab2; kind delete cluster --name helm-lab; docker rm -f lab-registry; rm -rf ~/helm`.

## Common mistakes

- **Using `template` and piping to `nindent`.** Why it bites: `template` is an action and does not return a string, so the pipe fails or the indentation is wrong. Fix: `include`.
- **A schema with `additionalProperties: false` on the whole values tree, including sub-chart keys.** Why it bites: the parent chart rejects the sub-chart's values. Fix: be strict about your own keys and leave dependency sections open.
- **Treating the schema as a replacement for `required` and `fail`.** Why it bites: a schema cannot express "A needs B". Fix: schema for types, `required` for one key, `fail` for rules between keys.
- **Open version ranges and no `Chart.lock`.** Why it bites: the next `update` pulls in a new, unreviewed dependency. Fix: tight ranges, commit the lock file and use `build` in CI.
- **Running `dependency update` in CI.** Why it bites: it re-resolves ranges, so a build is no longer reproducible. Fix: `dependency build` from the lock file.
- **Using `tpl` on arbitrary values.** Why it bites: values then run template code, a way to read data you did not intend to expose. Fix: limit it to documented fields.
- **Tests that only repeat unit checks, or never fail.** Why it bites: a green test with no value gives false confidence. Fix: make the test touch the real Service and prove it can fail (exercise 9).
- **Leaving test Pods behind.** Why it bites: the next `helm test` fails with "already exists". Fix: `before-hook-creation` in the delete policy.
- **Installing a chart without `--version`.** Why it bites: you get whatever is latest, so a rerun can deploy something different. Fix: always pin the version.
- **Overwriting a published version.** Why it bites: caches and releases disagree about what the version contains. Fix: a new version, and an immutable-tag setting in the registry.
- **Passing a registry password with `--password`.** Why it bites: it lands in history and process lists. Fix: `--password-stdin`.

## Check your understanding

1. Why can you write `include "x" . | nindent 4` but not `template "x" . | nindent 4`?
2. A teammate writes `replicacount: 3` in a values file. Which commands catch it, and what do you add to the chart so they do?
3. What is the difference between `helm dependency update` and `helm dependency build`, and which belongs in CI?
4. What do `condition` and `alias` do on a dependency?
5. Why does a chart test usually include a delete policy with `before-hook-creation`?
6. A colleague wants to fix a typo in `web 0.2.0` by pushing the corrected chart under the same version. What do you say, and what should the registry enforce?

> [!question]- Answers
>
> 1. `include` is a function that returns the rendered text as a string, so it can be piped to functions such as `nindent`. `template` is an action that writes straight to the output and returns nothing to pipe.
> 2. Without a schema nothing catches it. Add a `values.schema.json` with `additionalProperties: false`; then `helm lint`, `helm template`, `helm install` and `helm upgrade` all reject the unknown key.
> 3. `update` re-resolves the version ranges in `Chart.yaml`, downloads the charts and rewrites `Chart.lock`; `build` downloads exactly what `Chart.lock` lists and fails if it is stale. CI uses `build` for reproducible builds, and `update` is a deliberate change that is reviewed and committed.
> 4. `condition` names a value that turns the dependency on or off. `alias` lets you use the same chart under another name, and it changes the values key used for it.
> 5. Test Pods are named objects. If one from the last run still exists, creating it again fails. `before-hook-creation` deletes the old Pod before the new run starts, and `hook-succeeded` can also clean up after success.
> 6. Say no: a published version must be immutable. Release `0.2.1` instead. The registry should reject pushes to an existing tag (an immutability setting) so the rule is enforced rather than remembered.

## Next steps

Next lesson: [[learn/kubernetes-storage-volumes-pvcs-and-statefulsets|Kubernetes 09: Storage]], or return to [[learn/index|the learning path]]. Later, in [[learn/gitlab-ci-rules-dag-matrix-and-includes|Delivery 06: GitLab CI beyond the first pipeline]], a pipeline can lint, test and publish a chart like this one. Previous lesson: [[learn/rbac-roles-bindings-and-least-privilege|Kubernetes 07: RBAC and least privilege]].

To go deeper:

- [[patterns/helm-chart-conventions]] for team structure, naming and the Testing and Publishing rules.
- [[patterns/helm-chart-ci-quality-gates]] for the lint, schema, render and install checks in CI.
- [[runbooks/helm-release-rollback]] for the on-call procedure when a release fails.
- [[tools/helm-vs-kustomize]] for choosing between templates and patches.
- [[learn/artifactory-repositories-access-and-retention]] for hosting charts and mirroring dependencies.

## Sources

- Helm documentation, "Named Templates" (https://helm.sh/docs/chart_template_guide/named_templates/), for `define`, `template` and `include`.
- Helm documentation, "Charts" (https://helm.sh/docs/topics/charts/), for `Chart.yaml`, dependencies, `condition`, `tags`, `alias`, schema files and the lock file.
- Helm documentation, `helm dependency` (https://helm.sh/docs/helm/helm_dependency/), for `update`, `build` and `list`.
- Helm documentation, "Chart Tests" (https://helm.sh/docs/topics/chart_tests/), for the `helm.sh/hook: test` annotation and `helm test`.
- Helm documentation, "Use OCI-based registries" (https://helm.sh/docs/topics/registries/), for `helm registry login`, `helm push` and installing by version.
- JSON Schema (https://json-schema.org/), for the schema language and drafts.
- Not verified: all command output (illustrative), the Helm major version and flag differences on your machine (Helm 4 changes some flags, compare with its release notes), the `--plain-http` flag and its behaviour for `localhost`, the supported JSON Schema drafts, and the immutability settings of your registry. Check the current docs.
