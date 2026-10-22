---
title: Data classification with GCP resource tags and Kubernetes labels
description: Make data classes machine-readable with GCP Resource Manager tags and Kubernetes namespace labels, and drive org policy, IAM and admission rules from them.
type: pattern
tags:
  - compliance
  - gcp
  - kubernetes
  - policy-as-code
  - security
  - terraform
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - data classification tags
  - data-class label
---

PCI DSS and GDPR scope, customer-managed keys, data residency, retention and deletion all start from the same question: which project, bucket, dataset or namespace holds which class of data? If the answer lives in a spreadsheet, nothing can enforce it and it goes stale. This pattern puts the class on the resource itself: GCP Resource Manager tags on folders and projects (and on resources that support them), and a label on Kubernetes namespaces, with policies that act on them. Folder design is in [[architecture/gcp-resource-hierarchy-and-landing-zone|resource hierarchy and landing zone]] and the org policy mechanics in [[compliance/gcp-organization-policy-guardrails|org policy guardrails]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> Nothing here was applied to an organisation or a cluster. Terraform arguments and `gcloud` flags were checked against the provider documentation, Google's API definitions and the installed `gcloud` help on 2026-10-21. **Not verified**: the list of resource types that support tags, whether a tag bound lower in the hierarchy overrides an inherited value for the same key, quotas on keys, values and bindings, the IAM role for creating tag keys, what the `DATA_GOVERNANCE` purpose changes, which org policy constraints accept tag conditions, the IAM allow-policy form of `resource.matchTag`, and the Kubernetes policy YAML below. Check them before you rely on them.

## Short answer

- Define a small scheme (for example **public, internal, confidential, restricted**) and write down what each class requires: encryption, location, retention, access and logging. Here the classes and their handling rules are set by [[standards/data-classification-and-handling-standard]]; this note makes them machine-readable.
- On GCP, create one **tag key** (`data-class`) at the organisation with one **tag value** per class, and bind values to **folders and projects**. Tags are inherited by descendants and can be referenced in **conditional org policies** and IAM conditions; labels cannot.
- Control **who may bind** tags with IAM on the tag values, so that classification is a reviewed change, not something any project owner can flip.
- In Kubernetes, require a **data-class label on every namespace** with an admission policy, and keep restricted namespaces on dedicated node pools.
- Inventory everything by tag with **Cloud Asset Inventory**, and treat an unclassified project as a finding.

## An example scheme

Four classes are usually enough; more classes are rarely applied consistently. The classes, their definitions and their handling rules (encryption, location, retention, access and logging) are set in [[standards/data-classification-and-handling-standard]], and this note does not restate them. The tag values below are the class names, as a summary:

| Class          | Examples                                                  |
| -------------- | --------------------------------------------------------- |
| `public`       | Public docs, open-source artifacts                        |
| `internal`     | Build logs, internal dashboards, non-personal metrics     |
| `confidential` | Customer configuration, pseudonymised personal data       |
| `restricted`   | Personal data in regulatory scope, card data, credentials |

The standard's handling matrix is what policies enforce. Encryption evidence is described in [[compliance/encryption-at-rest-and-in-transit-evidence-gcp|encryption evidence]], deletion in [[compliance/data-deletion-and-crypto-shredding-gcp|proving data deletion]] and logging scope in [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data|PCI DSS and GDPR for DevOps]].

## Labels and tags are different things on GCP

| Property                        | Labels                             | Resource Manager tags                                                           |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| Defined where                   | Free-form on each resource         | Keys and values are resources of their own, under the organisation or a project |
| Who can set them                | Anyone who can update the resource | Controlled by IAM on the tag key and value                                      |
| Inheritance                     | None                               | A binding on a folder or project applies to its descendants                     |
| Usable in org policy conditions | No (general knowledge; check)      | Yes, with `resource.matchTag` or `resource.matchTagId`                          |
| Usable in IAM conditions        | No (general knowledge; check)      | Yes (check the IAM tag documentation for the supported form)                    |
| Typical use                     | Cost allocation, ownership, search | Policy: classification, environment, firewall targeting                         |

The Terraform documentation describes tags as key-value pairs that "you can use ... to conditionally allow or deny policies based on whether a resource has a specific tag". Keep using labels for cost and ownership ([[standards/kubernetes-labels-and-annotations-standard|labels standard]]); use tags where a policy must act on the value. It is fine to have both on the same project, as long as the tag is the source of truth for the class.

## Tags in Terraform

Create the key at the organisation, one value per class, and bind the values to folders or projects. All three resources support a `deletion_policy` argument (`DELETE` by default, `PREVENT` or `ABANDON`), which guards against a `terraform destroy` removing the classification of everything at once.

```hcl title="org/data-class-tags.tf"
variable "org_id" {
  type        = string
  description = "Numeric organisation ID."     # change: e.g. 123456789012
}

locals {
  data_classes = {
    public       = "Data that may be published."
    internal     = "Internal data with no personal or customer content."
    confidential = "Customer or pseudonymised data; need-to-know access."
    restricted   = "Personal, card or secret data; CMEK and named regions required."
  }
}

resource "google_tags_tag_key" "data_class" {
  parent          = "organizations/${var.org_id}"
  short_name      = "data-class"
  description     = "Data classification of everything below the bound resource."
  deletion_policy = "PREVENT"
  # purpose is immutable once set; leave it unset unless you have checked
  # what DATA_GOVERNANCE changes for your organisation.
}

resource "google_tags_tag_value" "data_class" {
  for_each = local.data_classes

  parent          = google_tags_tag_key.data_class.id
  short_name      = each.key
  description     = each.value
  deletion_policy = "PREVENT"
}
```

Bind a class to a folder or a project with its full resource name:

```hcl title="projects/payments-prod/tags.tf"
variable "project_number" {
  type        = string
  description = "Numeric project number of the payments production project."   # change
}

variable "data_class_values" {
  type        = map(string)
  description = "Map of class name to tag value ID (tagValues/...), from the org stack outputs."
}

resource "google_tags_tag_binding" "data_class" {
  parent    = "//cloudresourcemanager.googleapis.com/projects/${var.project_number}"
  tag_value = var.data_class_values["restricted"]
}
```

The `tag_value` argument also accepts the namespaced form `{org-id}/{key}/{value}` (for example `123456789012/data-class/restricted`), which avoids passing IDs between stacks. Some resources take tags through their own arguments instead of a binding: Compute Engine instances and GKE node configurations have `resource_manager_tags` (the latter for firewall use), and BigQuery datasets have `resource_tags`. Regional resources such as buckets bind with a location (`--location` on `gcloud resource-manager tags bindings create`); check the current docs for the resource types and the matching Terraform resource.

The same with `gcloud`, for a one-off check or a bootstrap:

```bash title="scripts/data-class-tags.sh"
set -euo pipefail

ORG_ID="123456789012"          # change: organisation ID
PROJECT_NUMBER="111111111111"  # change: project number (not the project ID)

gcloud resource-manager tags keys create data-class \
  --parent="organizations/${ORG_ID}" \
  --description="Data classification"

for CLASS in public internal confidential restricted; do
  gcloud resource-manager tags values create "${CLASS}" \
    --parent="${ORG_ID}/data-class"
done

gcloud resource-manager tags bindings create \
  --tag-value="${ORG_ID}/data-class/restricted" \
  --parent="//cloudresourcemanager.googleapis.com/projects/${PROJECT_NUMBER}"

# Directly bound and inherited tags of the project.
gcloud resource-manager tags bindings list \
  --parent="//cloudresourcemanager.googleapis.com/projects/${PROJECT_NUMBER}" --effective
```

## Who may classify

A tag is only as good as the control on who binds it. If any project owner can move a project from `restricted` to `internal`, the CMEK and location rules below can be switched off by the people they constrain.

- Grant the role that allows binding (`roles/resourcemanager.tagUser`, which the `gcloud` help uses in its examples) **on the tag value**, not organisation-wide, and only to the platform pipeline that applies the classification stack. Binding also needs permission on the resource being tagged; check the current docs for the exact permissions.
- Restrict creating and changing keys and values to a small admin group (believed to be `roles/resourcemanager.tagAdmin`; check the role names and permissions).
- Keep the bindings in Terraform, reviewed by security as a code owner ([[adr/0024-gcp-folders-by-policy-boundary|folders by policy boundary]]).

```bash title="scripts/tag-value-iam.sh"
set -euo pipefail

ORG_ID="123456789012"                                                    # change
PIPELINE_SA="serviceAccount:classification@example-seed.iam.gserviceaccount.com"   # change

for CLASS in public internal confidential restricted; do
  VALUE_ID="$(gcloud resource-manager tags values describe "${ORG_ID}/data-class/${CLASS}" --format='value(name)')"
  gcloud resource-manager tags values add-iam-policy-binding "${VALUE_ID}" \
    --member="${PIPELINE_SA}" --role="roles/resourcemanager.tagUser"
done
```

Both `tags values` commands are in the installed `gcloud`; check their flags with `--help`. In Terraform, `google_tags_tag_value_iam_member` does the same.

## Org policy conditioned on the class

Org policy rules can carry a condition of 1 to 10 subexpressions, joined by `||` or `&&`, each of the form `resource.matchTag('<ORG_ID>/<key>', '<value>')` or `resource.matchTagId('tagKeys/<id>', 'tagValues/<id>')`. That turns the classification into enforcement: one policy, different rules for different classes.

Example: deny services that are not using CMEK, but only for `restricted` projects. The constraint name and its use with a tag condition are **not verified**; check that the constraint supports conditions and which service names it takes, and roll it out in dry run first ([[compliance/gcp-organization-policy-guardrails#Rolling out with dry-run|dry-run rollout]]).

```hcl title="org/policy-restricted-cmek.tf"
resource "google_org_policy_policy" "restricted_requires_cmek" {
  name   = "organizations/${var.org_id}/policies/gcp.restrictNonCmekServices"   # check the constraint
  parent = "organizations/${var.org_id}"

  spec {
    rules {
      condition {
        title       = "restricted-data-requires-cmek"
        description = "Projects classified restricted may not use Google-managed keys for these services."
        expression  = "resource.matchTag('${var.org_id}/data-class', 'restricted')"
      }
      values {
        denied_values = ["storage.googleapis.com", "bigquery.googleapis.com", "sqladmin.googleapis.com"]   # check the service names
      }
    }
    rules {
      allow_all = "TRUE"   # unconditional fallback for everything else
    }
  }
}
```

The same shape works for location: a tighter `gcp.resourceLocations` rule for `restricted` than for the rest of the organisation, if the constraint accepts a tag condition (check). Reading the effective policy for a project confirms what it actually gets:

```bash title="scripts/effective-policy.sh"
set -euo pipefail

PROJECT_ID="example-prod-1"   # change
gcloud org-policies describe gcp.restrictNonCmekServices --project="${PROJECT_ID}" --effective
```

## IAM conditioned on the class

IAM allow-policy conditions can reference tags as well, for example to grant a broad analyst role on a folder everywhere except restricted projects. The form below mirrors the org policy syntax and is **not verified** for IAM; check the IAM tag documentation before using it.

```bash title="scripts/iam-not-restricted.sh"
set -euo pipefail

FOLDER_ID="222222222222"                        # change
ORG_ID="123456789012"                           # change
GROUP="group:analysts@example.com"              # change

gcloud resource-manager folders add-iam-policy-binding "${FOLDER_ID}" \
  --member="${GROUP}" \
  --role="roles/bigquery.dataViewer" \
  --condition="expression=!resource.matchTag('${ORG_ID}/data-class', 'restricted'),title=not-restricted"
```

Prefer folder structure where it fits: if restricted projects live in their own folder ([[architecture/environment-separation-on-gcp|environment separation]]), most access rules do not need a condition at all. Tags help where the class cuts across folders.

## Kubernetes: a data-class label on every namespace

GKE clusters often host several classes. Mark the class on the namespace and let admission enforce it. Following the [[standards/kubernetes-labels-and-annotations-standard|labels standard]], a custom key uses the organisation's domain prefix: `example.com/data-class`.

```yaml title="namespaces/payments-prod.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: payments-prod
  labels:
    example.com/data-class: restricted
    team: team-payments
    environment: prod
    pod-security.kubernetes.io/enforce: restricted
```

Require the label with a ValidatingAdmissionPolicy, as [[adr/0022-admission-policy-pod-security-vap-and-kyverno|ADR-0022]] prescribes for simple checks. Start in `Warn` and `Audit`, then move to `Deny`.

```yaml title="policies/vap-namespace-data-class.yaml"
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: namespace-data-class
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["namespaces"]
  validations:
    - expression: >-
        has(object.metadata.labels) &&
        'example.com/data-class' in object.metadata.labels &&
        object.metadata.labels['example.com/data-class'] in
        ['public', 'internal', 'confidential', 'restricted']
      message: "Namespaces need example.com/data-class set to public, internal, confidential or restricted."
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: namespace-data-class
spec:
  policyName: namespace-data-class
  validationActions: [Warn, Audit]
  matchResources:
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: NotIn
          values: ["kube-system", "kube-public", "kube-node-lease", "default"]
```

### Restricted namespaces on dedicated node pools

Keep restricted workloads on nodes that run nothing else. Taint and label a node pool, and let Kyverno add the matching node selector and toleration to pods in restricted namespaces:

```hcl title="gke/restricted-node-pool.tf"
resource "google_container_node_pool" "restricted" {
  name     = "restricted"
  cluster  = google_container_cluster.prod.id     # change
  location = "europe-west1"                       # change

  node_config {
    machine_type = "e2-standard-4"                # change
    labels = {
      "example.com/data-class" = "restricted"
    }
    taint {
      key    = "example.com/data-class"
      value  = "restricted"
      effect = "NO_SCHEDULE"
    }
  }
}
```

```yaml title="policies/kyverno-restricted-placement.yaml"
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restricted-data-placement
spec:
  rules:
    - name: pin-restricted-pods
      match:
        any:
          - resources:
              kinds: ["Pod"]
              namespaceSelector:
                matchLabels:
                  example.com/data-class: restricted
      mutate:
        patchStrategicMerge:
          spec:
            nodeSelector:
              example.com/data-class: restricted
            tolerations:
              - key: example.com/data-class
                operator: Equal
                value: restricted
                effect: NoSchedule
```

The mutation pins restricted pods; it does not stop other pods from adding the same toleration and landing on the restricted pool. Close that with a validation:

```yaml title="policies/vap-restricted-toleration.yaml"
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: restricted-toleration-only-in-restricted-namespaces
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        !has(object.spec.tolerations) ||
        !object.spec.tolerations.exists(t, has(t.key) && t.key == 'example.com/data-class') ||
        (has(namespaceObject.metadata.labels) &&
         namespaceObject.metadata.labels[?'example.com/data-class'].orValue('') == 'restricted')
      message: "Only pods in restricted namespaces may tolerate the restricted node pool."
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: restricted-toleration-only-in-restricted-namespaces
spec:
  policyName: restricted-toleration-only-in-restricted-namespaces
  validationActions: [Warn, Audit]
```

> [!note] Policy YAML not applied to a cluster
> The CEL expressions (including the optional-key syntax `[?...]` and `orValue`, which needs a Kubernetes version that supports CEL optionals), the Kyverno mutation and the GKE node pool arguments were not run. Test them in a non-production cluster through the audit-then-enforce rollout.

## Inventory and drift

Cloud Asset Inventory searches tags directly: `tagKeys:` and `tagValues:` match tags bound to the resource itself, and `effectiveTagKeys:` and `effectiveTagValues:` include inherited ones.

```bash title="scripts/classification-inventory.sh"
set -euo pipefail

ORG_ID="123456789012"   # change
OUT="classification-$(date +%Y-%m-%d)"
mkdir -p "${OUT}"

# Every project, and every project that has a data-class tag (bound or inherited).
gcloud asset search-all-resources --scope="organizations/${ORG_ID}" \
  --asset-types="cloudresourcemanager.googleapis.com/Project" \
  --format="value(name)" | sort > "${OUT}/all-projects.txt"

gcloud asset search-all-resources --scope="organizations/${ORG_ID}" \
  --asset-types="cloudresourcemanager.googleapis.com/Project" \
  --query="effectiveTagKeys:data-class" \
  --format="value(name)" | sort > "${OUT}/classified-projects.txt"

# Unclassified projects: a finding each.
comm -23 "${OUT}/all-projects.txt" "${OUT}/classified-projects.txt" > "${OUT}/unclassified.txt"
wc -l "${OUT}/unclassified.txt"

# Restricted resources and where they are (check the query value format and output fields with --help).
gcloud asset search-all-resources --scope="organizations/${ORG_ID}" \
  --query="effectiveTagValues:${ORG_ID}/data-class/restricted" \
  --format="csv(name,assetType,location,project)" > "${OUT}/restricted-resources.csv"
```

Run it on a schedule and send the unclassified list to the owners. For a dated snapshot you can show an auditor, export the full inventory with `gcloud asset export --content-type=resource --snapshot-time=... --output-path=gs://...` into the evidence bucket ([[compliance/continuous-control-monitoring-gcp-and-gke|continuous control monitoring]] covers the scheduling and alerting). In Kubernetes, list namespaces and their class:

```bash title="scripts/namespace-classes.sh"
set -euo pipefail
CONTEXT="gke_example-prod-1_europe-west1_prod-1"   # change
kubectl --context "${CONTEXT}" get namespaces -L example.com/data-class
```

## Validation

- A test project without a tag appears in `unclassified.txt` the next day.
- In a sandbox project tagged `restricted`, creating a bucket without CMEK is refused once the policy is enforced (dry run first).
- A namespace created without the label produces a warning (audit phase) or is refused (enforce phase).
- A pod in an `internal` namespace that tolerates the restricted taint is warned or refused.
- Removing a tag binding outside Terraform shows up as drift in the next `terraform plan` and in the audit log.

## Rollback

- Org policy: switch the rule to dry run, or remove the conditional rule, and re-apply. The unconditional fallback rule keeps the rest of the organisation unaffected.
- Admission: set `validationActions` back to `[Warn, Audit]`, or delete the binding.
- Tags: removing a binding immediately changes which conditional rules apply to that project, which can loosen or tighten policies at once. Treat binding changes as production changes.

## Pitfalls

- **Tags and labels confused.** A `data-class` label on a project does nothing for org policy; only the tag does. Pick one name and document which is authoritative.
- **Inheritance surprises.** A folder bound to `confidential` makes every project under it confidential unless the project carries its own binding. Whether a lower binding overrides the inherited value for the same key, and how conflicts resolve, is not verified here; check before relying on overrides.
- **Deleting a value still in use.** The API refuses to delete a tag value that still has bindings, and a key that still has values. With `deletion_policy = "PREVENT"` Terraform refuses earlier, which is what you want.
- **Resources that do not take tags.** Not every resource type supports tags, and some take them only at creation (Terraform notes that `resource_manager_tags` on an instance cannot be updated in place and forces re-creation). Classify at the project level and use resource-level tags only where needed.
- **Immutable fields.** A tag key's `short_name` and `purpose` cannot be changed. Choose them once.
- **Classification without enforcement.** A tag nobody's policy reads is a label with extra steps. Tie each class to at least one enforced rule.
- **Everything is restricted.** Over-classification makes the restricted controls expensive and invites exceptions. Exceptions go through [[compliance/policy-exception-and-waiver-process|the exception process]].

## Related

- [[compliance/gcp-organization-policy-guardrails]]: org policy as code, dry run and exceptions.
- [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]: scoping card and personal data.
- [[compliance/data-deletion-and-crypto-shredding-gcp]]: deletion per class.
- [[compliance/gcp-provider-access-controls-and-data-residency]]: provider access and residency for restricted data.
- [[standards/data-classification-and-handling-standard]]: the classes, their handling rules and where each label or tag goes.
- [[standards/kubernetes-labels-and-annotations-standard]]: label naming.
- [[standards/gcp-resource-naming-and-labels-standard]]: the `data-classification` resource label next to the tag.
- [[compliance/continuous-control-monitoring-gcp-and-gke]]: scheduled inventory and alerting.

## Sources

- Google Cloud, [Tags overview](https://cloud.google.com/resource-manager/docs/tags/tags-overview).
- Google Cloud, [Creating and managing tags](https://cloud.google.com/resource-manager/docs/tags/tags-creating-and-managing).
- Google Cloud, [Tags and access control](https://cloud.google.com/iam/docs/tags-access-control).
- Google Cloud, [Setting an organization policy with tags](https://cloud.google.com/resource-manager/docs/organization-policy/tags-organization-policy).
- Google Cloud, REST reference for [tagKeys](https://cloud.google.com/resource-manager/reference/rest/v3/tagKeys) and [tagValues](https://cloud.google.com/resource-manager/reference/rest/v3/tagValues).
- HashiCorp, [google_tags_tag_key](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/tags_tag_key), [google_tags_tag_value](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/tags_tag_value) and [google_tags_tag_binding](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/tags_tag_binding).
- Kubernetes, [Labels and selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) (not re-checked for this note; see the Kubernetes documentation for ValidatingAdmissionPolicy and CEL).
