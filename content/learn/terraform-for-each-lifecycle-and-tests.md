---
title: "Delivery 10: Terraform for_each, count, dynamic blocks, lifecycle rules and a first terraform test"
description: Create many resources safely with for_each instead of count, use dynamic blocks and lifecycle rules with care, and test a module with terraform test.
type: guide
tags:
  - learning
  - terraform
  - gcp
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

> [!info] Level: middle | Time: about 4 h | You need: [[learn/terraform-state-modules-and-pipelines|Delivery 05: Terraform state, modules and pipelines]] | Lab: Lab C, the GCP sandbox project from [[learn/lab-setup|Start 01: Set up your lab]]. Most steps need only `plan`; apply steps carry a cost callout and a `terraform destroy`.

Delivery 05 gave you remote state, modules and a pipeline. The next problem arrives the first time someone asks for "the same bucket, but for five teams". You reach for `count`, it works, and three months later removing the second team destroys and recreates the third and fourth buckets. This lesson explains **why that happens**, how `for_each` avoids it, how to move an existing resource from one to the other without destroying anything, when `dynamic` blocks help and when they hurt, what each `lifecycle` setting really protects, and how to write a first test with `terraform test`.

> [!note] Nothing here was run for this page
> There was no Terraform binary or GCP project where this page was written. The code and output follow the documentation and are **not verified**. Plan output is illustrative. The minimum Terraform versions for `terraform test`, mock providers and `removed` blocks, and the HashiCorp documentation paths, must be checked against the version you pin (check the current docs). Delivery 05 covers module inputs and outputs, `import` and the state lock; they are not repeated here.

## What you will learn

- How `count` and `for_each` address resources in state, and why removing a middle item from a `count` list shifts everything after it.
- How to use `for_each` over a map or a set, and what "keys must be known at plan time" means.
- How to move from `count` to `for_each` with `moved` blocks and no destroy.
- When a `dynamic` block removes repetition and when it makes code unreadable.
- What `prevent_destroy`, `create_before_destroy`, `ignore_changes`, `replace_triggered_by`, preconditions and `plan -replace` do and do not do.
- How to write a first `.tftest.hcl` file with `run` blocks and `assert`.

## count and its index problem

`count` creates N copies of a resource, addressed by position:

```hcl title="main.tf (count version)"
variable "team_buckets" {
  type    = list(string)
  default = ["alpha", "beta", "gamma", "delta"]
}

resource "google_storage_bucket" "team" {
  count    = length(var.team_buckets)
  name     = "example-lab-${var.team_buckets[count.index]}-0001" # Change: bucket names are global; use your own unique prefix
  location = "EU"
  project  = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}
```

State addresses are `google_storage_bucket.team[0]`, `[1]`, `[2]` and `[3]`: alpha, beta, gamma and delta. Now remove `"beta"` from the list. The list is now `["alpha", "gamma", "delta"]`, and the addresses are re-assigned by position:

| Address | Before | After  | What Terraform plans                                    |
| ------- | ------ | ------ | ------------------------------------------------------- |
| `[0]`   | alpha  | alpha  | nothing                                                 |
| `[1]`   | beta   | gamma  | change the name: destroy and create (name is immutable) |
| `[2]`   | gamma  | delta  | destroy and create                                      |
| `[3]`   | delta  | (none) | destroy                                                 |

```text
# google_storage_bucket.team[1] must be replaced
-/+ resource "google_storage_bucket" "team" {
      ~ name = "example-lab-beta-0001" -> "example-lab-gamma-0001" # forces replacement
...
Plan: 2 to add, 0 to change, 3 to destroy.
```

_Illustrative._

Removing one item destroys **three** buckets (and the data in them if they are not empty and `force_destroy` is set, or fails if they are not empty). That is the defining defect of `count` on a list of things with identity: **index is not identity.**

Use `count` for what it is good at: **zero or one** of something, as a switch.

```hcl title="main.tf (count as a switch)"
resource "google_storage_bucket" "optional_logs" {
  count    = var.enable_log_bucket ? 1 : 0
  name     = "example-lab-logs-0001" # Change: a globally unique name
  location = "EU"
  project  = var.project_id
}
```

## for_each over a map or a set

`for_each` addresses instances by a **key** you choose, so identity stays with the item:

```hcl title="main.tf (for_each version)"
variable "team_buckets" {
  type = map(object({
    location      = string
    storage_class = string
  }))
  default = {
    alpha = { location = "EU", storage_class = "STANDARD" }
    beta  = { location = "EU", storage_class = "NEARLINE" }
    gamma = { location = "EU", storage_class = "STANDARD" }
    delta = { location = "EU", storage_class = "STANDARD" }
  }
}

resource "google_storage_bucket" "team" {
  for_each = var.team_buckets

  name          = "example-lab-${each.key}-0001" # Change: your unique prefix; bucket names are global
  location      = each.value.location
  storage_class = each.value.storage_class
  project       = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}
```

Addresses are `google_storage_bucket.team["alpha"]`, `["beta"]`, and so on. Remove `beta` and the plan is exactly one destroy of `team["beta"]`; the others are untouched. Inside the block, `each.key` is the map key and `each.value` is the object.

`for_each` takes a **map** or a **set of strings** (not a list). Convert a list with `toset()`:

```hcl title="main.tf (for_each over a set)"
resource "google_storage_bucket" "team" {
  for_each = toset(["alpha", "beta", "gamma"])
  name     = "example-lab-${each.key}-0001" # Change: your unique prefix
  location = "EU"
  project  = var.project_id
}
```

A set has no order, so there is no `count.index`-style shifting; `each.key` and `each.value` are the same string.

### Keys must be known at plan time

Terraform decides how many instances exist **during plan**, before it creates anything. The _keys_ of `for_each` therefore must be known at plan time: they cannot depend on an attribute that only exists after apply, such as the ID of a resource created in the same run.

```hcl title="main.tf (this fails)"
resource "google_service_account" "app" {
  account_id = "example-app"
  project    = var.project_id
}

resource "google_storage_bucket_iam_member" "writers" {
  # Error: the "for_each" set includes values derived from resource attributes
  # that cannot be determined until apply
  for_each = toset([google_service_account.app.email])
  bucket   = google_storage_bucket.team["alpha"].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${each.key}"
}
```

The fix is to make the **key** something you know (a name you chose), and let the **value** be the unknown thing:

```hcl title="main.tf (this works)"
locals {
  writers = {
    app = google_service_account.app.email   # key "app" is known; the value is only known after apply
  }
}

resource "google_storage_bucket_iam_member" "writers" {
  for_each = local.writers
  bucket   = google_storage_bucket.team["alpha"].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${each.value}"
}
```

Keys that come from data (a variable, a local, a file) are fine. Keys that come from `apply`-time values are not. The same rule applies to the **number** in `count`.

Also remember that a map key becomes part of an address and often part of a name, so choose stable, boring keys (`alpha`, not `Alpha Team (new)`). Renaming a key is a destroy and create, the same as the index shift with `count`, unless you move the state (next section).

## Moving from count to for_each

You already have the `count` version applied, and want `for_each` **without destroying** buckets. The tool is the `moved` block, which tells Terraform that an address in state now has a different address in code. The plan shows a move, not a replacement.

```hcl title="moves.tf"
moved {
  from = google_storage_bucket.team[0]
  to   = google_storage_bucket.team["alpha"]
}
moved {
  from = google_storage_bucket.team[1]
  to   = google_storage_bucket.team["beta"]
}
moved {
  from = google_storage_bucket.team[2]
  to   = google_storage_bucket.team["gamma"]
}
moved {
  from = google_storage_bucket.team[3]
  to   = google_storage_bucket.team["delta"]
}
```

Steps:

1. Change the resource to `for_each` and keep the same name arguments, so the real bucket names do not change. If the new code computes different names, Terraform will plan a replacement, so compare names first.
2. Add the `moved` blocks.
3. Run `terraform plan` and read it. The expected shape is `team[0] has moved to team["alpha"]` and `Plan: 0 to add, 0 to change, 0 to destroy`.
4. Apply, commit the `moved` blocks, and keep them for at least one release so everyone's state (other workspaces, other environments) can follow, then remove them in a later change.

```text
# google_storage_bucket.team[0] has moved to google_storage_bucket.team["alpha"]
    resource "google_storage_bucket" "team" {
        name = "example-lab-alpha-0001"
        # (12 unchanged attributes hidden)
    }
Plan: 0 to add, 0 to change, 0 to destroy.
```

_Illustrative._

`moved` blocks are declarative and reviewable, which is why they are preferred to `terraform state mv` (Delivery 05 covers that). The `removed` block (for forgetting a resource without destroying it) needs a Terraform version that supports it: check the minimum version in the documentation before you pin it.

## dynamic blocks

Some resources have repeating nested blocks, for example `lifecycle_rule` in a bucket. A `dynamic` block generates them from a collection:

```hcl title="main.tf (dynamic lifecycle_rule)"
variable "lifecycle_rules" {
  type = list(object({
    age_days = number
    action   = string          # "Delete" or "SetStorageClass"
    storage_class = optional(string)
  }))
  default = [
    { age_days = 30, action = "SetStorageClass", storage_class = "NEARLINE" },
    { age_days = 365, action = "Delete" },
  ]
}

resource "google_storage_bucket" "logs" {
  name     = "example-lab-logs-0001" # Change: a globally unique name
  location = "EU"
  project  = var.project_id

  dynamic "lifecycle_rule" {
    for_each = var.lifecycle_rules
    content {
      action {
        type          = lifecycle_rule.value.action
        storage_class = lifecycle_rule.value.storage_class
      }
      condition {
        age = lifecycle_rule.value.age_days
      }
    }
  }
}
```

Inside `content`, the iterator is named after the block (`lifecycle_rule.value`, `lifecycle_rule.key`). `optional()` attributes in a `type` need a Terraform version that supports them: check the minimum in the docs.

**When to use `dynamic`:**

- The number of nested blocks is genuinely variable and comes from input (rules, ingress ports, labels as blocks).
- Writing them out would repeat the same shape many times.

**When not to:**

- You have two or three blocks that never change: write them out. Static blocks are easier to read, diff and review.
- You are building a mini programming language in HCL, with `dynamic` inside `dynamic` and conditionals inside `content`. If nobody can read the module, nobody can review a plan from it.
- The collection is a list whose order changes, and the provider treats nested blocks as ordered (a reorder looks like an edit). Prefer maps with stable keys where the provider allows.

A good test: can a colleague who has never seen the module tell from the call what infrastructure it produces? If not, simplify.

## lifecycle

The `lifecycle` block changes how Terraform treats a resource's changes. Each setting solves one problem and creates another if misused.

### prevent_destroy

```hcl title="main.tf"
resource "google_storage_bucket" "state_like" {
  name     = "example-lab-important-0001" # Change: a globally unique name
  location = "EU"
  project  = var.project_id

  lifecycle {
    prevent_destroy = true
  }
}
```

With `prevent_destroy = true`, any plan that would destroy this resource **fails with an error**. That catches an accidental `count` shift or a renamed key. But it protects only **while the block is in the configuration**:

- If you delete the whole `resource` block, the lifecycle setting goes with it and Terraform plans the destroy (the setting cannot block what is no longer in code). That is the reason `removed` blocks and review exist.
- `terraform destroy` fails on it too, which is a nuisance in a lab; you must remove the setting first.
- It does nothing for changes that happen outside Terraform, and it is not access control. Use IAM, bucket retention and object versioning for real data protection.

### create_before_destroy

When a change forces replacement, the default is destroy then create. `create_before_destroy = true` reverses it: the new object exists before the old one is removed. It is useful for things that must not have a gap (a certificate, an instance template behind a group). It does not work when the name must be unique and fixed (the new and old object would collide, as with a bucket name), and it propagates to dependencies, which can surprise you. Use it where the platform permits two objects at once.

### ignore_changes

```hcl title="main.tf"
resource "google_storage_bucket" "team" {
  name     = "example-lab-alpha-0001" # Change: a globally unique name
  location = "EU"
  project  = var.project_id

  lifecycle {
    ignore_changes = [labels["last_reviewed"]]
  }
}
```

`ignore_changes` makes Terraform ignore differences in the listed attributes. It is the right tool when another system legitimately owns a field (an autoscaler changing a node count, a team updating a label by hand). It is also how drift becomes invisible: an ignored attribute can change to anything and the plan stays green. Ignore the narrowest attribute you can, add a comment saying who owns it, and never ignore `all`.

### replace_triggered_by

`replace_triggered_by` forces a resource to be replaced when another resource or attribute changes:

```hcl title="main.tf"
resource "terraform_data" "config_version" {
  input = var.config_version
}

resource "google_storage_bucket_object" "config" {
  name    = "config.json"
  bucket  = google_storage_bucket.team["alpha"].name
  content = var.config_json

  lifecycle {
    replace_triggered_by = [terraform_data.config_version]
  }
}
```

Use it where a resource must be re-created when something it depends on changes but it has no argument that would otherwise show the change. The minimum Terraform version and the exact reference forms are version-dependent: check the docs.

### Preconditions and postconditions

`precondition` and `postcondition` blocks inside `lifecycle` check assumptions and fail the plan or apply with your message:

```hcl title="main.tf"
resource "google_storage_bucket" "team" {
  for_each = var.team_buckets
  name     = "example-lab-${each.key}-0001" # Change: a globally unique name
  location = each.value.location
  project  = var.project_id

  lifecycle {
    precondition {
      condition     = contains(["EU", "US", "ASIA"], each.value.location)
      error_message = "location must be a multi-region: EU, US or ASIA (team ${each.key})."
    }
    postcondition {
      condition     = self.uniform_bucket_level_access
      error_message = "uniform bucket-level access must be on for ${self.name}."
    }
  }
}
```

A precondition checks inputs before the resource is planned; a postcondition checks the result after apply. They express policy next to the resource. Broader, plan-wide rules belong in [[patterns/terraform-plan-policy-checks]].

### plan -replace

To force the recreation of one resource without editing code, use the planning option:

```bash title="replace a single resource"
terraform plan  -replace='google_storage_bucket_object.config'
terraform apply -replace='google_storage_bucket_object.config'
```

`-replace` supersedes the older `terraform taint` command. Read the plan first: it should show exactly one replacement. Replacing a stateful resource destroys its data.

## A first terraform test

`terraform test` runs `.tftest.hcl` files. A test file contains `run` blocks; each `run` executes a `plan` (or an `apply`) with the given variables and checks `assert` conditions. With `command = plan` no resources are created, which makes it fast, free and safe for a first test. The command and file format need a recent Terraform (the first stable release with `terraform test` is version-dependent; check the docs for the minimum your version has).

Put the module under `modules/team-buckets` and a test next to it. The second test below needs a `validation` block on the module's `team_buckets` variable, which is what the test proves works:

```hcl title="modules/team-buckets/variables.tf (excerpt)"
variable "team_buckets" {
  type = map(object({
    location      = string
    storage_class = string
  }))

  validation {
    condition     = alltrue([for b in values(var.team_buckets) : contains(["EU", "US", "ASIA"], b.location)])
    error_message = "location must be one of EU, US or ASIA."
  }
}
```

```hcl title="modules/team-buckets/tests/buckets.tftest.hcl"
variables {
  project_id = "example-lab-project"   # a placeholder: plan-only tests do not call the API for this
  team_buckets = {
    alpha = { location = "EU", storage_class = "STANDARD" }
    beta  = { location = "EU", storage_class = "NEARLINE" }
  }
}

run "creates_one_bucket_per_team" {
  command = plan

  assert {
    condition     = length(google_storage_bucket.team) == 2
    error_message = "expected one bucket per team"
  }

  assert {
    condition     = google_storage_bucket.team["beta"].storage_class == "NEARLINE"
    error_message = "beta must use NEARLINE"
  }
}

run "rejects_a_bad_location" {
  command = plan

  variables {
    team_buckets = {
      alpha = { location = "MARS", storage_class = "STANDARD" }
    }
  }

  expect_failures = [
    var.team_buckets,   # the validation block on the variable must reject "MARS"
  ]
}
```

Run it from the module directory:

```bash title="run the tests"
cd modules/team-buckets
terraform init
terraform test
```

```text
tests/buckets.tftest.hcl... in progress
  run "creates_one_bucket_per_team"... pass
  run "rejects_a_bad_location"... pass
tests/buckets.tftest.hcl... tearing down
tests/buckets.tftest.hcl... pass

Success! 2 passed, 0 failed.
```

_Illustrative._

Points to know:

- `expect_failures` lists the checkable objects (variables with validation, preconditions, postconditions) that are _expected_ to fail; the run passes if they do. This lets you test that your guardrails actually reject bad input.
- `command = apply` really creates resources in the configured provider, then destroys them at the end of the test file. It needs credentials and costs money. Start with `plan`.
- **Mock providers** (a `mock_provider` block) let a test run without any real cloud calls, by returning generated data for resources and data sources. They need a newer Terraform than plain `terraform test`: check the minimum version in the docs. A plan test against the real Google provider still needs the provider's configuration to initialise and, for some data sources, credentials.
- Tests complement, not replace, `terraform validate`, formatting and policy checks. The broader strategy (unit, integration, contract) is in [[patterns/terraform-testing]], and module layout in [[patterns/terraform-module-and-state-layout]].

> [!tip] OpenTofu
> OpenTofu, the open-source fork, supports the same language features used here, including `for_each`, `moved` blocks and a testing framework, but the version at which each feature appeared differs from HashiCorp Terraform. If you use OpenTofu, check its documentation for each feature; see [[tools/terraform-vs-opentofu]] and the OpenTofu docs at https://opentofu.org/docs/.

## Hands-on exercises

Use a scratch directory and the sandbox project. Steps with `plan` create nothing. The apply steps below create billed (but tiny) resources.

> [!warning] Costs money
> A few empty Cloud Storage buckets cost next to nothing, but they are billed resources in your project, and names are global. Prices change: check the current Cloud Storage pricing page. Clean up with `terraform destroy` at the end (exercise 9) and confirm with `gcloud storage buckets list --project "$TF_VAR_project_id"`.

1. **Set up variables and a `count` configuration.**

   ```bash
   mkdir -p ~/tf-loops && cd ~/tf-loops
   export TF_VAR_project_id="lab-yourname-123456"   # Change: your lab project ID
   ```

   Create `main.tf` with the `count` version (a `provider "google"` block with `project = var.project_id` and `region = "europe-west1"`), and set the bucket names to a prefix you own, such as `lab-yourname-123456-alpha`.
   Expected: `terraform init` succeeds.
   If you see something else: a provider download error is a network or proxy problem; check connectivity. Use the names from your own project ID, because bucket names are global and the `example-lab` prefix will collide.

2. **Apply four buckets with `count`.**

   ```bash
   terraform apply -auto-approve
   terraform state list
   ```

   Expected: four resources, `google_storage_bucket.team[0]` to `[3]`.
   If you see something else: a "bucket already exists" or "not available" error means the name is taken; change the prefix.

3. **Remove the middle item and read the damage.** Delete `"beta"` from the default list and run:

   ```bash
   terraform plan
   ```

   Expected: `Plan: 2 to add, 0 to change, 3 to destroy.` with `team[1]`, `[2]` and `[3]` in the list. Do not apply it.
   If you see something else: the exact counts depend on how names are built. If nothing is replaced, check that your name uses the list element, not only the index.

4. **Switch to `for_each` with `moved` blocks.** Restore `"beta"`. Change to the map-based `for_each` version, keep the same name expression, add the four `moved` blocks, and:

   ```bash
   terraform plan
   ```

   Expected: four `has moved` lines and `Plan: 0 to add, 0 to change, 0 to destroy.`
   If you see something else: if you see adds and destroys, the bucket names changed; align the name expression with the old one. If you see "Cannot move to address", the `to` key does not exist in the map.

5. **Apply the move, then remove a key.**

   ```bash
   terraform apply -auto-approve
   terraform state list
   ```

   Then delete `beta` from the map and run `terraform plan`.
   Expected: the state shows `team["alpha"]` and so on, and the second plan shows exactly one destroy, `team["beta"]`. Apply it.
   If you see something else: leftover `moved` blocks are harmless; keep them for now.

6. **Hit the plan-time key rule.** Add the failing `for_each = toset([google_service_account.app.email])` example, with a service account in the same configuration.
   Expected: an error saying the `for_each` set depends on values not known until apply.
   If you see something else: if it plans, the value is known (for example a variable); use an attribute of a resource you create in the same run.

7. **Add `prevent_destroy` and try to destroy.** Add the lifecycle block to one bucket and run `terraform destroy`.
   Expected: an error `Instance cannot be destroyed` naming the resource.
   If you see something else: if it destroys, the setting is not on that resource. Remove `prevent_destroy` before the cleanup step.

8. **Write and run the tests.** Create the module layout, extract the bucket resource into the module, add a `validation` block to the `location` field of `team_buckets` that allows only `EU`, `US` and `ASIA`, then add the test file and run `terraform test`.
   Expected: two passing runs.
   If you see something else: `expect_failures` works only on objects that can fail (validations and conditions); if the second run errors out instead of passing, the bad location is not caught by any validation yet. If `terraform test` is not a command, your Terraform is too old for it.

9. **Clean up.**

   ```bash
   sed -i '/prevent_destroy/d' main.tf    # or edit the file by hand
   terraform destroy -auto-approve
   gcloud storage buckets list --project "$TF_VAR_project_id" --format='value(name)'
   ```

   Expected: no lab buckets remain.
   If you see something else: a bucket that is not empty fails to delete unless `force_destroy = true`; empty it first.

## Common mistakes

- **`count` over a list of named things.** Why it bites: removing an item shifts every later index, which destroys and recreates resources. Fix: `for_each` with stable keys; keep `count` for zero-or-one.
- **`for_each` keys from values known only after apply.** Why it bites: Terraform cannot plan the instance set. Fix: keys from variables or locals, values from resources.
- **Renaming a map key.** Why it bites: the address changes, which is a destroy and create. Fix: a `moved` block, or pick stable keys.
- **Converting `count` to `for_each` without `moved`.** Why it bites: the plan destroys and recreates every instance. Fix: `moved` blocks and a plan showing zero changes.
- **Removing `moved` blocks too early.** Why it bites: other workspaces and environments that have not applied yet lose the mapping. Fix: keep them for a release.
- **A `dynamic` block for two static blocks.** Why it bites: readers cannot see the real infrastructure. Fix: write them out.
- **Relying on `prevent_destroy` as protection.** Why it bites: it vanishes when the block is deleted and is not access control. Fix: review deletes, IAM, retention and versioning.
- **`ignore_changes = all`.** Why it bites: drift becomes invisible. Fix: the narrowest attribute, with a comment on who owns it.
- **Using `create_before_destroy` on a resource with a fixed unique name.** Why it bites: the two objects collide. Fix: use it only where two can coexist.
- **Applying in a test.** Why it bites: `command = apply` creates real resources and costs money. Fix: start with `plan`, apply only in a sandbox.
- **Trusting the version numbers on this page.** Why it bites: features appeared in different versions. Fix: check the minimum Terraform versions for `terraform test`, mock providers, `optional()` and `removed` blocks in the docs for the version you pin.

## Check your understanding

1. You remove the second item of a `count` list of four buckets. What does the plan do, and why?
2. Why must `for_each` keys be known at plan time, and how do you restructure code that fails this rule?
3. How do you move existing instances from `count` to `for_each` without destroying them? What do you check in the plan?
4. When does a `dynamic` block make code worse?
5. Name two ways `prevent_destroy` fails to protect a resource.
6. What does `command = plan` in a `run` block give you, and what is `expect_failures` for?

> [!question]- Answers
>
> 1. It re-indexes the remaining items: the third and fourth buckets take positions 1 and 2, so their names change and Terraform plans to destroy and recreate them, and destroys the last index. Index is position, not identity.
> 2. Terraform must know which instances exist before it can plan. A key computed from an apply-time attribute is unknown. Use known keys (names you choose) and put the unknown attribute in the value.
> 3. Change to `for_each` with the same names, add a `moved` block per instance from the index address to the key address, and run `terraform plan`. It should say each instance has moved and show zero to add, change and destroy.
> 4. When it hides a small, fixed set of blocks, nests several levels deep, or contains so much logic that a reviewer cannot tell what the plan will produce.
> 5. Deleting the resource block removes the setting, so the destroy is planned; and it does nothing for changes made outside Terraform. It is also not access control.
> 6. It runs a plan without creating anything, so the test is fast, free and safe, and `assert` checks the planned values. `expect_failures` lists variables, preconditions or postconditions that are expected to fail, so you can test that bad input is rejected.

## Next steps

Next lesson: [[learn/promql-for-alert-rules-and-recording-rules|Observability 04: PromQL for alert rules]], or go back to the main path via [[learn/index|the learning path]]. Previous lessons: [[learn/terraform-state-modules-and-pipelines|Delivery 05]] for state, modules and pipelines, and [[learn/terraform-basics-on-gcp|Delivery 04]] for the basics.

To go deeper:

- [[patterns/terraform-testing]] for a testing strategy beyond a first `.tftest.hcl`.
- [[patterns/terraform-module-and-state-layout]] for module boundaries and state splits.
- [[patterns/terraform-plan-policy-checks]] for policy checks over plan output.
- [[runbooks/terraform-state-recovery]] for what to do when a bad apply or a lost state needs repair.
- [[tools/terraform-vs-opentofu]] for the differences between the two tools.

## Sources

- HashiCorp Terraform documentation, `for_each` (https://developer.hashicorp.com/terraform/language/meta-arguments/for_each) and `count` (https://developer.hashicorp.com/terraform/language/meta-arguments/count).
- HashiCorp Terraform documentation, "Dynamic Blocks" (https://developer.hashicorp.com/terraform/language/expressions/dynamic-blocks).
- HashiCorp Terraform documentation, the `lifecycle` meta-argument (https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle), for `prevent_destroy`, `create_before_destroy`, `ignore_changes`, `replace_triggered_by`, preconditions and postconditions.
- HashiCorp Terraform documentation, "Tests" (https://developer.hashicorp.com/terraform/language/tests), for `.tftest.hcl`, `run`, `assert`, `expect_failures` and mock providers.
- HashiCorp Terraform documentation, "Refactoring" (https://developer.hashicorp.com/terraform/language/modules/develop/refactoring), for `moved` blocks.
- Terraform Registry, `google_storage_bucket` (https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket), for the bucket arguments. Check all documentation paths; HashiCorp reorganises them.
- OpenTofu documentation (https://opentofu.org/docs/), for feature availability in OpenTofu.
- Not verified: all plan output (illustrative), the minimum Terraform versions for `terraform test`, mock providers, `optional()` attributes, `replace_triggered_by` and `removed` blocks, bucket arguments for your provider version, and OpenTofu feature parity. Check the current docs.
