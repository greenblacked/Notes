---
title: "Linux 05: systemd services, packages and scheduled jobs"
description: Run, harden and debug long-running services with systemd, install and update packages safely with apt and dnf, and schedule jobs with cron or timers.
type: guide
tags:
  - learning
  - linux
  - reliability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 6 h | You need: [[learn/linux-processes-memory-and-disk|Linux 04: Processes, memory and disk]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]] (containers have no systemd, so Option B cannot do the first half)

A server is useful because programs keep running on it without a person typing commands: a web server, an agent, a nightly backup. Three tools keep that true. **systemd** starts and restarts the programs. The **package manager** installs and updates them. **cron or systemd timers** run the jobs that are not long-running. Most "the service is down" incidents end in one of these three places, so this lesson teaches how each one works and how to read what it tells you.

## What you will learn

- What PID 1 is, what a unit is, and what `enable` actually creates on disk.
- How to read and write a service unit, override a vendor unit with a drop-in, and find out why a service crash-loops.
- How to read the journal with `journalctl` and keep it across reboots.
- How to update packages with `apt` and `dnf` using a repeatable sequence: simulate, review, apply, then check for restarts.
- How to write a cron job that does not fail silently, and when to use a systemd timer instead.
- How to notice that a scheduled job has failed.

## systemd: PID 1 and units

When the kernel finishes starting, it runs one program as **PID 1**, the first process. On nearly every current mainstream distribution (Ubuntu, Debian, RHEL and its relatives) that program is **systemd**. Every other process descends from it. PID 1 has two jobs: start the machine's services in the right order, and adopt and clean up orphaned processes.

systemd manages **units**. A unit is a small text file that describes one thing to manage. The file suffix says what kind:

| Suffix     | What it describes                                   |
| ---------- | --------------------------------------------------- |
| `.service` | A program that systemd starts and watches           |
| `.timer`   | A schedule that starts another unit                 |
| `.target`  | A named group of units, such as `multi-user.target` |
| `.socket`  | A listening socket that starts a service on demand  |
| `.mount`   | A filesystem mount point                            |

A **target** is a synchronisation point rather than a program. `multi-user.target` means "the system is up for normal multi-user work without a graphical session", and it is the usual default on a server. Check yours:

```bash
systemctl get-default
systemctl is-system-running
ps -o pid,comm -p 1
```

Illustrative output:

```text
multi-user.target
running
    PID COMMAND
      1 systemd
```

If `is-system-running` prints `degraded`, at least one unit failed during boot. `systemctl --failed` lists which.

### The everyday commands

```bash
systemctl status ssh              # state, recent log lines, main PID
sudo systemctl start nginx        # start now (does not survive a reboot)
sudo systemctl stop nginx
sudo systemctl restart nginx      # stop then start: drops connections
sudo systemctl reload nginx       # ask the program to re-read its config
sudo systemctl enable --now nginx # start now AND at every boot
systemctl list-units --type=service --state=failed
systemctl is-active nginx
systemctl is-enabled nginx
```

Two pairs of words are easy to mix up:

- **active** vs **enabled.** Active means "running now". Enabled means "will be started at boot". A service can be one without the other. `start` changes the first, `enable` changes the second, and `enable --now` does both.
- **restart** vs **reload.** Restart kills the process and starts a new one. Reload sends a signal or runs a command that makes the same process re-read its configuration. Only programs that support it can be reloaded, and a unit says how in `ExecReload=`.

What does `enable` do? It creates a symbolic link. A unit file says in its `[Install]` section which target wants it (`WantedBy=multi-user.target`). `enable` links the unit into that target's `.wants` directory:

```bash
sudo systemctl enable --now nginx
ls -l /etc/systemd/system/multi-user.target.wants/ | grep nginx
```

```text
lrwxrwxrwx 1 root root 38 Oct 17 10:02 nginx.service -> /usr/lib/systemd/system/nginx.service
```

At boot, systemd starts `multi-user.target` and pulls in everything linked there. There is no hidden database, which is why you can reason about it with `ls`.

> [!note] The SSH unit has a different name on different distributions
> On Ubuntu the OpenSSH server unit is `ssh.service`, and recent Ubuntu releases also use a socket unit (`ssh.socket`) so systemd listens on port 22 and starts the daemon on demand. On RHEL and its relatives the unit is `sshd.service`. If `systemctl status sshd` says "Unit sshd.service could not be found" on Ubuntu, use `ssh`. Which releases use socket activation is version-specific (verify for your release with `systemctl status ssh.socket`).

## Anatomy of a service unit

Here is a small but realistic unit for an application you deploy yourself. Read it section by section.

```ini title="/etc/systemd/system/example-app.service"
[Unit]
Description=Example application (illustrative)
Documentation=https://example.com/docs/example-app
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=exampleapp
Group=exampleapp
WorkingDirectory=/opt/example-app
EnvironmentFile=/etc/example-app/env
ExecStart=/opt/example-app/bin/example-app --port 8080
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
StateDirectory=example-app

[Install]
WantedBy=multi-user.target
```

> [!tip] What to change
> `User`/`Group` must be a dedicated service account (see [[learn/linux-users-permissions-sudo-and-ssh|Linux 02]]). `ExecStart` must be the absolute path to your binary, because systemd does not search `PATH` for it. `/etc/example-app/env` holds `KEY=value` lines and should be owned by `root:exampleapp` with mode `0640` so only root and the service can read it. Never put secrets in the unit file itself: unit files are world-readable and show up in `systemctl show`.

**`[Unit]`** describes the unit and its place in the startup order.

- `After=` sets order only: "if both are starting, start me after that one". It does not start the other unit.
- `Wants=` pulls the other unit in, but does not fail this unit if that one fails. `Requires=` is the strict version. Use `After=` and `Wants=` together when you need both.
- `network-online.target` means "the network is configured". Many services only need `network.target`; use `-online` only if the program fails when no address is up yet.
- `StartLimitIntervalSec` and `StartLimitBurst` limit restarts (see crash loops below).

**`[Service]`** says how to run the program.

- `Type=simple` (the default when `ExecStart` is set) means the process started by `ExecStart` is the service, and systemd considers it started immediately. `Type=notify` means the program tells systemd when it is ready (it calls `sd_notify`). `Type=oneshot` is for a command that runs and exits, such as a backup, and is the normal type for services started by a timer. `Type=forking` is for old daemons that detach into the background; avoid it for new code.
- `User=`, `Group=`: the identity of the process. Running as root is almost never needed.
- `WorkingDirectory=`: the current directory of the process. Without it the working directory is `/`, and a program that opens `./config.yml` fails.
- `EnvironmentFile=`: variables loaded from a file. A leading `-` (`EnvironmentFile=-/etc/example-app/env`) means "do not fail if the file is missing".
- `ExecStart=`: the command. It is not run by a shell, so `$HOME`, pipes and `&&` do not work unless you run `/bin/sh -c '...'` yourself.
- `Restart=`: when to restart. `no` is the default. `on-failure` restarts after a non-zero exit, a crash signal or a timeout, and does not restart after a clean exit or an explicit `systemctl stop`. `always` restarts after any exit, including a clean exit 0.
- `RestartSec=`: how long to wait before restarting. The default is 100 ms, which is fast enough to make a crash loop burn CPU (check the default for your systemd version with `systemctl show -p DefaultRestartUSec`).

**`[Install]`** matters only to `enable` and `disable`. It names the target that should want this unit.

### Vendor units, /etc units and drop-ins

Packages install their units under `/usr/lib/systemd/system/` (on some distributions `/lib/systemd/system/`, which is the same place through a symlink). Files you write live in `/etc/systemd/system/`, which takes priority. Never edit files under `/usr/lib`: the next package update replaces your change.

To change a few settings of a vendor unit, use a **drop-in**, a small file that adds to or overrides the original:

```bash
sudo systemctl edit nginx
```

This opens an editor on `/etc/systemd/system/nginx.service.d/override.conf`. Write only the lines you change:

```ini title="/etc/systemd/system/nginx.service.d/override.conf"
[Service]
Restart=on-failure
RestartSec=10
```

On save, `systemctl edit` reloads systemd for you. To see the merged result and where each part came from, run `systemctl cat nginx`.

### Why daemon-reload

systemd reads unit files once and keeps the parsed result in memory. If you edit a file by hand, systemd still has the old version. The command

```bash
sudo systemctl daemon-reload
```

makes it re-read all unit files. It does not restart any service. After `daemon-reload` you still need `restart` (or `reload`) for the running process to pick up changes such as a new `ExecStart`. `systemctl status` warns you with "Warning: The unit file, source configuration file or drop-ins of example-app.service changed on disk. Run 'systemctl daemon-reload' to reload units." when you forgot.

## Crash loops and start limits

When a program fails to start and `Restart=always` is set, systemd restarts it again and again. To prevent endless churn, systemd counts the starts. If a unit is started more than `StartLimitBurst` times within `StartLimitIntervalSec`, systemd stops trying and puts the unit in a failed state. The usual defaults are 5 starts in 10 seconds (verify the defaults for your systemd version; they come from `DefaultStartLimitIntervalSec` and `DefaultStartLimitBurst` in `systemd-system.conf`).

You then see messages like this:

```text
systemd[1]: crash-demo.service: Scheduled restart job, restart counter is at 5.
systemd[1]: crash-demo.service: Start request repeated too quickly.
systemd[1]: crash-demo.service: Failed with result 'start-limit-hit'.
systemd[1]: Failed to start crash-demo.service.
```

The text "start request repeated too quickly" is not the cause. It is the end of the story. The cause is in the lines **before** it, so scroll up in the journal to the first failure. To clear the limit after you fix the cause:

```bash
sudo systemctl reset-failed crash-demo
sudo systemctl start crash-demo
```

A diagnosis routine that works for most failing services:

1. `systemctl status example-app` for the state, the exit code and the last log lines.
2. `journalctl -u example-app -b --no-pager | head -50` to see the first failure since boot.
3. Look at the `Main PID` line for `code=exited, status=203/EXEC` (the binary was not found or is not executable), `status=217/USER` (the `User=` does not exist) or `status=200/CHDIR` (the `WorkingDirectory` is missing). Numbers 200 and above are systemd's own errors; the list is in `man 5 systemd.exec` (verify for your version).
4. Run the command by hand as the service user: `sudo -u exampleapp /opt/example-app/bin/example-app --port 8080`.

## Hardening a service

A service that gets compromised runs with the permissions of its user. systemd can restrict a process in ways that the application does not need to know about. A small starting set:

| Directive              | What it does                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `NoNewPrivileges=true` | The process and its children can never gain privileges, for example through setuid files |
| `ProtectSystem=strict` | The whole filesystem is read-only for the service, except `/dev`, `/proc` and `/sys`     |
| `ProtectHome=true`     | `/home`, `/root` and `/run/user` look empty                                              |
| `PrivateTmp=true`      | The service gets its own private `/tmp` and `/var/tmp`                                   |
| `StateDirectory=NAME`  | Creates `/var/lib/NAME`, owned by the service user, and keeps it writable                |

With `ProtectSystem=strict`, a program that writes to `/var/log/myapp` or `/opt/myapp/cache` fails with "Read-only file system". Give it a writable place with `StateDirectory=`, `LogsDirectory=`, `CacheDirectory=` or, for other paths, `ReadWritePaths=`.

systemd can rate how exposed a unit is:

```bash
systemd-analyze security example-app.service
```

Illustrative output (the numbers and the list differ by systemd version):

```text
NAME                            DESCRIPTION                              EXPOSURE
✗ PrivateNetwork=               Service has access to the host's network      0.5
✓ NoNewPrivileges=              Service processes cannot acquire new privileges
...
→ Overall exposure level for example-app.service: 4.2 MEDIUM 😐
```

The score is a hint, not a pass mark. A web server needs the network, so `PrivateNetwork=` will always be a red mark there. Add restrictions one at a time and test the service after each.

## Reading logs with journalctl

systemd collects the output (stdout and stderr) of every service and the logs systemd itself writes into the **journal**, a binary log database. You read it with `journalctl`:

```bash
journalctl -u nginx                 # all entries for one unit
journalctl -u nginx -f              # follow, like tail -f
journalctl -u nginx -p err          # priority err and worse
journalctl -u nginx --since "1 hour ago"
journalctl -u nginx --since "2026-10-17 09:00" --until "2026-10-17 09:30"
journalctl -b                       # everything since this boot
journalctl -b -1                    # the previous boot
journalctl -u nginx -o cat          # message text only, no timestamp or host
journalctl -k                       # kernel messages (like dmesg)
journalctl --disk-usage
```

Priorities, from worst to least severe, are `emerg`, `alert`, `crit`, `err`, `warning`, `notice`, `info` and `debug`. `-p warning` shows `warning` and everything worse.

### Keep the journal across reboots

By default the journal may live only in memory under `/run/log/journal` and vanish at reboot. That is a bad surprise during an incident: the logs of the crash you want to study are gone. Whether the journal is persistent depends on the distribution image (verify with `ls /var/log/journal`). To make it persistent explicitly:

```ini title="/etc/systemd/journald.conf.d/persistent.conf"
[Journal]
Storage=persistent
SystemMaxUse=500M
```

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
sudo systemctl restart systemd-journald
journalctl --list-boots
```

Change `SystemMaxUse` to the share of the disk you can afford. Without a cap the journal limits itself by default (a percentage of the filesystem, with a built-in ceiling), but an explicit cap makes disk use predictable. If you ship logs to a central system, the journal is the local buffer, not the archive. See [[learn/searching-logs|Observability 02: Searching logs under pressure]] for the next step.

## Packages with apt and dnf

A **package** is an archive with files plus metadata: its version, its dependencies and scripts to run on install. A **package manager** downloads packages from **repositories** (servers with an index), checks their signatures, resolves dependencies and records what is installed. Debian and Ubuntu use `apt` (on top of `dpkg`). RHEL, Rocky, AlmaLinux and Fedora use `dnf` (on top of `rpm`).

### The apt commands you need

```bash
sudo apt update                    # refresh the package index (changes nothing installed)
apt list --upgradable              # what would be upgraded
apt-cache policy nginx             # installed vs candidate version, and which repo
sudo apt upgrade                   # upgrade; may add new dependencies, never removes packages
sudo apt full-upgrade              # upgrade; may remove or install packages to resolve changes
sudo apt-mark hold nginx           # stop this package from being upgraded
apt-mark showhold
sudo apt-mark unhold nginx
```

`apt update` and `apt upgrade` are different steps. `update` downloads the list of what exists. `upgrade` installs newer versions of what you have. Running `upgrade` without a fresh `update` upgrades against yesterday's index.

`apt-cache policy` is the best first look at a version question:

```text
nginx:
  Installed: 1.24.0-2ubuntu7
  Candidate: 1.24.0-2ubuntu7.1
  Version table:
     1.24.0-2ubuntu7.1 500
        500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages
 *** 1.24.0-2ubuntu7 500
        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages
```

(Illustrative: the version strings change with every update.) `Installed` is what runs now, `Candidate` is what `apt install` would pick, and the number after each version is its repository priority.

### Adding a third-party repository the current way

Old guides use `apt-key add`. Do not: `apt-key` is deprecated, and it trusted a key for **every** repository on the machine. The current way stores one key in its own file and names it in the one repository that it signs, using `Signed-By`.

```bash
curl -fsSL https://example.com/apt/key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/example.gpg
sudo chmod 0644 /etc/apt/keyrings/example.gpg
```

```text title="/etc/apt/sources.list.d/example.sources"
Types: deb
URIs: https://example.com/apt
Suites: stable
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/example.gpg
```

> [!warning] Check before relying on this
> `example.com` is a placeholder, not a real repository. Replace the URL, the suite and the key location with the vendor's instructions, and compare the key fingerprint (`gpg --show-keys /etc/apt/keyrings/example.gpg`) with the one on the vendor's site over a separate channel before you trust it. The `.sources` (deb822) format is supported on current Ubuntu and Debian releases; older releases use one-line `deb [signed-by=...] URL SUITE COMPONENT` entries in `.list` files (verify for your release). Every repository you add can install code as root, so add only vendors you trust.

### dnf on RHEL-family systems

```bash
dnf check-update                   # list available updates (exit code 100 if any)
sudo dnf upgrade                   # apply them
sudo dnf upgrade --security        # only security updates
dnf history                        # list past transactions with IDs
sudo dnf history undo 12           # reverse transaction 12
sudo dnf versionlock add nginx     # pin a version (plugin: python3-dnf-plugin-versionlock)
```

`dnf history` is a feature `apt` lacks in this form: every install, upgrade and removal is a numbered **transaction**, and `history undo` tries to reverse one. It cannot undo everything (for example it needs the older package still to be available in a repository), so it is a safety net, not a backup.

### Security updates without a person

On Ubuntu, the `unattended-upgrades` package installs updates automatically, by default from the security pocket. It is configured in `/etc/apt/apt.conf.d/50unattended-upgrades` and switched on by `/etc/apt/apt.conf.d/20auto-upgrades`:

```text title="/etc/apt/apt.conf.d/20auto-upgrades"
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

You can preview what it would do with `sudo unattended-upgrade --dry-run --debug`. On RHEL-family systems the equivalent is `dnf-automatic`.

> [!warning] Check before relying on this
> What `unattended-upgrades` installs by default, whether it reboots, and whether it is already enabled differ between releases and images. Read `50unattended-upgrades` on your own host (look at `Allowed-Origins` and `Automatic-Reboot`) instead of trusting a default from a guide. On fleets, automatic updates are a decision for the team, tied to your patch windows. See [[standards/production-change-checklist]].

### Do updates need a restart?

Installing a new library does not change the processes already running with the old one in memory. Two checks tell you what is stale:

```bash
ls /var/run/reboot-required 2>/dev/null && cat /var/run/reboot-required   # Debian and Ubuntu: a new kernel or core library
sudo needrestart -r l                                                       # Debian and Ubuntu: which services use old libraries (package: needrestart)
sudo needs-restarting -r                                                    # RHEL family: is a reboot needed (exit 1 = yes)
sudo needs-restarting -s                                                    # RHEL family: which services need a restart
```

### The safe upgrade sequence

Use the same steps every time, so you change one thing at a time and can say what happened.

1. **Check health first.** `systemctl --failed` should be empty and the disk should have free space (`df -h /`).
2. **Refresh the index:** `sudo apt update`.
3. **List and simulate:** `apt list --upgradable` and then `apt -s upgrade` (`-s` means simulate, it changes nothing). Read the output for packages that will be removed or held back, and for packages you did not expect, such as a database or a kernel.
4. **Apply:** `sudo apt upgrade`. For a change you cannot easily undo, take a VM snapshot first.
5. **Check:** `systemctl --failed`, the service's own health check, and `ls /var/run/reboot-required`.
6. **Restart or reboot** what the previous step asked for, in a planned window.
7. **Write down** what changed (`grep ' upgrade ' /var/log/dpkg.log | tail`).

Why simulate? Because an upgrade runs as root and can restart services, replace configuration and, with `full-upgrade`, remove packages. The simulation costs seconds and tells you the blast radius before you accept it.

## Scheduled jobs: cron

**cron** is a daemon that runs commands at times you choose. Each job is one line with five time fields and a command:

```text
# ┌ minute (0-59)
# │ ┌ hour (0-23)
# │ │ ┌ day of month (1-31)
# │ │ │ ┌ month (1-12)
# │ │ │ │ ┌ day of week (0-7, Sunday is 0 or 7)
# │ │ │ │ │
  15  2  *  *  *   /usr/local/bin/example-backup.sh
```

`*` means every value, `*/5` means every fifth, `1,15` is a list, and `1-5` is a range. The line above runs at 02:15 every day, in the host's time zone (cron uses the server's local time, so a daylight-saving change can skip or repeat a local hour; see `man 5 crontab` for what your cron does).

There are three places for jobs:

- `crontab -e` edits **your** user's crontab. Lines have five fields and a command.
- `/etc/crontab` and the files in `/etc/cron.d/` are system crontabs. Their lines have **six** fields: the sixth is the user to run as. File names in `/etc/cron.d/` should use only letters, digits, underscores and hyphens (a dot in the name can make Debian's cron ignore the file; verify for your cron), and the files must be owned by root and not writable by others.
- `/etc/cron.daily`, `cron.hourly` and similar directories hold scripts run on a schedule by the system. No time field, no control.

### The traps that make jobs fail silently

Cron runs a job with a tiny environment, not your login shell. These four traps cause most "works in my terminal, fails in cron" cases:

1. **A short `PATH`.** The default is commonly just `/usr/bin:/bin`. Commands in `/usr/local/bin` or `/snap/bin` are not found. Use absolute paths, or set `PATH=` at the top of the file.
2. **`%` is special.** In a crontab command, an unescaped `%` is turned into a newline, and everything after the first `%` is sent to the command as standard input. So `date +%Y-%m-%d` breaks. Write `date +\%Y-\%m-\%d`, or put the logic in a script.
3. **Output goes to mail.** Any text a job prints is mailed to the owner (or `MAILTO`). On a server without a mail setup it is dropped, so errors vanish. Redirect output to a log file or to `logger`, and set `MAILTO` deliberately.
4. **Overlapping runs.** If a job takes longer than its interval, cron starts a second copy while the first still runs. Two backups writing to one file corrupt it. Guard with `flock -n`, which tries to take a lock file and exits at once if another copy holds it.

A crontab that avoids all four:

```text title="/etc/cron.d/example-backup"
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=ops@example.com

# m h dom mon dow user  command
15 2 * * * root  flock -n /run/lock/example-backup.lock /usr/local/bin/example-backup.sh 2>&1 | logger -t example-backup
```

> [!tip] What to change
> `MAILTO` must be an address you actually monitor (or empty, `MAILTO=""`, if you log elsewhere on purpose). `example-backup.sh` is your own script, which should follow [[learn/safe-bash-scripts|Scripting 02: Safe Bash]]. The lock file name should be unique per job. Read the output later with `journalctl -t example-backup`.

Note that in a pipeline the exit code of the job is the exit code of `logger`, not of the backup. That is acceptable for a log line, but it means cron cannot tell the job failed. For jobs that matter, make the script itself report success or failure (see "Noticing a failed job" below).

## Scheduled jobs: systemd timers

A **timer** unit starts a **service** unit on a schedule. You write two files with the same base name. The service does the work and the timer decides when.

```ini title="/etc/systemd/system/example-backup.service"
[Unit]
Description=Example backup (illustrative)

[Service]
Type=oneshot
User=exampleapp
ExecStart=/usr/local/bin/example-backup.sh
NoNewPrivileges=true
PrivateTmp=true
```

```ini title="/etc/systemd/system/example-backup.timer"
[Unit]
Description=Run the example backup every night

[Timer]
OnCalendar=*-*-* 02:15:00
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now example-backup.timer
systemctl list-timers example-backup.timer
systemd-analyze calendar "*-*-* 02:15:00"
```

You enable the **timer**, not the service. `OnCalendar` uses a calendar syntax (`Mon..Fri *-*-* 03:00:00` means weekdays at 03:00) and `systemd-analyze calendar` shows what a string means and when it next fires. `Persistent=true` stores the last run time on disk; if the machine was off at 02:15, the timer runs the missed job once at the next boot instead of skipping the night. `RandomizedDelaySec` spreads many machines over a window so they do not all hit a shared backend at the same second.

### Cron or timer?

| Question                                    | cron                      | systemd timer                                  |
| ------------------------------------------- | ------------------------- | ---------------------------------------------- |
| Setup effort                                | One line                  | Two files                                      |
| Logs                                        | Mail or your own redirect | Automatically in the journal, per unit         |
| Missed run after downtime                   | Skipped                   | Run once on next boot with `Persistent=true`   |
| Restrict the job (user, filesystem, limits) | Hard                      | Same directives as any service                 |
| Overlap protection                          | You add `flock`           | A oneshot service is not started twice at once |
| Works without systemd                       | Yes                       | No                                             |

Use cron for a quick one-line job, or on a host without systemd. Use a timer when the job matters: when you want logs, a restricted environment, missed-run catch-up and `systemctl status` to show when it last ran.

## Noticing a failed job

A job that fails silently is worse than one that fails loudly. Three practical options:

- **Check the unit state.** For a timer-driven job, `systemctl is-failed example-backup.service` and `systemctl list-units --failed` show a failed oneshot. A monitoring agent can alert on that state. For example, the Prometheus node exporter has a systemd collector that exposes unit states, but it is off by default (verify for your exporter version). See [[learn/first-prometheus-alert|Observability 03: Writing your first Prometheus alert and testing it]].
- **Run something on failure.** A service can name another unit to start when it fails with `OnFailure=notify-failure@%n.service`. You write that second unit yourself; it can post to a chat webhook or send mail.
- **Use a heartbeat (dead man's switch).** The job calls a monitoring URL when it succeeds, and the monitor alerts if the call does **not** arrive on time. It catches the cases the first two miss: the machine is down, cron is not running, the timer was never enabled. End the script with `curl -fsS --retry 3 https://example.com/ping/YOUR-CHECK-ID` and replace the URL with the one your monitoring tool gives you.

## Hands-on exercises

Run these in the lab VM (Option A), never on a shared or production host. Most need `sudo`. Outputs are illustrative where times, PIDs and versions differ.

1. **Run a long-lived service.** Create a unit that prints a line every few seconds:

   ```bash
   sudo tee /etc/systemd/system/hello-loop.service >/dev/null <<'UNIT'
   [Unit]
   Description=Hello loop (lab)

   [Service]
   ExecStart=/bin/sh -c 'while true; do echo hello from systemd; sleep 5; done'
   Restart=on-failure
   RestartSec=2
   UNIT
   sudo systemctl daemon-reload
   sudo systemctl start hello-loop
   systemctl status hello-loop --no-pager
   journalctl -u hello-loop -n 5 --no-pager
   ```

   Expected: `Active: active (running) since ...`, a `Main PID` line, and journal lines reading `hello from systemd`.
   If you see something else: "Unit hello-loop.service could not be found" means the file is not in `/etc/systemd/system/` or you skipped `daemon-reload`. If you ran this inside a container (Option B), `systemctl` cannot connect, because a container has no systemd.

2. **Kill it and watch it come back.** Run:

   ```bash
   sudo kill -KILL "$(systemctl show -p MainPID --value hello-loop)"
   sleep 4
   systemctl show -p NRestarts -p ActiveState hello-loop
   journalctl -u hello-loop -n 8 --no-pager
   ```

   Expected: `NRestarts=1` and `ActiveState=active`, and journal lines saying `Main process exited, code=killed, status=9/KILL`, then `Scheduled restart job, restart counter is at 1`.
   If you see something else: `NRestarts=0` with `ActiveState=failed` means `Restart=` was not applied; run `systemctl cat hello-loop`. If `NRestarts` is not shown at all, your systemd is older; read the journal lines instead.

3. **Create a crash loop.** Make a unit that always exits at once:

   ```bash
   sudo tee /etc/systemd/system/crash-demo.service >/dev/null <<'UNIT'
   [Service]
   ExecStart=/bin/false
   Restart=always
   UNIT
   sudo systemctl daemon-reload
   sudo systemctl start crash-demo
   sleep 3
   systemctl status crash-demo --no-pager
   journalctl -u crash-demo --no-pager | tail -6
   ```

   Expected: the status shows `Active: failed (Result: start-limit-hit)` and the journal ends with "Start request repeated too quickly" and "Failed with result 'start-limit-hit'". Clear it with `sudo systemctl reset-failed crash-demo`.
   If you see something else: if the status is `activating (auto-restart)` and never fails, your defaults differ (verify the start-limit defaults); wait a few more seconds and read the journal again. The wording of the messages varies by systemd version.

4. **Change a setting with a drop-in.** Check the default, override it, and check again:

   ```bash
   systemctl show -p RestartUSec crash-demo
   sudo mkdir -p /etc/systemd/system/crash-demo.service.d
   printf '[Service]\nRestartSec=10\n' | sudo tee /etc/systemd/system/crash-demo.service.d/override.conf
   systemctl show -p RestartUSec crash-demo     # still the old value: not reloaded yet
   sudo systemctl daemon-reload
   systemctl show -p RestartUSec crash-demo
   ```

   Expected: `RestartUSec=100ms` first and after the edit before the reload, then `RestartUSec=10s` after `daemon-reload`. The `systemctl cat crash-demo` output shows the base file followed by the drop-in.
   If you see something else: if the first value is not `100ms`, your systemd default differs, which is fine. If the value never changes, check the folder name: it must be exactly `crash-demo.service.d`.

5. **Read a timer calendar.** Run:

   ```bash
   systemd-analyze calendar "Mon..Fri *-*-* 03:15:00"
   systemd-analyze calendar "*:0/15"
   ```

   Expected: for each, lines starting `Original form:`, `Normalized form:` and `Next elapse:` with a date and time. The second shows a fire time every 15 minutes.
   If you see something else: "Failed to parse calendar specification" means a typo in the expression. Compare it with the examples in `man 7 systemd.time`.

6. **Run a timer.** Create a oneshot service and a timer that fires every minute, then watch it:

   ```bash
   sudo tee /etc/systemd/system/stamp.service >/dev/null <<'UNIT'
   [Service]
   Type=oneshot
   ExecStart=/usr/bin/logger -t stamp "timer fired"
   UNIT
   sudo tee /etc/systemd/system/stamp.timer >/dev/null <<'UNIT'
   [Timer]
   OnCalendar=minutely
   Persistent=true
   [Install]
   WantedBy=timers.target
   UNIT
   sudo systemctl daemon-reload
   sudo systemctl enable --now stamp.timer
   systemctl list-timers stamp.timer --no-pager
   sleep 70
   journalctl -t stamp --no-pager | tail -3
   ```

   Expected: `list-timers` shows a `NEXT` time within the next minute and `UNIT stamp.timer`, then at least one `timer fired` line from `stamp`.
   If you see something else: no journal line means the timer was not enabled (check `systemctl is-enabled stamp.timer`) or you waited less than a minute. If `/usr/bin/logger` is missing, install the `bsdutils` package or use `/bin/echo` and read the unit's own journal.

7. **Score a unit and harden it.** Run `systemd-analyze security hello-loop.service | tail -1`, then add hardening and score again:

   ```bash
   printf '[Service]\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\nDynamicUser=true\n' \
     | sudo tee /etc/systemd/system/hello-loop.service.d/hardening.conf
   ```

   If the folder does not exist yet, create it first with `sudo mkdir -p /etc/systemd/system/hello-loop.service.d`. Then `sudo systemctl daemon-reload && sudo systemctl restart hello-loop`, check `systemctl is-active hello-loop`, and score again.
   Expected: the "Overall exposure level" number is lower after the change (for example from about 9.6 UNSAFE to about 6 MEDIUM), and the service is still `active`.
   If you see something else: if the service fails after the change, read `journalctl -u hello-loop -n 20`; a directive your kernel does not support is the usual cause. Remove the last line you added and retry. The numbers vary a lot between systemd versions.

8. **Clean up the service exercises.** Run:

   ```bash
   sudo systemctl disable --now stamp.timer hello-loop
   sudo rm -rf /etc/systemd/system/{hello-loop,crash-demo,stamp}.service* /etc/systemd/system/stamp.timer
   sudo systemctl daemon-reload
   sudo systemctl reset-failed
   ```

   Expected: no output other than lines about removing symlinks, and `systemctl --failed` is empty.
   If you see something else: "Failed to disable unit: Unit file ... does not exist" for a unit you already removed is harmless.

9. **Read the journal like an operator.** Run:

   ```bash
   journalctl -b -p warning --no-pager | tail -10
   journalctl --disk-usage
   ls /var/log/journal 2>/dev/null || echo "journal is not persistent"
   journalctl --list-boots
   ```

   Expected: a few warning lines (or none on a quiet VM), a line like `Archived and active journals take up 24.0M in the file system.`, and one boot listed (or more if persistent and you rebooted).
   If you see something else: "journal is not persistent" means the journal is lost at reboot. Apply the `journald.conf.d` file from this lesson and compare.

10. **Inspect apt state.** Run:

    ```bash
    sudo apt update
    apt list --upgradable 2>/dev/null | head -5
    apt-cache policy curl
    ```

    Expected: `apt update` ends with a line such as `All packages are up to date.` or `N packages can be upgraded.`; `apt-cache policy curl` shows `Installed:` and `Candidate:` versions with the Ubuntu archive listed under them.
    If you see something else: "Could not get lock /var/lib/dpkg/lock-frontend" means another apt (often the automatic updater) is running; wait a minute and retry. Do not delete the lock file.

11. **Simulate, hold and unhold.** Run:

    ```bash
    sudo apt -s upgrade | tail -8
    sudo apt-mark hold curl
    apt-mark showhold
    sudo apt-mark unhold curl
    ```

    Expected: the simulation lists `Inst ...` lines (or nothing to upgrade) and ends with a summary of upgraded, newly installed and removed counts; `showhold` prints `curl`.
    If you see something else: if `showhold` prints nothing, the `hold` command failed (check for a typo in the package name). Always unhold after the exercise, or the package will never get security fixes.

12. **Find the signing key of a repository.** Run `grep -r -H -i 'signed-by' /etc/apt/sources.list.d/ /etc/apt/sources.list 2>/dev/null` and then `ls /etc/apt/keyrings /usr/share/keyrings | head`.
    Expected: Ubuntu's own `ubuntu.sources` (in `sources.list.d`) with a `Signed-By:` line pointing to a keyring file under `/usr/share/keyrings/`.
    If you see something else: an older image may list a `sources.list` with no `signed-by`; it is then verified through the global trusted keyring. That is the legacy mode this lesson tells you not to copy for new repositories.

13. **See the cron traps.** As your normal user, create a crontab entry that shows the `%` trap, wait, and read the result:

    ```bash
    ( crontab -l 2>/dev/null; echo '* * * * * date +%Y-%m-%d >> /tmp/cron-trap.txt' ) | crontab -
    sleep 75
    ls -l /tmp/cron-trap.txt; cat /tmp/cron-trap.txt
    journalctl -u cron --since "5 min ago" --no-pager | tail -5
    ```

    Expected: no file (or an empty one), because cron cut the command at the first `%`: `date +` ran with no argument and the rest went to its standard input. The journal shows the `CMD` line cut at `date +`. Whatever the shortened command prints (an empty line from `date +`) is mailed to the owner, or dropped if there is no mail setup.
    If you see something else: if the file exists with a date, your cron escapes `%` differently (verify for your cron); this is exactly why you test a job in cron before you trust it. If the `cron` unit does not exist, install it with `sudo apt install cron`. On RHEL-family hosts the unit is `crond`.

14. **Fix it and add a lock.** Replace the entry:

    ```bash
    crontab -l | grep -v cron-trap | crontab -
    ( crontab -l 2>/dev/null; echo '* * * * * flock -n /tmp/cron-lock.lock /bin/sh -c "date +\%Y-\%m-\%d_\%H:\%M >> /tmp/cron-ok.txt; sleep 90"' ) | crontab -
    sleep 130
    cat /tmp/cron-ok.txt
    ```

    Expected: one or two lines about two minutes apart, not one per minute, for example `2026-10-17_10:31` and then `2026-10-17_10:33`: the job sleeps for 90 seconds, so the next start finds the lock held and `flock -n` exits at once.
    If you see something else: one line per minute means the lock is not shared; check the lock path is identical. No file means the quote handling broke; check `crontab -l` for the exact line. When done, remove the job with `crontab -r`. That removes **all** of your cron jobs, which is what you want for a fresh lab user.

15. **Optional, RHEL family: undo a dnf transaction.** In a throwaway container:

    ```bash
    docker run --rm -it rockylinux:9 bash -c '
      dnf install -y tree >/dev/null &&
      dnf history list | head -5 &&
      dnf history undo last -y >/dev/null &&
      (command -v tree || echo "tree is gone")'
    ```

    Expected: a history table with the install as the newest transaction, and `tree is gone` at the end.
    If you see something else: the image tag or the `dnf history` output format may differ on your version. If you see "Error: The operation would result in removing the following protected packages", you tried to undo a transaction that touched the system; use `dnf history info` to see what it contains.

## Common mistakes

- **Editing a unit file and forgetting `daemon-reload` and `restart`.** systemd runs the version it has in memory. Fix: after any edit run `sudo systemctl daemon-reload`, then restart the unit, then check `systemctl cat` and `systemctl show`.
- **Editing a vendor file under `/usr/lib/systemd/system`.** The next package update overwrites it. Fix: use `systemctl edit` to create a drop-in in `/etc`.
- **`Restart=always` on a service that exits on bad configuration.** It turns a config error into a crash loop that hides the cause behind "start request repeated too quickly". Fix: use `Restart=on-failure`, set a sensible `RestartSec`, and read the first error in the journal.
- **Running everything as root.** A bug or a compromise in the service then owns the machine. Fix: a dedicated user and the hardening directives above.
- **Using `apt upgrade` on a production host without looking.** It can restart services or replace configuration at a bad time. Fix: the safe sequence (update, list, simulate, apply, check), in a window, after a snapshot where possible.
- **`apt-key add` and unsigned repositories.** The key then vouches for every repository on the host. Fix: a keyring file referenced by `Signed-By` for only that repository.
- **Leaving packages on hold forever.** A held package never gets security fixes. Fix: write down why it is held, who owns it, and when to review it.
- **Writing a cron job and never testing it in cron.** The environment differs from your shell. Fix: use absolute paths, escape `%`, log the output, and watch the first scheduled run.
- **No overlap guard.** A slow job overlaps with the next run. Fix: `flock -n`, or a timer with a oneshot service.
- **Assuming a scheduled job works because nobody complained.** Fix: a heartbeat or a failed-unit alert, so silence is not mistaken for success.

## Check your understanding

1. After editing a unit file, why do you need `systemctl daemon-reload`, and what does it not do?
2. What is the difference between `Restart=on-failure` and `Restart=always`? When would `always` be a bad choice?
3. A cron job runs fine when you type the command, but does nothing from cron. Name three causes you would check.
4. What problem does `Persistent=true` fix in a timer?
5. Why simulate an upgrade (`apt -s upgrade`) before applying it?
6. A service shows `Failed with result 'start-limit-hit'`. Where do you look for the real cause?

> [!question]- Answers
>
> 1. systemd keeps the parsed unit files in memory. `daemon-reload` makes it re-read them from disk. It does not restart or reload any running service, so the old process keeps running with the old settings until you restart it.
> 2. `on-failure` restarts after a non-zero exit, a crash signal or a timeout, and leaves the service stopped after a clean exit or a manual stop. `always` restarts after any exit, even a clean one. `always` is a bad choice for programs that exit on a bad configuration, because it keeps restarting something that cannot succeed, and for one-off tasks that are meant to finish.
> 3. Cron's short `PATH` (the command is not found), an unescaped `%` in the command, a different working directory or missing environment variables, and output that is mailed to nobody so the error is never seen. Permissions on the script or the user the job runs as are also common.
> 4. If the machine is off or asleep when the timer should fire, the missed run is skipped. With `Persistent=true` systemd remembers the last run and runs the missed one once when the timer starts again, for example at boot.
> 5. An upgrade runs as root and can restart services, replace config files and, with `full-upgrade`, remove packages. The simulation shows what would change, so you can catch a surprise (a database upgrade, a removal, a held-back package) before it happens, at no cost.
> 6. In the journal lines before the limit message: `journalctl -u NAME -b`. The limit message only says systemd gave up. The first failure line has the real exit code or error. Run the command by hand as the service user to reproduce it.

## Next steps

Next lesson: [[learn/network-layers-tcp-and-udp|Networking 01: Layers, TCP, UDP and ports]], which starts the networking stage. Previous lesson: [[learn/linux-processes-memory-and-disk|Linux 04: Processes, memory and disk]].

For going deeper as a senior engineer:

- [[standards/production-change-checklist]] for how to plan, announce and roll back a change such as a package update on a production host.
- [[patterns/automated-dependency-updates]] for keeping dependencies current automatically and reviewing the updates as pull requests.
- [[patterns/linux-host-hardening-with-chef-and-inspec]] for enforcing host settings at fleet scale.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- systemd documentation: `man 5 systemd.unit`, `man 5 systemd.service`, `man 5 systemd.exec`, `man 5 systemd.timer`, `man 7 systemd.time`, `man 1 systemctl`, `man 1 journalctl`, `man 5 journald.conf`, `man 1 systemd-analyze` (https://www.freedesktop.org/software/systemd/man/). Not run in this authoring environment; all systemd output in this lesson is illustrative, and the systemd version is not stated. Check the defaults named above (`RestartSec`, start limits, journal storage) against `systemctl show` on your host.
- Debian and Ubuntu: `man 8 apt`, `man 8 apt-mark`, `man 5 sources.list`, `man 5 deb822` (deb822 format, `Signed-By`), the Ubuntu Server documentation on automatic updates (https://documentation.ubuntu.com/server/). Not run here; check `unattended-upgrades` defaults per release.
- Red Hat family: the `dnf` documentation (https://dnf.readthedocs.io/) for `history`, `versionlock` and `dnf-automatic`. Not run here; the container exercise needs `rockylinux:9` to be available.
- `man 5 crontab`, `man 8 cron` and `man 1 flock` (Linux man-pages and the distribution's cron package, https://man7.org/linux/man-pages/). Not run here.
