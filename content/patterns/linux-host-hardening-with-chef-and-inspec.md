---
title: Linux host hardening with Chef and InSpec
description: Apply a CIS-style Level 1 baseline to Linux VMs and build agents with Chef, and verify it continuously with InSpec.
type: pattern
tags:
  - patterns
  - chef
  - linux
  - security
  - compliance
created: 2026-10-17
modified: 2026-10-17
draft: false
aliases:
  - chef-inspec-hardening
---

This note describes a small, safe hardening baseline for Linux virtual machines and CI build agents: Chef resources apply it, InSpec controls prove it, and Test Kitchen runs both before a change reaches a real host. It is for senior DevOps engineers who still run long-lived hosts. Containers on GKE nodes follow [[compliance/cis-benchmarks-with-kube-bench]]; moving away from converged hosts to image-based builds is covered in [[runbooks/chef-to-immutable-images-migration]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Scope and sources
> Written for Chef Infra (the `sysctl`, `template`, `package` and `service` resources), Chef InSpec, Test Kitchen, and a generic Debian or Red Hat family Linux host. Based on the Chef and InSpec documentation and the sshd, sysctl and auditd manual pages. The baseline is "CIS-style Level 1": it follows the intent of the CIS Linux benchmarks for settings that rarely break workloads, and cites no benchmark item numbers.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: CIS benchmark versions and item numbers (none are cited), current Chef Infra and InSpec licensing terms and versions, the InSpec resource names used here, and the Test Kitchen driver and box names. Check them before relying on them.

## Baseline

Start with settings that have a clear security reason and a low chance of breaking applications. Anything stricter (the benchmark's Level 2) goes in a separate, opt-in profile.

| Area     | Setting                                                       | Why                                             |
| -------- | ------------------------------------------------------------- | ----------------------------------------------- |
| SSH      | `PermitRootLogin no`                                          | Forces named accounts and an audit trail        |
| SSH      | `PasswordAuthentication no`                                   | Removes password guessing; keys or SSO only     |
| SSH      | `MaxAuthTries 4`, `LoginGraceTime 60`                         | Limits brute force at the daemon                |
| Network  | `net.ipv4.conf.all.accept_redirects = 0`                      | Ignores ICMP redirects that can reroute traffic |
| Network  | `net.ipv4.conf.all.send_redirects = 0`                        | Hosts should not act as routers unless intended |
| Memory   | `kernel.randomize_va_space = 2`                               | Full address space layout randomisation         |
| Audit    | `auditd` installed, enabled and running                       | Records privileged and security-relevant events |
| Packages | No `telnet`, `rsh-server` or similar legacy servers installed | Removes insecure services entirely              |
| Users    | No accounts with an empty password; one root-level UID 0 only | Prevents shared or unauthenticated access       |

## Cookbook layout

Keep the baseline in its own cookbook so it can be applied to every role with one line.

```text
cookbooks/hardening/
  metadata.rb
  attributes/default.rb
  recipes/default.rb
  recipes/ssh.rb
  recipes/sysctl.rb
  recipes/auditd.rb
  templates/sshd_config.erb
  test/integration/default/controls/baseline_spec.rb
  kitchen.yml
```

Expose the choices as attributes (allowed SSH users, extra sysctl keys), so a role can adjust a value without copying the recipe.

## Recipes

The SSH recipe renders the config from a template and validates it with `sshd -t` before replacing the live file. A broken `sshd_config` that reaches a host is the most common way to lock yourself out, so the validation step is not optional.

```ruby title="cookbooks/hardening/recipes/default.rb"
include_recipe "hardening::ssh"
include_recipe "hardening::sysctl"
include_recipe "hardening::auditd"
```

```ruby title="cookbooks/hardening/recipes/ssh.rb"
ssh_service = platform_family?("debian") ? "ssh" : "sshd"

template "/etc/ssh/sshd_config" do
  source "sshd_config.erb"
  owner "root"
  group "root"
  mode "0600"
  variables(
    permit_root_login: "no",
    password_authentication: "no",
    max_auth_tries: 4,
    login_grace_time: 60
  )
  # Refuse to install a config the daemon cannot parse
  verify "sshd -t -f %{path}"
  notifies :reload, "service[#{ssh_service}]", :delayed
end

service ssh_service do
  action [:enable, :start]
end
```

```text title="cookbooks/hardening/templates/sshd_config.erb"
# Managed by Chef, do not edit by hand
PermitRootLogin <%= @permit_root_login %>
PasswordAuthentication <%= @password_authentication %>
PubkeyAuthentication yes
MaxAuthTries <%= @max_auth_tries %>
LoginGraceTime <%= @login_grace_time %>
UsePAM yes
X11Forwarding no

# Keep Include last: see the first-match rule below
Include /etc/ssh/sshd_config.d/*.conf
```

sshd uses the first value it reads for each keyword. An `Include` placed before the hardened directives lets a distribution or cloud-init drop-in (for example a cloud image file that sets `PasswordAuthentication yes`) win over the Chef value. The hardened directives therefore come first and the `Include` last, so a drop-in can only add keywords that the template leaves unset. An alternative is to leave the vendor main file alone and manage a drop-in such as `/etc/ssh/sshd_config.d/00-hardening.conf`, which sorts before other drop-ins; this works only where the main file already includes the directory, so check your images. The InSpec `sshd_config` resource reads only the main file and would pass while a weaker drop-in value applies, so the profile below checks the effective configuration instead.

The `Include` line and the `UsePAM` setting depend on the distribution and OpenSSH version, so check them against the host image you run. Keep any distribution-specific lines (for example the SFTP subsystem) in the template as well, or `sshd -t` will not catch what is missing.

```ruby title="cookbooks/hardening/recipes/sysctl.rb"
{
  "net.ipv4.conf.all.accept_redirects" => 0,
  "net.ipv4.conf.default.accept_redirects" => 0,
  "net.ipv4.conf.all.send_redirects" => 0,
  "kernel.randomize_va_space" => 2,
}.each do |key, setting|
  sysctl key do
    value setting
    action :apply
  end
end
```

```ruby title="cookbooks/hardening/recipes/auditd.rb"
# The package name differs by distribution family
audit_package = platform_family?("debian") ? "auditd" : "audit"

package audit_package do
  action :install
end

service "auditd" do
  action [:enable, :start]
end

# Legacy servers that should not be present (package names differ by family)
legacy_packages = platform_family?("debian") ? %w(telnetd rsh-server) : %w(telnet-server rsh-server)

legacy_packages.each do |legacy|
  package legacy do
    action :remove
  end
end
```

The `action :apply` form of `sysctl` writes the setting to a file under `/etc/sysctl.d` and loads it, so it survives a reboot. Check the behaviour of the resource in the Chef Infra version you run.

## InSpec profile

The same settings, written as tests. InSpec reads the real state of the host, so it catches changes made by hand or by another tool.

```ruby title="cookbooks/hardening/test/integration/default/controls/baseline_spec.rb"
# `sshd -T` prints the effective configuration, including drop-ins; it needs root
control "ssh-root-login" do
  impact 1.0
  title "SSH root login is disabled"
  describe command("sshd -T") do
    its("stdout") { should match(/^permitrootlogin no$/) }
  end
end

control "ssh-password-auth" do
  impact 1.0
  title "SSH password authentication is disabled"
  describe command("sshd -T") do
    its("stdout") { should match(/^passwordauthentication no$/) }
  end
end

control "sysctl-redirects" do
  impact 0.7
  title "ICMP redirects are not accepted or sent"
  describe kernel_parameter("net.ipv4.conf.all.accept_redirects") do
    its("value") { should eq 0 }
  end
  describe kernel_parameter("net.ipv4.conf.all.send_redirects") do
    its("value") { should eq 0 }
  end
end

control "sysctl-aslr" do
  impact 0.7
  title "Address space layout randomisation is enabled"
  describe kernel_parameter("kernel.randomize_va_space") do
    its("value") { should eq 2 }
  end
end

control "auditd-running" do
  impact 0.7
  title "auditd is installed, enabled and running"
  describe service("auditd") do
    it { should be_enabled }
    it { should be_running }
  end
end

control "single-uid-zero" do
  impact 1.0
  title "Only root has UID 0"
  # resource syntax: check against your InSpec version
  describe passwd.uids(0) do
    its("users") { should cmp ["root"] }
  end
end

control "no-empty-passwords" do
  impact 1.0
  title "No account has an empty password"
  describe shadow.where { password == "" } do
    its("users") { should be_empty }
  end
end
```

The `sshd_active_config` resource may offer the same check without a shell call where it is available (not verified). Label the controls with the same short names you use in the exceptions register, so a failing control maps to a decision. You can run the same profile against live hosts later, not only inside Test Kitchen.

## Running in CI with Test Kitchen

Test Kitchen converges the cookbook on a throwaway machine and runs the InSpec controls against it. A real VM (Vagrant) behaves like a production host; a container driver is faster but cannot test settings such as sysctl and auditd that need a real kernel and init system.

```yaml title="cookbooks/hardening/kitchen.yml"
driver:
  name: vagrant # change: your driver; containers (dokken) cannot test sysctl or auditd reliably

provisioner:
  name: chef_zero
  product_name: chef
  chef_license: accept-no-persist # change: accept the licence terms that apply to you

verifier:
  name: inspec

platforms:
  - name: ubuntu-22.04
    driver:
      box: bento/ubuntu-22.04 # change: box you trust and keep updated
  - name: rockylinux-9
    driver:
      box: bento/rockylinux-9 # change: box you trust and keep updated

suites:
  - name: default
    run_list:
      - recipe[hardening::default]
    verifier:
      inspec_tests:
        - test/integration/default
```

Test Kitchen with VMs needs a runner that can start them. Run it on a dedicated runner or nightly, not on every commit; run cookstyle and unit tests on every commit in GitLab CI, as in [[patterns/gitlab-ci-pipeline-structure]].

```bash
set -euo pipefail

cd cookbooks/hardening
kitchen test --destroy=always   # converge, verify, then destroy the machine
```

## Rolling out without lockouts

Hardening that locks you out of your own hosts is worse than none.

1. Keep a second way in. Before changing SSH settings, open a console session (cloud serial console or hypervisor console) and keep it open until the change is verified.
2. Apply to one host first. Run Chef in why-run mode, then converge a single non-critical host, and test a fresh login from a second terminal.
3. Roll out in rings: build agents, then stage, then production, with a pause between each. Use [[standards/production-change-checklist]] for the production step.
4. Check that your own access paths still work: key-based login for named users, the configuration management user, the monitoring agent, and any bastion or IAP route.
5. Only then turn on continuous convergence on a schedule.

## Drift

Between converges, people change things by hand and packages change files. Drift is when the host no longer matches the cookbook.

- Converge on a schedule (for example hourly) so drift is short lived, and alert when a converge fails.
- Run the InSpec profile separately from Chef, on a schedule, with the report sent to the evidence store. Chef shows what it did; InSpec shows what is true.
- When InSpec fails but Chef reports success, the cookbook is wrong or something changes the setting after Chef runs. Find the second writer before adding more retries.
- Lynis and OpenSCAP are alternatives for audit-style scans. Lynis is quick to run and good for finding gaps on an unknown host; OpenSCAP can scan against published security content. Use one of them for a second opinion, and keep InSpec as the test that gates changes.

## Pitfalls

- **Level 2 settings that break workloads.** Stricter mount options, disabled modules or restricted kernel features often break build agents, container runtimes or databases. Test them on the real workload first, and apply them per role.
- **Locking yourself out of SSH.** Keep a console session, validate the config with `sshd -t`, and test on one host first.
- **Different package and service names.** `auditd` and `audit`, `ssh` and `sshd` differ between families. Branch on platform family.
- **Drift between converges.** A manual fix on a host hides a cookbook bug until the next converge reverts it.
- **Testing only in containers.** Sysctl, auditd and the init system behave differently in a container.
- **Secrets in cookbooks.** Do not store keys or passwords in attributes; fetch them at run time from your secret store (see [[patterns/external-secrets-with-secret-manager]] for the Kubernetes side of the same idea).
- **Treating the baseline as finished.** Re-read it when the OS version changes.

## Verify

Check the live host directly, then run the profile.

```bash
set -euo pipefail

# Effective sshd settings (run as root on the host)
sudo sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|maxauthtries|logingracetime) '

# Kernel settings
sysctl net.ipv4.conf.all.accept_redirects net.ipv4.conf.all.send_redirects kernel.randomize_va_space

# auditd state
systemctl is-enabled auditd
systemctl is-active auditd

# Run the InSpec profile locally against this host (root is needed to read /etc/shadow and run sshd -T)
sudo inspec exec cookbooks/hardening/test/integration/default
```

Expected: `permitrootlogin no`, `passwordauthentication no`, the sysctl values `0`, `0` and `2`, `enabled`, `active`, and an InSpec summary with zero failed controls.

## Rollback

Chef templates replace the file, so keep the previous version.

- Revert the cookbook change and converge. For SSH, do this from the console session you kept open.
- If the new `sshd_config` was installed and broke access, restore the backup Chef saves for replaced files (check the `file_backup_path` setting) from the console, then run `sshd -t` and reload the service.
- Sysctl values can be put back at runtime with `sysctl -w key=value` and by removing the managed file under `/etc/sysctl.d`.
- If the host is part of a pool, take it out of rotation, rebuild it from the last good image, and investigate afterwards.

## Related

- [[compliance/cis-benchmarks-with-kube-bench]]: the Kubernetes counterpart of this baseline.
- [[runbooks/chef-to-immutable-images-migration]]: when you no longer want converged hosts.
- [[standards/production-change-checklist]]: the steps for the production rollout ring.
- [[runbooks/leaked-credential-rotation]]: what to do if a host key or password is exposed.
- [[patterns/gitlab-ci-pipeline-structure]]: where to run cookstyle and the lint stage.
