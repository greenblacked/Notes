---
title: Ansible vs Chef vs Salt for configuration management
description: Comparing Ansible, Chef and Salt for Linux fleets on push vs pull, state model, testing and secrets, and when to stop managing hosts at all.
type: tool
tags:
  - tools
  - chef
  - linux
  - reliability
  - security
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Ansible, Chef and Salt all describe how a Linux host should look and make it so. They differ in architecture (agentless push versus agent pull), in language, and in the cost of running the control plane. Before comparing them, ask whether the hosts should be configured in place at all; the immutable alternative is covered below and in [[packer-vs-chef-for-images]].

> [!info] Not checked against current releases
> Versions, licences, project status and plugin names were not checked when this note was written. Confirm them in the current documentation.

## Short answer

If you have no configuration management yet and your fleet is small to medium, Ansible has the lowest barrier: SSH, YAML, no agent. If you already run Chef cookbooks with tests and a server, keep them and move toward baking images rather than rewriting in another tool. Salt fits very large fleets that need fast remote execution, if you accept running a master and a less common skill set. For a fleet on GCE, the best configuration management is often less of it: bake images and replace instances.

## At a glance (agent, push or pull, language, state model, idempotency)

| Concern        | Ansible                                | Chef                                      | Salt                                   |
| -------------- | -------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Agent          | None (SSH or WinRM)                    | Agent (`chef-client`), or local mode      | Agent (minion) or agentless (salt-ssh) |
| Model          | Push, from a control node              | Pull, on a schedule                       | Push and pull via a message bus        |
| Language       | YAML playbooks, Jinja2, Python modules | Ruby DSL (cookbooks, recipes)             | YAML states with Jinja, Python modules |
| State model    | Ordered tasks; idempotent via modules  | Resources converged in order              | Declarative states with requisites     |
| Control plane  | Control node, optionally a platform    | Chef Infra Server (or none in local mode) | Salt master (or masterless)            |
| Inventory      | Static files or dynamic inventory      | Server node objects, search               | Grains and pillar                      |
| Learning curve | Gentle                                 | Steeper (Ruby)                            | Medium                                 |

## Dry-run and change preview

Always preview changes before applying them to production hosts.

```bash title="dry-run.sh"
# Ansible: check mode with a diff, limited to one host
ansible-playbook site.yml --check --diff --limit web-01.example.com

# Chef: why-run mode
sudo chef-client --why-run

# Salt: test mode
salt '*' state.apply test=True
```

None of these is a perfect simulation. Check mode skips tasks that depend on earlier changes (for example a command that creates a file used later), so a clean preview does not prove a clean run. Use canary hosts: apply to one, verify, then widen.

## Secrets handling (Ansible Vault, Chef Vault or data bags, Salt pillar; prefer Secret Manager)

- **Ansible Vault** encrypts files or variables with a password; the password must be distributed to whoever runs playbooks. Easy, but the key becomes the secret.
- **Chef** uses encrypted data bags or Chef Vault, which encrypts per node and per admin, plus the server's own access controls.
- **Salt pillar** distributes data from the master to specific minions; encrypt at rest with a supported renderer.

All three leave a long-lived key to protect. Prefer fetching secrets at runtime from a managed store (Secret Manager or Vault) with a host identity, and keep only references in code. See [[vault-vs-gcp-secret-manager]]. Never commit decrypted values, and rotate on staff changes.

## Testing (Molecule, Test Kitchen with InSpec, Salt test options)

- **Ansible**: Molecule creates a container or VM, runs the role, runs it again to check idempotence, then runs verifiers.
- **Chef**: Test Kitchen with InSpec is the established path, as in [[linux-host-hardening-with-chef-and-inspec]].
- **Salt**: test mode and integration tests with the project's test tooling; the ecosystem is thinner. Check the current docs.

Whatever the tool, the minimum is: lint, converge on a clean instance, converge again with zero changes (idempotence), and verify with an independent check such as InSpec.

## Scale and operating cost (control nodes, Chef Infra Server, Salt master)

Ansible's control node is simple, but push over SSH to thousands of hosts is slow without tuning (forks, pipelining, pull mode via `ansible-pull`), and credentials to every host sit on the control node. Chef's pull model scales well because hosts converge independently, at the price of running and upgrading the Infra Server, its search index and database. Salt's persistent message bus gives fast fan-out and reactive automation, with a master that is a high-value target and needs high availability and key management. The cost of any of them is mostly people: cookbook or role upkeep, upgrades of the tool itself, and on-call for the control plane.

## Migration paths and the immutable alternative

A short equivalent for "ensure a package is installed and a service is running":

```yaml title="ansible: nginx.yml"
- hosts: web
  become: true
  tasks:
    - name: Ensure nginx is installed
      ansible.builtin.package:
        name: nginx
        state: present
    - name: Ensure nginx is running and enabled
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```

```ruby title="chef: recipes/default.rb"
package 'nginx'

service 'nginx' do
  action [:enable, :start]
end
```

```yaml title="salt: nginx.sls"
nginx:
  pkg.installed: []
  service.running:
    - enable: True
    - require:
        - pkg: nginx
```

Moving between tools is a rewrite of intent, not a translation of syntax; do it only when the operational cost justifies it. A better target for most GCE fleets is no in-place configuration: bake images, replace instances, and keep the tool only for building. The sequence is in [[chef-to-immutable-images-migration]]. For Kubernetes nodes and containers, configuration management mostly disappears into images and manifests.

## Licensing and project status (check the current docs)

Chef's distribution and licensing have changed under successive owners, and community builds exist (see Cinc). Ansible is open source with a commercial platform from Red Hat. Salt is open source under the Broadcom/VMware umbrella; check the current governance, release cadence and licence before committing to a new Salt estate. Whatever you pick, look at the commit and release history, not just the website.

## When to choose which

- **Ansible**: starting out, small and medium fleets, network devices, ad-hoc tasks, building images.
- **Chef**: existing cookbooks and tests, large pull-based fleets, compliance-as-code with InSpec.
- **Salt**: very large fleets, remote execution, event-driven automation, and a team that knows it.
- **None**: replaceable instances built from images.

## Recommendation

Keep the tool you have if it works and is tested; do not migrate between configuration managers for fashion. For new work on GCE, use Ansible or Chef only as the provisioner inside an image build, and manage change through rolling replacement. Keep secrets in a managed store, preview every change, and test idempotence. What would change this: a large stateful fleet that cannot be rebuilt (then a pull-based agent with continuous convergence earns its keep), or a vendor change that raises the cost of your current tool.

## Related

- [[packer-vs-chef-for-images]]
- [[linux-host-hardening-with-chef-and-inspec]]
- [[chef-to-immutable-images-migration]]
- [[vault-vs-gcp-secret-manager]]

## Sources

- [Ansible documentation](https://docs.ansible.com/ansible/latest/)
- [Chef documentation](https://docs.chef.io/)
- [Salt project documentation](https://docs.saltproject.io/)
