---
title: "Config 01: Chef basics: cookbooks, resources, idempotence, Test Kitchen and InSpec"
description: Write a Chef cookbook that converges a host to a declared state, prove it is idempotent with Test Kitchen and verify it with InSpec and Cookstyle.
type: guide
tags:
  - learning
  - chef
  - linux
  - security
  - reliability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

> [!info] Level: junior-middle | Time: about 4 h | You need: [[learn/linux-services-packages-and-scheduled-jobs|Linux 05: systemd services, packages and scheduled jobs]] and [[learn/safe-bash-scripts|Scripting 02: Safe Bash: strict mode, traps and ShellCheck]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]], with Docker installed for Test Kitchen's container driver; no Chef Infra Server is needed

Many fleets still converge long-lived Linux hosts with Chef: build agents, legacy VMs, appliances that cannot be rebuilt from an image every week. If you are on call for them, you need to read a cookbook, predict what a run will change, and prove a change is safe before it reaches a real host. This lesson teaches exactly that: what Chef's moving parts are, how a **resource** declares state instead of steps, why **idempotence** is the whole point, and how **Test Kitchen**, **InSpec** and **Cookstyle** catch mistakes on a throwaway container instead of on production.

New hosts here are built from images instead ([[adr/0041-retire-chef-for-immutable-images|ADR 0041]]), so treat this lesson as the skill you need to run, fix and eventually migrate the Chef estate you inherit, not as a recommendation to start a new one.

> [!note] Most of this page was not run
> Chef's tools ask you to accept a licence before they run, and that was not done for this page. So the cookbook generator, Chef Infra Client, InSpec and the Test Kitchen converge and verify steps were **not** run: their commands follow the Chef documentation and source code, and their output is illustrative. Two helper steps were run: Cookstyle 9.0.0 (its offence output below is real) and `kitchen list` with Test Kitchen 4.1.5 on a `kitchen.yml` of the shape used here. Chef's packaging and licensing are changing; everything marked "check the current docs" must be checked against the version you install.

## What you will learn

- Where configuration management fits next to immutable images, and when you still need it.
- The Chef vocabulary: Infra Client, Infra Server, Workstation, cookbook, recipe, resource, attribute, template, data bag and Policyfile.
- How resources, actions, guards and notifications make a run idempotent, and why a bare `execute` breaks that.
- How to run a cookbook safely: why-run mode, local mode, and a Policyfile lock that pins what runs.
- How to test a cookbook with Test Kitchen (create, converge, verify, destroy), check the result with InSpec controls, and lint it with Cookstyle.

## Configuration management versus immutable images

There are two ways to get a host into a known state:

- **Converge it in place.** An agent on the host (Chef Infra Client) reads a description of the desired state and changes whatever differs: installs a package, rewrites a file, restarts a service. The host lives for months and is converged again every run, so drift is corrected.
- **Bake an image and replace the host.** A build (Packer, a Dockerfile) produces an image with everything already in it. To change a host you build a new image and replace the host. Nothing is changed in place.

Images win on repeatability and rollback (redeploy the previous image), which is why [[adr/0041-retire-chef-for-immutable-images|ADR 0041]] retires Chef for new hosts and [[tools/packer-vs-chef-for-images]] compares the two in detail. Convergence still earns its place where hosts cannot be replaced cheaply, where state must be enforced continuously (a hardening baseline, see [[patterns/linux-host-hardening-with-chef-and-inspec]]), and as a step inside an image build. [[tools/ansible-vs-chef-vs-salt]] compares Chef with the other tools you will meet. The migration path is in [[runbooks/chef-to-immutable-images-migration]].

## The Chef vocabulary

- **Chef Infra Client**: the agent that runs on a node and converges it. A run is called a **converge**.
- **Chef Infra Server**: a central store for cookbooks, policies and node data that clients pull from. This lesson does not use one; you run cookbooks locally and in Test Kitchen.
- **Chef Workstation**: the bundle you install on your own machine: the `chef` command (or `chef-cli`), Test Kitchen, InSpec and Cookstyle.
- **Node**: a host managed by Chef, with **attributes** (facts it discovered, such as the platform, plus values set by cookbooks).
- **Cookbook**: the unit you version and share. It holds recipes, templates, files, attributes, tests and a `metadata.rb` with its name, version and dependencies.
- **Recipe**: a Ruby file in `recipes/` that declares resources, in order.
- **Resource**: one piece of desired state: a `package`, a `service`, a `template`, a `file`, a `user`. Each has a type, a name, **properties** and an **action**.
- **Attribute**: a value a recipe reads from `node[...]`, with defaults in `attributes/default.rb` that policies or roles can override.
- **Template**: an ERB file in `templates/` that a `template` resource renders with variables.
- **Data bag**: JSON items stored on the Chef Infra Server, read by recipes (per-environment settings, user lists). Encrypted data bags exist for secrets; a real secrets manager is the better home for them.
- **Run-list**: the ordered list of recipes a node runs, for example `recipe[web_lab::default]`.
- **Policyfile**: a file that names the run-list and the cookbook sources, compiled into a lock file that pins every cookbook to an exact version. It replaces the older roles, environments and Berkshelf combination for new work.

A Chef run has two phases, and confusing them is the root of many bugs:

1. **Compile phase.** Chef evaluates every recipe as Ruby, top to bottom, and builds a list of resources (the resource collection). Plain Ruby in a recipe runs **now**.
2. **Converge phase.** Chef walks the list in order. For each resource it checks the current state, and runs the action only if the state differs.

So `File.read('/etc/foo')` at the top of a recipe runs before any resource has created `/etc/foo`. When a property must be computed at converge time, wrap it in `lazy { ... }`.

## Install Chef Workstation, and the licence question

> [!warning] Accept the licence yourself, deliberately
> Chef's commercial distributions require you to accept a licence before the tools run: the InSpec README says all currently supported versions (5.0 and later) require accepting the EULA, and `chef-cli` refuses to run without it. Nobody, including this page, can accept it for you. Read the current licensing page on docs.chef.io, decide whether its terms (and any licence key it asks for) apply to you, and only then accept. Exit code 172 from a Chef tool means the licence was not accepted.

You have two routes, and the rest of the lesson works with either:

- **Chef Workstation**, from the Chef downloads page, with the licence accepted (or a licence key added) under the terms that apply to you. Check the docs for the current package and for how licence keys work for your version (recent releases add licence-key options such as `inspec license add`, and a `--license-add` option in Chef Infra Client's command-line code).
- **Cinc**, the community distribution built from the same open-source code, for learning without the commercial licence. Check its own documentation for the matching Workstation and Test Kitchen setup; it was not verified for this page.

Then check what you have:

```bash
chef --version 2>/dev/null || chef-cli --version
kitchen version
cookstyle --version
inspec version
```

```text
Chef Workstation version: <PINNED_VERSION>
Chef Infra Client version: <PINNED_VERSION>
Chef InSpec version: <PINNED_VERSION>
Chef CLI version: <PINNED_VERSION>
Test Kitchen version: <PINNED_VERSION>
Cookstyle version: <PINNED_VERSION>
```

_Illustrative: the exact lines differ per release. Write the versions you got into your notes; the support policy covers the current and previous major release of Chef Infra Client, so check the current support schedule before you pin._

The licence can be accepted per command (`--chef-license accept`, `accept-silent` or `accept-no-persist`) or with the `CHEF_LICENSE` environment variable using the same values. `accept-no-persist` accepts for one run and writes nothing to disk, which suits CI. Acceptance is per user: marker files go to `/etc/chef/accepted_licenses/` for root and `~/.chef/accepted_licenses/` for other users. Newer releases add licence keys; check the docs for how they combine with these flags.

## A cookbook from the generator

The generator writes a cookbook skeleton with tests, a Policyfile and a Test Kitchen file. The command is `chef generate cookbook` in Chef Workstation and `chef-cli generate cookbook` when you installed the `chef-cli` gem; both take the same options.

```bash
mkdir -p ~/chef-lab && cd ~/chef-lab
chef generate cookbook web_lab --kitchen dokken
tree -a -L 2 web_lab
```

```text
web_lab
├── CHANGELOG.md
├── LICENSE
├── Policyfile.rb
├── README.md
├── chefignore
├── compliance
│   ├── README.md
│   ├── inputs
│   ├── profiles
│   └── waivers
├── kitchen.yml
├── metadata.rb
├── recipes
│   └── default.rb
└── test
    └── integration
```

_Illustrative: the generator was not run for this page. The file list follows the generator's skeleton in the chef-cli source._

Useful generator options: `--kitchen dokken|vagrant` picks the Test Kitchen driver (Vagrant is the default), `-P/--policy` uses a Policyfile (the default), `-b/--berks` uses Berkshelf instead, `-s/--specs` adds ChefSpec unit-test samples and `--yaml` writes recipes in YAML. `metadata.rb` starts at `version '0.1.0'` with a `chef_version` constraint; bump the version on every change you ship.

## Resources: declare the state, not the steps

A resource says what must be true. Chef works out whether it already is.

```ruby title="web_lab/recipes/default.rb"
package 'nginx'

template '/etc/nginx/sites-available/default' do
  source 'default-site.erb'
  owner 'root'
  group 'root'
  mode '0644'
  variables(
    port: node['web_lab']['port'],
    server_name: node['web_lab']['server_name']
  )
  notifies :reload, 'service[nginx]', :delayed
end

file '/var/www/html/index.html' do
  content "web_lab is managed by Chef\n"
  owner 'root'
  group 'root'
  mode '0644'
end

service 'nginx' do
  action [:enable, :start]
end
```

```ruby title="web_lab/attributes/default.rb"
default['web_lab']['port'] = 80
default['web_lab']['server_name'] = 'lab.example.com'
```

```erb title="web_lab/templates/default-site.erb"
# Managed by Chef (cookbook web_lab). Local edits are overwritten.
server {
    listen <%= @port %> default_server;
    server_name <%= @server_name %>;
    root /var/www/html;
    index index.html;
}
```

What each resource does by default matters more than it looks:

| Resource   | Default action | Other actions you will use                          | Trap                                                          |
| ---------- | -------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `package`  | `:install`     | `:upgrade`, `:remove`, `:purge`, `:lock`            | `:upgrade` changes versions on every run that sees a new one. |
| `service`  | `:nothing`     | `:enable`, `:start`, `:restart`, `:reload`, `:stop` | A bare `service 'nginx'` does nothing at all.                 |
| `template` | `:create`      | `:create_if_missing`, `:delete`                     | Renders from the cookbook's `templates/` directory.           |
| `file`     | `:create`      | `:create_if_missing`, `:delete`, `:touch`           | `:touch` changes the timestamp every run.                     |
| `execute`  | `:run`         | `:nothing` (run only when notified)                 | Runs on **every** converge unless guarded.                    |

The `service` row is the one that bites: because its default action is `:nothing`, you must say `action [:enable, :start]` or the service is never started at boot or now.

## Idempotence and guards

A recipe is **idempotent** when running it twice in a row changes nothing the second time. Built-in resources such as `package`, `file` and `template` are idempotent because they compare current and desired state first. `execute` and `bash` are not: Chef cannot know what an arbitrary command does, so it runs it every time.

This is wrong, and grows `/etc/issue.net` by one line per run:

```ruby
execute 'login banner' do
  command "echo 'Authorised use only' >> /etc/issue.net"
end
```

Two fixes, best first:

```ruby
# Best: describe the whole file as state. Idempotent by construction.
file '/etc/issue.net' do
  content "Authorised use only\n"
  mode '0644'
end

# When a command is unavoidable: guard it so it runs only when needed.
execute 'login banner' do
  command "echo 'Authorised use only' >> /etc/issue.net"
  not_if { ::File.exist?('/etc/issue.net') && ::File.read('/etc/issue.net').include?('Authorised use only') }
end
```

Guards are `only_if` (run only if the condition is true) and `not_if` (skip if it is true). They take a Ruby block, evaluated just before the action, or a command string whose exit status decides (0 counts as true). Prefer the Ruby block: it does not start a shell, and Cookstyle flags the shell form for simple file tests. `execute` also has `creates '/path'`, which skips the command when that path exists, the simplest guard for "run an installer once".

## Notifications: delayed, immediately and before

A resource that changed something can tell another resource to act: the template above asks `service[nginx]` to reload, but only when the template actually changed the file.

```ruby
notifies :reload, 'service[nginx]', :delayed      # default timing
notifies :restart, 'service[nginx]', :immediately
subscribes :reload, 'template[/etc/nginx/sites-available/default]', :delayed
```

- `:delayed` (the default) queues the action until the end of the run, and runs it **once** however many resources notified it. Use it for restarts and reloads, so five config changes give one reload.
- `:immediately` (also spelled `:immediate`) runs the action right after the notifying resource. Use it when a later resource needs the result now.
- `:before` runs the action just before the notifying resource changes anything, for example to stop a service before replacing its binary.
- `subscribes` is the same link written from the other side.

The usual idiom for "do this only when notified" is a resource with `action :nothing`:

```ruby
execute 'nginx config test' do
  command 'nginx -t'
  action :nothing
  subscribes :run, 'template[/etc/nginx/sites-available/default]', :immediately
end
```

If the test fails, the run fails before the delayed reload, so a broken config never reaches the running nginx.

## Running safely: why-run and local mode

`chef-client` (the Chef Infra Client binary) has two options you will use constantly:

- `-W` / `--why-run`: report what **would** change, change nothing. Read it before every run on a host you care about. It cannot predict everything: a resource whose state depends on an earlier resource's change, or a guard that shells out, is reported as an assumption.
- `-z` / `--local-mode`: run against a local repository through an in-memory server, with no Chef Infra Server. Add `-o` / `--override-runlist` for a one-off run-list that is not saved.

```bash
# From a chef-repo directory whose cookbooks/ folder holds web_lab:
sudo chef-client -z -W -o 'recipe[web_lab]'
```

```text
  * template[/etc/nginx/sites-available/default] action create
    - Would update content in file /etc/nginx/sites-available/default from 1f2c3a to 9b8e7d
  * service[nginx] action reload
    - Would reload service service[nginx]
```

_Illustrative, and the local-mode invocation with a cookbook path was not run for this page; check `chef-client --help` and the local mode docs for your version._

## Policyfiles: pin exactly what runs

A Policyfile names the run-list and where cookbooks come from. The generated one looks like this:

```ruby title="web_lab/Policyfile.rb"
name 'web_lab'
default_source :supermarket
run_list 'web_lab::default'
cookbook 'web_lab', path: '.'
```

- `chef install` resolves every cookbook and writes `Policyfile.lock.json`, with each cookbook pinned to an exact version and checksum.
- `chef update` re-resolves and rewrites the lock.
- `chef diff` compares two locks, so a review shows exactly which cookbook versions change.
- `chef push <POLICY_GROUP>` uploads the locked policy to a Chef Infra Server for a group of nodes (for example `staging`, then `production`).

Commit the lock file. Promotion is then "push the same lock to the next group", and a rollback is "push the previous lock". Test Kitchen uses the Policyfile too, so the lab tests the same cookbook set that production gets.

## Test Kitchen: create, converge, verify, destroy

Test Kitchen builds a disposable instance, converges your cookbook on it, runs tests, and throws it away. The configuration is `kitchen.yml`. With the `dokken` driver, each instance is a Docker container started with systemd, which is fast and runs on your lab VM:

```yaml title="web_lab/kitchen.yml"
driver:
  name: dokken
  privileged: true # allows systemd services to start in the container
  chef_version: <PINNED_VERSION> # change: the Chef Infra Client version your fleet runs

transport:
  name: dokken

provisioner:
  name: dokken
  chef_license: accept-no-persist # change: only after you accepted the licence terms that apply to you
  multiple_converge: 2 # converge twice...
  enforce_idempotency: true # ...and fail if the second run still changed something

verifier:
  name: inspec

platforms:
  - name: ubuntu-24.04
    driver:
      image: dokken/ubuntu-24.04
      pid_one_command: /bin/systemd
      intermediate_instructions:
        - RUN /usr/bin/apt-get update

suites:
  - name: default
    verifier:
      inspec_tests:
        - test/integration/default
```

`multiple_converge` and `enforce_idempotency` are provisioner options (defaults 1 and false); together they turn "the second converge must change nothing" into a test that fails the build. They were documented for the Chef provisioners; check that the dokken provisioner you install honours them.

The lifecycle commands:

| Command            | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `kitchen list`     | Shows instances and their last action.                                 |
| `kitchen create`   | Starts the instance.                                                   |
| `kitchen converge` | Installs Chef if needed and runs the cookbook. Run it again to retest. |
| `kitchen verify`   | Runs the InSpec tests against the instance.                            |
| `kitchen login`    | Opens a shell on the instance, for debugging.                          |
| `kitchen destroy`  | Deletes the instance.                                                  |
| `kitchen test`     | Destroy, create, converge, setup, verify, destroy, in one go.          |

`kitchen test` stops at the first failure and, with the default `--destroy passing`, leaves a failed instance running so you can `kitchen login` and look. Instance names join suite and platform and drop the dots:

```bash
cd ~/chef-lab/web_lab
kitchen list
```

```text
Instance             Driver  Provisioner  Verifier  Transport  Last Action    Last Error
default-ubuntu-2404  Dokken  Dokken       Inspec    Dokken     <Not Created>  <None>
```

_This output was observed with Test Kitchen 4.1.5._

> [!warning] Know which provisioner you depend on
> The older `chef_infra` provisioner (the `kitchen-omnibus-chef` plugin, used with the Vagrant driver) downloads Chef through a service its own README says is being shut down for some versions, and is not compatible with Chef Infra Client 19's new installation method. That README points Chef customers to `kitchen-chef-enterprise` and community users to `kitchen-cinc`. Check which plugin your Workstation version bundles before you copy an old `kitchen.yml`. A container is also not a perfect stand-in for a full OS: kitchen-dokken's README says so, and recommends the Vagrant driver when you need a faithful VM.

## InSpec: prove the state from the outside

The cookbook says what should be true; an InSpec control checks it independently, from outside Chef. Controls are Ruby files in a profile (`inspec.yml` plus `controls/`), or, for Test Kitchen, the files under `test/integration/default/`.

```ruby title="web_lab/test/integration/default/default_test.rb"
control 'web-01' do
  impact 0.7
  title 'nginx is installed, enabled and running'
  describe package('nginx') do
    it { should be_installed }
  end
  describe service('nginx') do
    it { should be_installed }
    it { should be_enabled }
    it { should be_running }
  end
  describe port(80) do
    it { should be_listening }
  end
end

control 'web-02' do
  impact 0.5
  title 'the site config is root-owned, not world-writable and listens on 80'
  describe file('/etc/nginx/sites-available/default') do
    it { should be_file }
    it { should be_owned_by 'root' }
    its('mode') { should cmp '0644' }
    its('content') { should match(/listen 80 default_server;/) }
  end
end
```

`impact` is a number from 0.0 to 1.0: 0.7 to 0.9 is high, 0.4 to 0.7 medium. Use `cmp` rather than `eq` for modes, because `cmp` compares `'0644'` and `420` sensibly.

Outside Test Kitchen you run a profile with `inspec exec`, against the local machine or a remote host:

```bash
inspec check ./profile
inspec exec ./profile                          # this machine
inspec exec ./profile -t ssh://ubuntu@203.0.113.10 -i ~/.ssh/id_ed25519   # a remote host
echo "exit: $?"
```

Exit codes matter in CI: 0 all passed, 100 at least one test failed, 101 some skipped and none failed, 172 licence not accepted. A pipeline that treats every non-zero code alike will fail on skips; decide deliberately whether 101 passes.

## Cookstyle: lint before you converge

Cookstyle is a RuboCop-based linter with Chef-specific rules ("cops"). New cops start failing builds only once a year, at the April major release, so pin the version in CI and upgrade on purpose.

A test cookbook named `demo`, with a shell-form guard and a hand-rolled platform check in `recipes/bad.rb`:

```bash
cookstyle demo
```

```text
Inspecting 3 files
.C.
demo/recipes/bad.rb:17:3: R: [Correctable] Chef/Modernize/ConditionalUsingTest: Use only_if { ::File.exist?('/foo/bar') } instead of the slower only_if 'test -f /foo/bar' which requires shelling out (...)
demo/recipes/bad.rb:20:4: R: [Correctable] Chef/Style/UsePlatformHelpers: Use platform? and platform_family? helpers to check a node's platform (...)
demo/recipes/bad.rb:2:12: C: [Correctable] Style/HashSyntax: Use the new Ruby 1.9 hash syntax. ...
3 files inspected, 6 offenses detected, 6 offenses autocorrectable
```

_Observed with Cookstyle 9.0.0; lines shortened. A clean cookbook prints `no offenses detected`._

`cookstyle -a` applies RuboCop's safe autocorrections (check `cookstyle --help` for the flags in your version). Cookstyle does **not** catch an unguarded `execute`: that one was observed passing without an offence. Idempotence is proven by the double converge, not by the linter.

## Hands-on exercises

Work in `~/chef-lab` on your lab VM, with Docker running and Chef Workstation (or Cinc) installed and its licence handled as above. All output is illustrative unless the step says it was observed.

1. **Check the toolchain.**

   ```bash
   docker info --format '{{.ServerVersion}}'
   chef --version 2>/dev/null || chef-cli --version
   kitchen version && cookstyle --version
   ```

   Expected: a Docker server version and one version line per Chef tool.
   If you see something else: exit code 172 or "cannot execute without accepting the license" means the licence step is still open. "Cannot connect to the Docker daemon" means Docker is not running or your user is not in the `docker` group (log out and in after adding it).

2. **Generate the cookbook and list the instance.**

   ```bash
   cd ~/chef-lab
   chef generate cookbook web_lab --kitchen dokken
   cd web_lab && kitchen list
   ```

   Expected: the skeleton above and one instance, `default-ubuntu-2404`, in state `<Not Created>`.
   If you see something else: if the platform is different, edit `platforms:` in `kitchen.yml` to `ubuntu-24.04` with the dokken image from the example. A YAML error names the line; check indentation.

3. **Write the nginx recipe with a template and a notification.** Create `attributes/default.rb`, `templates/default-site.erb` and `recipes/default.rb` from the resources section, and replace `kitchen.yml` with the example (fill in `chef_version`). Then converge:

   ```bash
   kitchen converge
   ```

   ```text
   -----> Converging <default-ubuntu-2404>...
          Recipe: web_lab::default
            * apt_package[nginx] action install
              - install version <version> of package nginx
            * template[/etc/nginx/sites-available/default] action create
              - update content in file /etc/nginx/sites-available/default from 9a4f1e to 3c7d02
            * file[/var/www/html/index.html] action create
              - update content in file /var/www/html/index.html from e3b0c4 to 5b1a9c
            * service[nginx] action enable (up to date)
            * service[nginx] action start (up to date)
            * service[nginx] action reload
              - reload service service[nginx]
          Infra Phase complete, 4/6 resources updated in 18 seconds
          ...
          Infra Phase complete, 0/6 resources updated in 02 seconds
   ```

   Expected: the first converge updates resources and ends with one delayed reload; the second (from `multiple_converge: 2`) updates **0** resources.
   If you see something else: ``undefined method `[]' for nil`` on `node['web_lab']` means the attributes file is missing or misnamed. A failed second run with `enforce_idempotency` names the resource that changed again: that is the bug to fix.

4. **Write the InSpec tests and verify.** Put the two controls from the InSpec section in `test/integration/default/default_test.rb` (replace the generated file), then:

   ```bash
   kitchen verify
   ```

   ```text
   Profile: tests from {:path=>"/home/ubuntu/chef-lab/web_lab/test/integration/default"}
     ✔  web-01: nginx is installed, enabled and running
     ✔  web-02: the site config is root-owned, not world-writable and listens on 80
   Profile Summary: 2 successful controls, 0 control failures, 0 controls skipped
   ```

   Expected: two passing controls.
   If you see something else: a failing `be_enabled` inside a container can be a detection limit of the container, not your cookbook; `kitchen login` and run `systemctl is-enabled nginx` to see the truth. A failing `mode` check means the template's `mode` differs from the test; decide which is right.

5. **Break idempotence on purpose, then fix it.** Add the bad `execute 'login banner'` from the idempotence section to the recipe and run `kitchen converge`.
   Expected: the second converge reports `1/7 resources updated` and the run fails on the idempotence check; `kitchen login` then `cat /etc/issue.net` shows the line twice.
   Now replace it with the `file '/etc/issue.net'` version, converge again, and check the second run updates 0 resources.
   If you see something else: if the broken version passes, check that `multiple_converge: 2` and `enforce_idempotency: true` are under `provisioner:` and that your provisioner supports them; without them, run `kitchen converge` twice yourself and read the count.

6. **Lint with Cookstyle.** Add a resource with a shell-form guard, for example `only_if 'test -f /etc/nginx/nginx.conf'` on the `file` resource, and run:

   ```bash
   cookstyle .
   ```

   Expected: a `Chef/Modernize/ConditionalUsingTest` offence pointing at that line. Change it to `only_if { ::File.exist?('/etc/nginx/nginx.conf') }` and rerun until it prints `no offenses detected`.
   If you see something else: offences in files you did not touch come from the generator's defaults or a newer Cookstyle; read each before autocorrecting.

7. **Prove the delayed notification fires only on change.** Change `server_name` in `attributes/default.rb`, run `kitchen converge`, then run it again without changes.
   Expected: the first run shows the template update and one `reload`; the second shows neither.
   If you see something else: a reload on every run means something upstream of the notification changes every time (for example a template variable built from the time). Find it with the converge output.

8. **Lock the policy and clean up.**

   ```bash
   chef install
   git add Policyfile.rb Policyfile.lock.json
   kitchen destroy
   docker ps --filter name=default-ubuntu-2404
   ```

   Expected: `Policyfile.lock.json` exists with `web_lab` pinned, the instance is destroyed and `docker ps` lists nothing for it.
   If you see something else: a leftover container after `destroy` can be removed with `docker rm -f <id>`; the dokken driver also keeps helper containers and volumes, which `kitchen destroy` handles for the instances it knows.

## Common mistakes

- **A bare `service 'nginx'`.** Its default action is `:nothing`, so nothing happens. Always write `action [:enable, :start]`.
- **Unguarded `execute` and `bash`.** They run every converge, and Cookstyle does not catch it. Prefer a declarative resource; otherwise add `creates`, `only_if` or `not_if`, and keep `enforce_idempotency` on in Kitchen.
- **`:immediately` restarts everywhere.** Five config files with immediate restarts give five restarts per run. Use `:delayed` unless a later resource needs the service now.
- **Ruby that reads the system at compile time.** It runs before any resource has converged. Use guards or `lazy { }` for values that depend on earlier resources.
- **Editing a managed file by hand on the host.** The next converge overwrites it. Change the cookbook, bump its version, and let the run apply it.
- **Floating cookbook versions.** Without a committed Policyfile lock, a dependency release can change production at the next run. Lock, review `chef diff`, then push.
- **Accepting the licence in a shared image or script without reading it.** Acceptance is a legal act per user; record who accepted what, and use `accept-no-persist` in CI only after that decision.
- **Trusting a container test for kernel or boot behaviour.** Containers share the host kernel. Test sysctl, mounts and boot-time services on the Vagrant driver or a real VM.

## Check your understanding

1. What is the difference between the compile and converge phases, and which one runs a plain `File.read` at the top of a recipe?
2. Why does `service 'nginx'` with no action do nothing, and what do you write instead?
3. Five templates notify `service[nginx]` with `:reload, :delayed`, and three of them change. How many reloads happen, and when?
4. How do you make Test Kitchen fail a change that is not idempotent?
5. What does a Policyfile lock give you that a run-list in a role does not?
6. An InSpec run in CI exits with 101. What happened, and should the pipeline fail?

> [!question]- Answers
>
> 1. The compile phase evaluates the recipes as Ruby and builds the resource list; the converge phase then applies each resource in order. Plain Ruby, including `File.read`, runs in the compile phase, before any resource has changed the system.
> 2. The `service` resource's default action is `:nothing`. Write `action [:enable, :start]` (and let config changes notify `:reload` or `:restart`).
> 3. One reload, at the end of the run. Delayed notifications are queued and de-duplicated per resource and action.
> 4. Set the provisioner options `multiple_converge: 2` and `enforce_idempotency: true` in `kitchen.yml`; the run fails if the last converge still updates a resource.
> 5. Every cookbook, including dependencies, pinned to an exact version and checksum, reviewable with `chef diff` and promoted by pushing the same lock to the next policy group. A role's run-list does not pin versions.
> 6. At least one control was skipped and none failed. Whether it should fail depends on your policy: a skip can hide a test that never runs, so many teams fail on 101 in compliance pipelines and allow it elsewhere, on purpose.

## Next steps

This is the first lesson of the Config track. Next lesson: [[learn/supply-chain-sboms-signing-and-verification|Security 02: SBOMs, signing and verifying images, and attestations]]. Previous lesson: [[learn/spinnaker-basics-applications-pipelines-and-judgment|Delivery 12: Spinnaker basics]]. The whole path is mapped in [[learn/index|the learning path]].

To go deeper:

- [[patterns/linux-host-hardening-with-chef-and-inspec]] for a real baseline with Chef resources and InSpec controls.
- [[tools/ansible-vs-chef-vs-salt]] and [[tools/packer-vs-chef-for-images]] for choosing the tool.
- [[adr/0041-retire-chef-for-immutable-images]], [[adr/0040-golden-base-images-owned-by-platform]] and [[runbooks/chef-to-immutable-images-migration]] for where the estate is heading and how to move a role off Chef.
- [[learn/linux-users-permissions-sudo-and-ssh]] for the users, modes and SSH settings a cookbook typically manages.
- [[management/end-of-life-tracking-platform-versions]] for tracking Chef Infra Client support dates with the rest of the platform.

## Sources

- Chef documentation (https://docs.chef.io/): Chef Infra Client overview, the resources reference (`package`, `service`, `template`, `file`, `execute`, notifications and guards), Policyfiles, Chef Workstation, Cookstyle and licensing. Resource defaults and allowed actions, notification timings and guard semantics were checked against the `chef/chef` source on 2026-10-21, not the published pages.
- Chef InSpec documentation (https://docs.chef.io/inspec/) and the InSpec repository (https://github.com/inspec/inspec): profiles, controls, impact bands, the resources and matchers used here, the CLI exit codes and the EULA requirement for versions 5.0 and later.
- chef-cli repository (https://github.com/chef/chef-cli): the `generate cookbook` options and skeleton, and the Policyfile commands `install`, `update`, `diff` and `push`.
- Test Kitchen (https://kitchen.ci/) and its repository (https://github.com/test-kitchen/test-kitchen): the lifecycle commands, `kitchen test` order, `--destroy` default and the `multiple_converge` and `enforce_idempotency` options. `kitchen list` was run with Test Kitchen 4.1.5.
- kitchen-dokken (https://github.com/test-kitchen/kitchen-dokken) and kitchen-omnibus-chef (https://github.com/test-kitchen/kitchen-omnibus-chef) READMEs: the dokken settings, the container caveat and the deprecation notice for the omnibus provisioner.
- license-acceptance (https://github.com/chef/license-acceptance): the `--chef-license` values, `CHEF_LICENSE`, exit code 172 and marker file locations. That README predates licence keys.
- Cookstyle (https://github.com/chef/cookstyle): the April release policy for new cops. The offence output above was observed with Cookstyle 9.0.0 on Ruby 3.3.
- Cinc (https://cinc.sh/): the community distribution, not verified for this page.
- Not verified: everything the licence gate blocked (cookbook generation, `chef-client` runs including local mode, `kitchen converge` and `verify`, `inspec exec`), so all of their output is illustrative; whether the dokken provisioner honours `multiple_converge` and `enforce_idempotency`; Workstation package names and current versions; how licence keys, free tiers and Chef Infra Client 19 installation work; the Cinc and `kitchen-chef-enterprise` setup; `chef-client` local-mode paths. Check the current docs.
