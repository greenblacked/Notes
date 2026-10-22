---
title: Validating AI-generated Terraform, Helm, Kubernetes and PromQL before review
description: A deterministic ladder of offline and live checks that catches invented arguments, removed APIs, wrong value paths and queries that match nothing.
type: guide
tags:
  - ai
  - terraform
  - helm
  - policy-as-code
  - ci-cd
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Generated infrastructure code fails in a recognisable way: it looks right. The resource has a plausible argument that the provider never had, the manifest uses an API version that was removed several releases ago, the Helm value sits one level off from where the chart reads it, and the alert query parses, passes its unit test and matches no series in production. A reviewer reading the diff sees idiomatic code and approves it. This guide gives a fixed ladder of deterministic checks that runs before a human looks at the change, so review time goes on intent and risk instead of on spotting hallucinated syntax. Who owns and reviews AI-written code is set in [[ai-generated-code-policy-and-provenance]]; this note is the machine part.

> [!info] Scope
> Terraform with the Google provider, Kubernetes manifests, Helm charts, Prometheus rules and shell scripts in GitLab CI. The ladder is the same whoever wrote the code; it matters more for generated code because the failures are plausible. No tool versions are named: pin the versions your platform supports and check each tool's `--help` against what is shown here.

> [!note] Not verified
> Command behaviour was checked at page level, on 2026-10-21, against the Terraform, TFLint, kubeconform, Kubernetes, Helm and Prometheus documentation through search summaries, not a full read. Not checked: the exact error text each tool prints (the outputs below are illustrative), that `terraform validate` rejects every invented argument name, the descriptions of kubeconform's `-strict` and `-ignore-missing-schemas` (check `kubeconform -h`), and the CI template, which was not run in a pipeline.

## Typical failures in generated config

| Failure                                  | Example                                                                              | First rung that catches it                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Invented resource argument               | `versioning_enabled = true` on a bucket, where the provider has a `versioning` block | `terraform validate`; schema lookup to fix it    |
| Valid type, invalid value                | A region or machine type string the provider rejects at apply time                   | `tflint` with the provider ruleset, then `plan`  |
| Removed Kubernetes API version           | An Ingress on an API group and version that no longer exist in the target release    | `kubeconform` with the target version            |
| Misspelled or misplaced manifest field   | `resources.limit.cpu` instead of `resources.limits.cpu`                              | `kubeconform -strict`                            |
| Wrong Helm value path                    | A value set where no template reads it, so the default silently wins                 | Rendered-output assertions; `values.schema.json` |
| Admission or policy rejection            | A Pod that violates the namespace's Pod Security level                               | `kubectl apply --dry-run=server`; `conftest`     |
| PromQL that parses but matches nothing   | A label name that the real metric does not have                                      | Live series query only                           |
| Shell that works on the author's machine | Unquoted variables, `set -e` missing, a GNU-only flag                                | `bash -n`, `shellcheck`                          |

The last column is the point: every class has a cheap deterministic check, and only one (the query that matches nothing) needs a live system.

## Principles of the ladder

- **Cheap and offline first.** Formatting and syntax run in seconds with no credentials. Run them in pre-commit and as the first CI rung, so a generated change fails fast.
- **Offline before credentialed.** `plan` and server-side dry runs need credentials and a target; they come after everything that does not.
- **Nothing is applied.** No rung changes infrastructure. Plans run with read-only credentials; dry runs use `--dry-run=server`.
- **Target versions are explicit.** Kubernetes schemas, Helm `--kube-version` and provider versions match what you run, plus the next upgrade target.
- **Fail on warnings for generated code.** `helm lint --strict`, `kubeconform -strict`, `terraform fmt -check`. Leniency is how plausible mistakes get through.
- **Feed the failures back.** When a generator (or an agent) produced the change, the ladder output is the best correction prompt you have. Give it the error and the schema, not a description of the problem.

## Terraform

### 1. Format, initialise without a backend, validate

```bash title="terraform-offline.sh"
set -euo pipefail

TF_DIR="infra/storage"  # change: the root module under test

terraform -chdir="$TF_DIR" fmt -check -recursive -diff
terraform -chdir="$TF_DIR" init -backend=false -input=false
terraform -chdir="$TF_DIR" validate -no-color
```

`terraform validate` checks syntax and internal consistency without reading variables or state, and it does not contact remote services such as the state backend or provider APIs. It needs an initialised directory, which is why the documentation suggests `init -backend=false` for CI and pre-commit. `terraform plan` repeats the validation, so validate is the cheap early copy of a check you get anyway.

Know what it does not catch: it checks that a value has the right type, not that the provider will accept it. A region that does not exist, or a machine type unavailable in a zone, passes validate.

### 2. Look things up in the provider schema

When validate reports an unknown argument, do not guess the fix (and do not let the generator guess again). Read the schema of the exact provider version the configuration locks:

```bash title="schema-lookup.sh"
set -euo pipefail

TF_DIR="infra/storage"                                # change: the initialised root module
PROVIDER="registry.terraform.io/hashicorp/google"     # change: the provider source address
RESOURCE="google_storage_bucket"                      # change: the resource type in question

terraform -chdir="$TF_DIR" providers schema -json > /tmp/schema.json
jq -r '.format_version' /tmp/schema.json

# Top-level arguments and attributes of the resource
jq -r --arg p "$PROVIDER" --arg r "$RESOURCE" \
  '.provider_schemas[$p].resource_schemas[$r].block.attributes | keys[]' /tmp/schema.json

# Nested blocks (for example versioning, lifecycle_rule)
jq -r --arg p "$PROVIDER" --arg r "$RESOURCE" \
  '.provider_schemas[$p].resource_schemas[$r].block.block_types | keys[]' /tmp/schema.json
```

`terraform providers schema -json` prints the schemas of the providers used in the current configuration, for resources and data sources; `-json` is required. The output starts with a `format_version`; a script that reads it should refuse an unsupported major version. The jq paths assume the structure shown in the documentation; check them against your output.

The same JSON is a good grounding document for a generator: give it the schema of the resources it is about to write instead of letting it rely on memory.

### 3. TFLint with the provider ruleset

```hcl title=".tflint.hcl"
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "google" {
  enabled = true
  version = "0.0.0" # change: not a real release; tflint fails until you set the exact version you pin from the tflint-ruleset-google releases page
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}
```

```bash
tflint --init
tflint --chdir="$TF_DIR" --format=compact
```

`tflint --init` installs the plugins declared in `.tflint.hcl`. The bundled `terraform` ruleset covers language-level issues; the Google ruleset adds provider checks, such as invalid machine types, that validate cannot see. Check the `preset` name and the `--chdir` flag against `tflint --help` for your version. Mirror the plugin release into Artifactory rather than downloading it from GitHub in every job.

### 4. Plan with read-only credentials, then policy

A plan is the first rung that talks to the provider, so it catches values the provider rejects and shows what would really change. Run it with a read-only identity, never the apply identity, save it as JSON and run the policy checks from [[terraform-plan-policy-checks]] over `resource_changes`. For generated changes, add one rule that is easy to forget: the plan must not contain deletes or replacements the merge request did not declare. An LLM summary of the plan can help a reviewer ([[llm-assisted-terraform-plan-review]]), but only after these gates pass.

### 5. terraform test

For modules, add tests that pin behaviour, with `command = plan` so they create nothing and `mock_provider` so they need no credentials:

```hcl title="tests/bucket.tftest.hcl"
mock_provider "google" {}

variables {
  name     = "example-logs"
  location = "EU"
}

run "versioning_is_on" {
  command = plan

  assert {
    condition     = google_storage_bucket.this.versioning[0].enabled == true
    error_message = "Bucket versioning must be enabled."
  }
}
```

`run` blocks default to apply, so `command = plan` matters. The command searches the root directory and `tests/` for `.tftest.hcl` files. Patterns for larger suites are in [[terraform-testing]]. Generated modules should come with generated tests, and a human should read the assertions: a test that asserts what the code does, rather than what it should do, proves nothing.

## Kubernetes manifests

### 1. Schema validation for the target version

```bash title="k8s-offline.sh"
set -euo pipefail

MANIFESTS="deploy/k8s"      # change: the directory of rendered or plain manifests
: "${K8S_VERSION:?set K8S_VERSION to the Kubernetes version of your clusters, and run again for the next upgrade target}"
SCHEMAS_MIRROR="https://artifactory.example.com/artifactory/k8s-schemas"  # change: your mirror, or remove

kubeconform -strict -summary \
  -kubernetes-version "$K8S_VERSION" \
  -schema-location default \
  -schema-location "$SCHEMAS_MIRROR/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json" \
  "$MANIFESTS"
```

kubeconform validates against JSON schemas generated from the Kubernetes OpenAPI specifications. Without `-kubernetes-version` it uses the schemas for the development branch, which is not what you run. `-strict` makes unknown fields an error, which is what catches `limit` instead of `limits`. CRDs need their own schema locations: the commonly used CRD catalogue is a third-party project, so mirror the schemas you need, as described in [[helm-chart-ci-quality-gates]]. Do not add `-ignore-missing-schemas` to make a job pass: a missing schema is often exactly the removed API you are looking for.

A manifest on a removed API version fails here with a missing-schema error. To find the replacement, read the Kubernetes Deprecated API Migration Guide for your target release; it lists each removed API and its successor. Do not take the replacement from the generator.

### 2. Server-side dry run

```bash
kubectl --context=ci-staging apply --dry-run=server -f deploy/k8s/
```

With `--dry-run=server` the request goes to the API server and through validation and admission (including Pod Security admission and validating webhooks), but nothing is persisted. `--dry-run=client` does not contact the server and catches far less. Run this against a non-production cluster on the target version, with an identity that has only the permissions a dry run needs. It is the rung that catches a Pod the namespace's Pod Security level would reject ([[pod-security-admission]]).

Admission webhooks matter here: a server-side dry run is rejected when a matching webhook does not declare that it has no side effects on dry runs (`sideEffects: None` or `NoneOnDryRun`). If a dry run fails for that reason, check the webhook's configuration against the Kubernetes dynamic admission control documentation rather than skipping the rung.

### 3. Policy

Run the organisation's Rego policies with conftest over the same manifests ([[conftest-policy-gate-for-manifests]]): required labels, no `latest` tags, resource limits, no host namespaces. Generated manifests tend to copy examples from the internet, which rarely meet internal policy.

## Helm charts

```bash title="helm-checks.sh"
set -euo pipefail

CHART="charts/app"            # change: the chart directory
VALUES="charts/app/ci/prod-values.yaml"  # change: each values file you deploy with
: "${K8S_VERSION:?set K8S_VERSION to the target Kubernetes version}"

helm lint --strict "$CHART" -f "$VALUES" --kube-version "$K8S_VERSION"
helm template ci-release "$CHART" -f "$VALUES" --kube-version "$K8S_VERSION" > /tmp/rendered.yaml
kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" /tmp/rendered.yaml
```

- `helm lint` reports `[ERROR]` for problems that would make an install fail and `[WARNING]` for convention breaches; `--strict` turns warnings into failures.
- Rendering and running the output through the Kubernetes rungs is what catches most generated-chart mistakes. A misplaced key in a block passed through `toYaml` becomes an unknown field in the rendered manifest, and `-strict` rejects it.
- A value at the wrong path (`image.tags` where the template reads `image.tag`) renders cleanly with the default. Only two things catch it: a `values.schema.json` that rejects unknown keys, and assertions on the rendered output (unit tests or a simple `grep` for the expected value). Charts you own should have both; the patterns are in [[helm-chart-ci-quality-gates]].
- Chart tests (`helm test`) run in an ephemeral cluster after install; they are the last rung, not a replacement for the earlier ones.

## Prometheus rules and PromQL

```bash title="prom-offline.sh"
set -euo pipefail

promtool check rules alerts/checkout.rules.yml
promtool test rules alerts/tests/checkout.test.yml
```

`promtool check rules` checks the rule file's syntax without a server. `promtool test rules` runs unit tests in which you define input series and the alerts or expression values you expect; an empty `exp_alerts` asserts that the alert does not fire. Both are necessary. Neither is sufficient, because unit tests supply their own synthetic series: a rule that uses a metric or label that does not exist in production passes both, as long as the test was written with the same wrong names. Generated rules and generated tests usually make the same mistake together.

The rung that closes the gap is a live query against the Prometheus that will evaluate the rule. PromQL writing practice is in [[promql-for-alert-rules-and-recording-rules]].

```bash title="prom-live-check.sh (illustrative, not run)"
set -euo pipefail

PROM_URL="https://prometheus.example.com"  # change: the Prometheus or query frontend that evaluates these rules
RULES="alerts/checkout.rules.yml"

[ -r "$RULES" ] || { echo "cannot read ${RULES}" >&2; exit 1; }

# Heuristic: pull out selectors written as metric{...}; bare metric names are not found.
selectors="$(grep -oE '[a-zA-Z_:][a-zA-Z0-9_:]*\{[^{}]*\}' "$RULES" | sort -u)" \
  || { echo "no selectors found in ${RULES}" >&2; exit 1; }  # grep exits 1 on no match, 2 on a read error
[ -n "$selectors" ] || { echo "no selectors found in ${RULES}" >&2; exit 1; }

missing=0
while IFS= read -r sel; do
  n="$(curl -sS --fail -G "$PROM_URL/api/v1/query" \
        --data-urlencode "query=count(${sel})" | jq '.data.result | length')"
  if [ "$n" -eq 0 ]; then
    echo "NO SERIES: ${sel}"
    missing=$((missing + 1))
  else
    echo "ok:        ${sel}"
  fi
done <<< "$selectors"

echo "selectors with no series: ${missing}"
[ "$missing" -eq 0 ]
```

The regex is a heuristic, not a PromQL parser: it misses selectors without braces and can pick up text that only looks like a selector. A selector with a regex matcher that legitimately has no series right now (no 5xx errors at the moment) also reports `NO SERIES`, so check the label names in that case rather than failing blindly. Use the Prometheus HTTP API (`/api/v1/query`, and `/api/v1/series` or `/api/v1/labels` to see which labels a metric really has); read the API page for the parameters before automating it. Add authentication the way your Prometheus requires, with a read-only token from a CI variable.

## Shell scripts

```bash
bash -n scripts/*.sh
shellcheck --severity=style scripts/*.sh
```

`bash -n` parses without running. ShellCheck catches unquoted expansions, unchecked `cd`, and the rest of the mistakes listed in [[safe-bash-scripts]]. Generated scripts often omit `set -euo pipefail` or add it and then rely on behaviour it changes; read them with that in mind.

## One CI job for the whole ladder

A single template job, included by every infrastructure repository, runs every rung that applies to the files present. It uses one toolbox image that the platform team builds with pinned versions of every tool, so each repository does not choose its own.

```bash title="ci/validate-ladder.sh (illustrative, not run in a pipeline)"
#!/usr/bin/env bash
set -uo pipefail

K8S_VERSION="${K8S_VERSION:?set K8S_VERSION to the target Kubernetes version}"
failures=()

rung() {
  local name="$1"; shift
  echo "::: ${name}"
  if "$@"; then echo "PASS ${name}"; else echo "FAIL ${name}"; failures+=("$name"); fi
}

# Terraform: every directory with a .terraform.lock.hcl is treated as a root module.
while IFS= read -r lock; do
  dir="$(dirname "$lock")"
  rung "terraform fmt ${dir}"      terraform -chdir="$dir" fmt -check -recursive
  rung "terraform init ${dir}"     terraform -chdir="$dir" init -backend=false -input=false
  rung "terraform validate ${dir}" terraform -chdir="$dir" validate -no-color
  rung "tflint ${dir}"             tflint --chdir="$dir"
done < <(find . -name .terraform.lock.hcl -not -path '*/.terraform/*')

# Kubernetes manifests
if [ -d deploy/k8s ]; then
  rung "kubeconform deploy/k8s" kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" deploy/k8s
fi

# Helm charts: lint and render with each values file under ci/
for chart in charts/*/; do
  [ -f "${chart}Chart.yaml" ] || continue
  for values in "${chart}"ci/*-values.yaml; do
    [ -f "$values" ] || continue
    rung "helm lint ${values}" helm lint --strict "$chart" -f "$values" --kube-version "$K8S_VERSION"
    rung "helm render ${values}" bash -c \
      'set -o pipefail; helm template ci "$1" -f "$2" --kube-version "$3" | kubeconform -strict -summary -kubernetes-version "$3" -' \
      _ "$chart" "$values" "$K8S_VERSION"
  done
done

# Prometheus rules and their unit tests
for rules in alerts/*.rules.yml; do
  [ -f "$rules" ] && rung "promtool check ${rules}" promtool check rules "$rules"
done
for t in alerts/tests/*.test.yml; do
  [ -f "$t" ] && rung "promtool test ${t}" promtool test rules "$t"
done

# Shell
mapfile -t scripts < <(git ls-files '*.sh')
if [ "${#scripts[@]}" -gt 0 ]; then
  rung "bash -n" bash -c 'for f in "$@"; do bash -n "$f" || exit 1; done' _ "${scripts[@]}"
  rung "shellcheck" shellcheck "${scripts[@]}"
fi

echo "failed rungs: ${#failures[@]}"
for f in "${failures[@]}"; do echo " - $f"; done
[ "${#failures[@]}" -eq 0 ]
```

```yaml title="ci/validate-ladder.gitlab-ci.yml (illustrative, not run in a pipeline)"
validate-ladder:
  stage: test
  image: registry.example.com/platform/iac-toolbox@sha256:0000000000000000000000000000000000000000000000000000000000000000 # change: your toolbox image digest
  variables:
    K8S_VERSION: "" # change: set to the target Kubernetes version; the ladder script fails while it is empty
  script:
    - bash ci/validate-ladder.sh
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

The credentialed rungs (plan with policy checks, server-side dry run, live PromQL check) are separate jobs that run after this one passes, each with its own narrow read-only identity, so the offline job never holds credentials. A failing rung prints its tool output; keep that output in the merge request, because it is what the author (or the generator) needs to fix the change.

## What still needs a human

The ladder proves that the change is well-formed and that it refers to things that exist. It does not prove that the change is right. A reviewer still owns:

- **Intent.** Does the change do what the merge request says, and only that? Generated changes often include unrequested edits.
- **Blast radius.** Deletes, replacements, IAM grants, firewall openings and anything public.
- **Thresholds and semantics.** An alert at the wrong threshold, a `for` that is too short, a timeout that is too long. The tools accept any number.
- **Security posture.** Overly broad roles, disabled checks, `allow all` policies written to make a test pass.
- **Operability.** Whether on-call can understand and roll back the change at 3 a.m.

The review rules for AI-written code are in [[ai-generated-code-policy-and-provenance]].

## Worked example: an alert that matches nothing

A generated merge request adds an error-rate alert for a checkout service, with a unit test. The real HTTP metric uses the label `code` for the status code; the generator wrote `status`.

```yaml title="alerts/checkout.rules.yml"
groups:
  - name: checkout
    rules:
      - alert: CheckoutHighErrorRate
        expr: |
          sum(rate(http_requests_total{service="checkout", status=~"5.."}[5m]))
            / sum(rate(http_requests_total{service="checkout"}[5m])) > 0.05
        for: 10m
        labels:
          severity: page
        annotations:
          summary: Checkout 5xx ratio is above 5 percent
```

```yaml title="alerts/tests/checkout.test.yml"
rule_files:
  - ../checkout.rules.yml
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
      - series: 'http_requests_total{service="checkout", status="500"}'
        values: "0+10x30"
      - series: 'http_requests_total{service="checkout", status="200"}'
        values: "0+90x30"
    alert_rule_tests:
      - eval_time: 25m
        alertname: CheckoutHighErrorRate
        exp_alerts:
          - exp_labels:
              severity: page
            exp_annotations:
              summary: Checkout 5xx ratio is above 5 percent
```

The offline rungs pass, because the test uses the same wrong label (output illustrative, not run):

```text
$ promtool check rules alerts/checkout.rules.yml
Checking alerts/checkout.rules.yml
  SUCCESS: 1 rules found

$ promtool test rules alerts/tests/checkout.test.yml
Unit Testing:  alerts/tests/checkout.test.yml
  SUCCESS
```

The live rung fails, and a label query shows why:

```bash
PROM_URL="https://prometheus.example.com"
curl -sS -G "$PROM_URL/api/v1/query" \
  --data-urlencode 'query=count(http_requests_total{service="checkout", status=~"5.."})' | jq '.data.result'
curl -sS -G "$PROM_URL/api/v1/labels" \
  --data-urlencode 'match[]=http_requests_total{service="checkout"}' | jq -c '.data'
```

```text
[]
["__name__","code","instance","job","method","service"]
```

In production this alert would never fire: the numerator matches no series, so the division returns nothing, and an empty result does not alert. That is the most dangerous kind of broken alert, because it looks healthy. The fix is `code=~"5.."` in the rule **and** in the test, and the live check then returns a non-empty result. Add one more unit test with no 5xx series at all and an empty `exp_alerts`, so the "no errors" case is covered too.

## Failure modes of the ladder itself

- **Wrong target version.** kubeconform runs against the default development schemas, or Helm renders without `--kube-version`. Pin both to the clusters you run.
- **Skipped schemas.** `-ignore-missing-schemas` added to get a green job hides removed APIs and every CRD mistake.
- **Tests that mirror the code.** Generated tests assert whatever the generated code does. Review test assertions as carefully as the code.
- **Credentials in the offline job.** The cheap rungs need none; keep it that way so an untrusted change cannot use them.
- **Tool drift.** Each repository pins its own linter versions and they disagree. One toolbox image, updated through [[dependency-update-policy]].

## Rollback

The ladder changes nothing in infrastructure, so there is nothing to roll back there. If adding the template job blocks merges unexpectedly, revert the `include` in the affected repository, fix the rung, and re-enable it; do not weaken a rung (dropping `-strict`, adding `-ignore-missing-schemas`) to unblock a merge. If a change that passed the ladder still caused a problem, add the missing check as a rung so the same class cannot pass again.

## Sources

- [terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate), Terraform CLI documentation.
- [terraform providers schema](https://developer.hashicorp.com/terraform/cli/commands/providers/schema), Terraform CLI documentation.
- [Tests](https://developer.hashicorp.com/terraform/language/tests) and [mocks](https://developer.hashicorp.com/terraform/language/tests/mocking), Terraform language documentation.
- [TFLint](https://github.com/terraform-linters/tflint) and its [plugin guide](https://github.com/terraform-linters/tflint/blob/master/docs/user-guide/plugins.md); [tflint-ruleset-google](https://github.com/terraform-linters/tflint-ruleset-google).
- [kubeconform](https://github.com/yannh/kubeconform), project README.
- [Deprecated API migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/), Kubernetes documentation.
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/), Kubernetes documentation: `--dry-run`.
- [helm lint](https://helm.sh/docs/helm/helm_lint/), Helm documentation.
- [promtool](https://prometheus.io/docs/prometheus/latest/command-line/promtool/) and [unit testing for rules](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/), Prometheus documentation.
- [HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/), Prometheus documentation.
- [ShellCheck](https://www.shellcheck.net/).

## Related

- [[ai-generated-code-policy-and-provenance]]: ownership and review of AI-written code.
- [[terraform-testing]]: static checks and `terraform test` in depth.
- [[terraform-plan-policy-checks]]: the plan JSON and Rego rung.
- [[llm-assisted-terraform-plan-review]]: an advisory summary after the gates pass.
- [[conftest-policy-gate-for-manifests]]: policy for manifests.
- [[helm-chart-ci-quality-gates]]: chart unit tests, schemas and chart-testing.
- [[pod-security-admission]]: what the server-side dry run enforces.
- [[securing-ai-agents-in-ci-and-cloud]]: keeping credentials away from jobs that handle generated changes.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
