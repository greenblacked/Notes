---
title: Terraform provider and module supply chain
description: "Verify what Terraform pins: origin-registry lock hashes, a mirror that cannot change them, read-only locks in CI and module sources pinned to commits."
type: pattern
tags:
  - patterns
  - terraform
  - supply-chain
  - security
  - ci-cd
created: 2026-11-24
modified: 2026-11-25
draft: false
---

Version constraints say which release you want. They do not prove the package you got is that release. [[terraform-module-versioning]] and [[terraform-module-and-state-layout]] cover pinning and multi-platform lock entries. This note covers the verification around them:

- where the hashes come from;
- what a mirror can and cannot vouch for;
- how CI refuses a changed lock;
- that modules are not in the lock file at all.

> [!info] Scope and verification
> Checked on 2026-11-24 against the Terraform dependency lock file, `providers lock`, CLI config and module sources documentation (see Sources). `-lockfile=readonly`, `TF_CLI_CONFIG_FILE` and the `modules.json` fields were not checked. OpenTofu ([[0031-terraform-or-opentofu]] is proposed) has its own registry and was not checked.

## What the lock file proves

- `h1:` is the preferred hash, computed over the package contents. `zh:` is the legacy registry-protocol hash.
- **Only an origin registry provides checksums covered by the developer's signature.** Entries created from a filesystem or network mirror cover only the platforms you asked for, and come from the mirror.
- `providers lock` "cannot automatically verify that the providers are trustworthy". Someone has to look at the signing key and the version.
- The lock file tracks only providers. Modules are selected fresh by version constraint every time.

## Generate locks from the origin, on purpose

- Generate or upgrade the lock in one place: a scheduled or manual job, or a reviewer's machine.
- That job talks to the origin registry, not the mirror, and covers every platform you run on.

```bash title="update-locks.sh"
#!/usr/bin/env bash
set -euo pipefail
# Run from a root module. The temporary CLI config installs directly from the origin registry, so hashes
# come from the origin. An empty file would not do: Terraform would still use implied local mirror
# directories such as ~/.terraform.d/plugins.
unset TF_PLUGIN_CACHE_DIR
umask 077
ORIGIN_CFG="$(mktemp)"; trap 'rm -f -- "$ORIGIN_CFG"' EXIT
printf 'provider_installation {\n  direct {}\n}\n' > "$ORIGIN_CFG"
export TF_CLI_CONFIG_FILE="$ORIGIN_CFG"
terraform init -backend=false -upgrade -input=false
terraform providers lock \
  -platform=linux_amd64 \
  -platform=linux_arm64 \
  -platform=darwin_amd64 \
  -platform=darwin_arm64
git diff --stat -- .terraform.lock.hcl
```

- Keep only the platforms you use. Every one you add is a hash someone reviews.
- The `direct {}` config is a design choice, not a tested guarantee: see Not verified.
- The MR that changes `.terraform.lock.hcl` and `ci.terraformrc` needs CODEOWNERS approval from the platform team. Reviewers check the provider source address, the version jump, and the release's signing key against the provider's published key. Renovate MRs ([[automated-dependency-updates]], [[renovate-vs-dependabot]]) go through the same rule.

## Serve providers from a mirror that cannot change them

- CI and engineers install from an internal mirror (an Artifactory Terraform remote repository, [[artifactory-repository-design]]), so builds do not depend on the public registry.
- Because the lock holds origin hashes, a mirror that serves a different package fails `init` with "doesn't match any of the checksums previously recorded".

```hcl title="ci.terraformrc"
provider_installation {
  network_mirror {
    url     = "https://terraform-mirror.example.com/providers/" # change: your mirror base URL; https and a trailing slash are required
    include = ["registry.terraform.io/*/*"]
  }
  direct {
    exclude = ["registry.terraform.io/*/*"]
  }
}
```

- The CI job sets `TF_CLI_CONFIG_FILE` to this file.
- The file sits in the project, so a merge request can change it together with `.terraform.lock.hcl`, and `terraform plan` then runs the resulting provider binaries with the plan job's credentials before any code owner has approved. CODEOWNERS gates the merge, not the pipeline. Put `ci.terraformrc` under the same CODEOWNERS rule, or supply it from a file-type CI/CD variable or the runner image so the branch cannot change it. The plan identity for merge request pipelines must be read-only ([[terraform-plan-policy-checks]]).
- If the mirror uses a private CA, trust it as in [[private-ca-and-egress-proxy-trust]].

> [!warning] Do not regenerate the lock through the mirror
> `providers lock -net-mirror=...` writes hashes that only the mirror vouches for. A compromised mirror would then be trusted by its own hashes. Generate locks from the origin (above), and let the mirror only serve.

Never set `plugin_cache_may_break_dependency_lock_file = true` in CI; the docs reserve it for unusual and exceptional situations.

## Refuse lock changes in CI

```yaml title=".gitlab-ci.yml (excerpt)"
terraform-plan:
  image:
    name: hashicorp/terraform:<tested-version>@sha256:<digest> # pin a tested tag by digest
    entrypoint: [""] # the image entrypoint is terraform; clear it so the runner can start a shell
  variables:
    TF_CLI_CONFIG_FILE: "$CI_PROJECT_DIR/ci.terraformrc"
  script:
    - terraform init -input=false -lockfile=readonly
    - git diff --exit-code -- .terraform.lock.hcl
    - terraform plan -input=false -out=plan.tfplan
```

- `-lockfile=readonly` fails if the lock would need to change.
- The `git diff` line is a backstop.
- Plan handling continues as in [[terraform-plan-policy-checks]] and [[0035-terraform-plan-policy-gate-and-ci-only-apply]].

## Pin module sources to what you reviewed

- The lock does not cover modules.
- Git tags can be moved, so pin Git modules to a full commit SHA. The docs show `?ref=<40-hex SHA>`, and note that a raw commit cannot be combined with `depth=1`.
- Pin registry modules with an exact version.
- [[0034-terraform-modules-versioned-by-git-tag]] versions modules by tag. To keep that readable, put the tag in a comment and the SHA in `ref`, and protect tags in the module repository.

```hcl title="main.tf"
module "network" {
  # v3.4.1
  source = "git::https://gitlab.example.com/platform/terraform-gcp-network.git?ref=51d462976d84fdea54b47d80dcabbf680badcdb8" # change: the reviewed commit
}

module "project_factory" {
  source  = "terraform-google-modules/project-factory/google"
  version = "= 17.0.0" # change: an exact, reviewed version; a range picks new code silently
}
```

CI check over the installed module manifest:

```bash title="check-module-pins.sh"
#!/usr/bin/env bash
set -euo pipefail
# Run after terraform init. Fails on Git module sources not pinned to a full commit SHA.
MANIFEST=".terraform/modules/modules.json"
SHA_RE='^[0-9a-f]{40}$'
[[ -f "$MANIFEST" ]] || { echo "run terraform init first: $MANIFEST is missing"; exit 1; }
# Read the manifest into a variable so a jq failure stops the script.
rows="$(jq -r '.Modules[] | select(.Key != "") | [.Key, .Source] | @tsv' "$MANIFEST")"
# Pinned means: a query with exactly one parameter named ref (after percent-decoding), a 40-hex value,
# and no other parameter whose decoded name contains "ref".
pinned() {
  local src="$1" query part name value refs=0 sha_ok=0
  local -a parts
  [[ "$src" == *\?* ]] || return 1
  query="${src#*\?}"; query="${query%%#*}"
  [[ -n "$query" ]] || return 1 # an empty array is an unbound variable under set -u on bash before 4.4
  IFS='&' read -r -a parts <<< "$query"
  for part in "${parts[@]}"; do
    name="${part%%=*}"; value=""; [[ "$part" == *=* ]] && value="${part#*=}"
    name="$(printf '%b' "${name//%/\\x}" | tr 'A-Z' 'a-z')"
    if [[ "$name" == "ref" ]]; then
      refs=$((refs + 1))
      [[ "$value" =~ $SHA_RE ]] && sha_ok=1
    elif [[ "$name" == *ref* ]]; then
      return 1
    fi
  done
  [[ "$refs" -eq 1 && "$sha_ok" -eq 1 ]]
}
fail=0
while IFS=$'\t' read -r key src; do
  [[ -n "$key" ]] || continue
  case "$src" in
    git::*|*.git*|github.com/*|bitbucket.org/*|hg::*)
      if ! pinned "$src"; then
        echo "module '$key' is not pinned to a commit SHA: $src"
        fail=1
      fi
      ;;
  esac
done <<< "$rows"
exit "$fail"
```

HTTP archive sources and other source types are not covered by this check; review them by hand.

Registry pins are checked in review. The manifest records the resolved version, not the constraint.

## Verify it works

1. In a branch, replace every `h1:` and `zh:` line of one provider with wrong values. CI `init` must fail with the checksum error. Changing a single `h1:` line is not a valid test: Terraform accepts a package that matches at least one recorded checksum, and a `zh:` hash of the official package still matches.
2. Change a module `ref` to a tag. `check-module-pins.sh` must fail.
3. Remove the lock file in a branch. `-lockfile=readonly` must fail.

## Troubleshooting

| Symptom                                                 | Cause and fix                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checksum mismatch on one platform only                  | That platform was not in `providers lock`. Add it in `update-locks.sh`. Do not run `init -upgrade` in CI.                                                             |
| Checksum mismatch for a version that was fine yesterday | The mirror is serving a different package. Stop and treat it as a supply-chain incident ([[compromised-ci-runner-or-pipeline-identity]]). Do not regenerate the lock. |
| `init` cannot find a provider                           | The mirror `include` does not cover its namespace, or the trailing slash is missing in `url`.                                                                         |
| `check-module-pins.sh` flags a local module             | Local paths do not match `git::`. Check the `case` patterns against your `modules.json`.                                                                              |

## Rollback

- Reverting the lock-file MR restores the previous versions and hashes.
- Removing the mirror means deleting the CLI config. Builds then use the origin registry directly.

## Not verified

- `terraform init -lockfile=readonly`.
- The "Verify it works" tests were not run, and `check-module-pins.sh` was not run against a real `modules.json`.
- `TF_CLI_CONFIG_FILE`, and that a `provider_installation { direct {} }` config with `TF_PLUGIN_CACHE_DIR` unset makes `providers lock` use only the origin registry.
- Whether `modules.json` keeps the module source query as written (the pin check relies on it).
- The `.terraform/modules/modules.json` structure (`Modules`, `Key`, `Source`).
- Artifactory's Terraform mirror URL layout.
- OpenTofu behaviour.
- The `= 17.0.0` example version is illustrative and was not checked as an existing release.

## Related

- [[terraform-module-versioning]]
- [[terraform-module-and-state-layout]]
- [[terraform-vs-opentofu]]
- [[opentofu-migration-notes]]
- [[software-supply-chain-end-to-end]]

## Sources

- [Terraform dependency lock file](https://developer.hashicorp.com/terraform/language/v1.14.x/files/dependency-lock): `zh:` and `h1:` hashes, mirror limits, the mismatch error, `init -upgrade`, providers only. Read 2026-11-24.
- [terraform providers lock](https://developer.hashicorp.com/terraform/cli/commands/providers/lock): `-platform`, `-fs-mirror`, `-net-mirror`, origin-only signed checksums, the trust caveat. Read 2026-11-24.
- [Terraform CLI configuration file](https://developer.hashicorp.com/terraform/cli/config/config-file): `provider_installation`, `network_mirror` URL rules, `plugin_cache_may_break_dependency_lock_file`. Read 2026-11-24.
- [Terraform module sources](https://developer.hashicorp.com/terraform/language/v1.10.x/modules/sources): `ref` with a SHA, the `depth=1` restriction, registry versioning. Read 2026-11-24.
