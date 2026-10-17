---
title: "Linux 02: Users, permissions, sudo and SSH access"
description: Learn who may log in to a Linux host and what they may do. Covers users and groups, file modes, umask, sudo, SSH keys and a hardened sshd.
type: guide
tags:
  - learning
  - linux
  - security
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 4 h | You need: [[learn/linux-shell-and-filesystem|Linux 01: The shell and the filesystem]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]]

Almost every "permission denied" you will meet in your career comes from the same small model: a process runs as a user, the user belongs to groups, and every file says what its owner, its group and everyone else may do. Once you can read that model, you can fix access problems without guessing. This lesson teaches the model, then applies it to the two ways people get onto a server: `sudo` and SSH.

## What you will learn

- How Linux identifies users and groups, and how to look them up with `id` and `getent`.
- How to read and set file modes (`rwx`, octal and symbolic) and why `x` on a directory means "may enter".
- How `umask`, setgid directories and the sticky bit decide the permissions of new files.
- How to create a service account and give a group a narrow `sudo` right with a drop-in file.
- How SSH key pairs work, and how to log in, configure a bastion hop and harden `sshd` safely.
- A method for debugging "access denied" with `namei -l` and `ssh -vvv`.

## Users and groups

Linux does not know names. It knows numbers. A **UID** (user ID) identifies a user and a **GID** (group ID) identifies a group. Names are a convenience stored in text files and looked up when needed. UID 0 is `root`, who is allowed to do almost anything. Ordinary users on current distributions usually start at UID 1000, and system accounts for daemons use lower numbers (the exact ranges are set in `/etc/login.defs`; verify for your distro).

Every process carries a user, a primary group and a list of supplementary groups. The kernel checks those numbers against the numbers stored on a file.

```bash
id
```

```text
uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu),27(sudo),100(users)
```

_Illustrative: your name, numbers and groups will differ._

The account data lives in plain text files:

- `/etc/passwd` has one line per user: `name:x:UID:GID:comment:home:shell`. The `x` means the password hash is kept elsewhere (`/etc/shadow`, readable by root only).
- `/etc/group` has one line per group: `name:x:GID:member1,member2`.

Do not read these files directly when you only want to look someone up. Use `getent`, which asks the same sources the system uses (local files, and also LDAP or SSO directories when the host is joined to one).

```bash
getent passwd root
getent group sudo
```

```text
root:x:0:0:root:/root:/bin/bash
sudo:x:27:ubuntu
```

_Illustrative. The group list on your host will differ._

Group membership is read when you log in. If you add yourself to a group, the running shell does not see it. Log out and back in, or start a new login shell, before testing.

## File permissions: rwx

Run `ls -l` and you see ten characters at the start of each line.

```bash
ls -l /etc/passwd /usr/bin/passwd
```

```text
-rw-r--r-- 1 root root 1920 Oct 12 09:14 /etc/passwd
-rwsr-xr-x 1 root root 59976 Oct 12 09:14 /usr/bin/passwd
```

_Illustrative: sizes and dates will differ._

Decode the first line of the output like this:

| Part        | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `-`         | File type. `-` is a regular file, `d` a directory, `l` a symbolic link. |
| `rw-`       | The owner (user) may read and write, not execute.                       |
| `r--`       | The group may read only.                                                |
| `r--`       | Everyone else may read only.                                            |
| `root root` | The owner is `root` and the group is `root`.                            |

The kernel picks **one** of the three sets. If you are the owner, only the owner bits apply to you. Otherwise, if you are in the file's group, the group bits apply. Otherwise the "others" bits apply. This is why a file with mode `---rw-rw-` can lock out its own owner while letting everyone else in.

### What r, w and x mean

| Bit | On a file            | On a directory                                       |
| --- | -------------------- | ---------------------------------------------------- |
| `r` | Read the contents.   | List the names inside (`ls`).                        |
| `w` | Change the contents. | Create, rename and delete entries inside.            |
| `x` | Run it as a program. | **Enter** it (`cd`) and reach things inside by name. |

The directory column surprises beginners. With `r` but no `x` on a directory you can list names but cannot open anything inside. With `x` but no `r` you can open a file if you already know its exact name, but you cannot list the directory. Deleting a file needs `w` and `x` on the **directory**, not any permission on the file itself.

### Octal and symbolic modes

Each set is a number: read is 4, write is 2, execute is 1. Add them up for each set.

| Octal | Symbolic    | Typical use                         |
| ----- | ----------- | ----------------------------------- |
| `600` | `rw-------` | Private key, secrets file.          |
| `644` | `rw-r--r--` | Normal data file or config.         |
| `700` | `rwx------` | Private directory such as `~/.ssh`. |
| `750` | `rwxr-x---` | Directory shared with one group.    |
| `755` | `rwxr-xr-x` | Program or public directory.        |

`chmod` accepts both forms:

```bash
chmod 640 app.conf        # octal: owner rw-, group r--, others ---
chmod u+x,g-w script.sh   # symbolic: add x for the owner, remove w for the group
chmod -R o-rwx ./private  # remove all access for others, recursively
```

The symbolic form changes only what you name, so it is safer when you do not want to restate the whole mode.

### Changing the owner: chown and the chown -R incident

`chown user:group path` changes the owner and group. You need root to give a file to somebody else.

```bash
sudo chown app:app /srv/app/config.yml
```

The `-R` flag walks the whole tree, and that is where incidents happen. A famous mistake is a script that runs `chown -R "$USER:$USER" "$DIR/"` with `DIR` empty, which becomes `chown -R user:user /`. The system keeps running for a moment, then `sudo`, `ssh` and package tools start refusing to work because they require root-owned files. There is no undo other than a restore or a rebuild.

> [!warning] Guard every recursive chown and chmod
> Make the shell stop on an empty variable with `${DIR:?}`, print the target first, and never run `-R` on a path you have not looked at with `ls -ld`.

```bash
DIR=/srv/app/data
: "${DIR:?DIR is not set}"
ls -ld "$DIR"
sudo chown -R app:app "$DIR"
```

### The correct ownership fix

A common request is "make this tree writable by the deploy group". The tempting answer is `chmod -R 777`. The correct answer keeps directories enterable and files non-executable, with two `find` commands.

```bash
APP_DIR=/srv/app
sudo chgrp -R deploy "$APP_DIR"
sudo find "$APP_DIR" -type d -exec chmod 2775 {} +   # directories: rwxrwsr-x (setgid)
sudo find "$APP_DIR" -type f -exec chmod 664 {} +    # files: rw-rw-r--
```

Directories and files need different modes because `x` means different things on each. A blanket `chmod -R 775` makes every data file executable.

## umask, setgid and the sticky bit

### umask

When a program creates a file it asks for a mode (usually `666` for files and `777` for directories). The **umask** then removes bits from that request. With a umask of `022`, a new file becomes `644` and a new directory `755`. With `077`, only the owner gets anything.

```bash
umask
(umask 077; touch private.txt)
(umask 022; touch public.txt)
ls -l private.txt public.txt
```

```text
0022
-rw------- 1 ubuntu ubuntu 0 Oct 17 10:00 private.txt
-rw-r--r-- 1 ubuntu ubuntu 0 Oct 17 10:00 public.txt
```

_Illustrative. The default umask on your host is commonly `022` or `002`; check it with `umask`._

The brackets run the command in a subshell, so the umask change does not stick to your session.

### setgid on directories

Three more bits sit above the usual nine. Two matter for day-to-day work.

On a **directory**, the **setgid** bit (shown as `s` in the group position, octal `2000`) makes new files and subdirectories inherit the directory's group instead of the creator's primary group. This is how a shared team directory works: everyone who writes there produces files the whole group can use.

### The sticky bit

On a directory, the **sticky bit** (shown as `t` in the others position, octal `1000`) means that only a file's owner, the directory's owner or root may delete or rename entries, even if others have `w` on the directory. That is what makes `/tmp` safe: everyone can create files there, but you cannot delete mine.

```bash
ls -ld /tmp
```

```text
drwxrwxrwt 14 root root 4096 Oct 17 10:00 /tmp
```

_Illustrative: link count and date will differ._

### setuid

On an executable file, **setuid** (an `s` in the owner position, octal `4000`) makes the program run as the file's owner, whatever user started it. `/usr/bin/passwd` uses it so an ordinary user can update the root-owned password database. A setuid root program with a bug is a way to become root, so you do not create them casually, and security scans list them.

```bash
find / -xdev -perm -4000 -type f 2>/dev/null
```

## Service accounts

A daemon should not run as root and should not run as a person. Give each service its own **system account**: no password, no login shell, and a home directory only if it needs one.

```bash
sudo useradd --system --home-dir /var/lib/myapp --create-home \
  --shell /usr/sbin/nologin myapp
getent passwd myapp
```

```text
myapp:x:998:998::/var/lib/myapp:/usr/sbin/nologin
```

_Illustrative: the UID will differ._

`--system` picks a UID from the system range. `nologin` as the shell means that if anyone tries to log in as `myapp`, they get a polite refusal. The service's unit file then sets `User=myapp` (covered in [[learn/linux-services-packages-and-scheduled-jobs|Linux 05: Services, packages and scheduled jobs]]). If the app is compromised, the attacker has only what `myapp` may touch.

## sudo

`sudo` runs one command as another user (root by default) after checking a policy. It beats logging in as root because it asks who you are, logs each use, and can limit the commands.

```bash
sudo -l
```

```text
User ubuntu may run the following commands on lab-vm:
    (ALL : ALL) ALL
```

_Illustrative._

`sudo -l` lists what you may run. Use it first when a `sudo` command is refused.

### Edit policy with visudo, in drop-in files

The policy lives in `/etc/sudoers` and in files under `/etc/sudoers.d/`. A syntax error in a sudoers file can lock everyone out of `sudo`, so never edit it with a plain editor. Use `visudo`, which checks the syntax before saving.

```bash
sudo visudo -f /etc/sudoers.d/10-appops
```

Put one concern in each file. A least-privilege example lets members of the `appops` group restart and check one service, and nothing else:

```text title="/etc/sudoers.d/10-appops"
# Members of group appops may restart or inspect myapp. Nothing else.
Cmnd_Alias APP_OPS = /usr/bin/systemctl restart myapp, \
                     /usr/bin/systemctl --no-pager status myapp
%appops ALL=(root) APP_OPS
```

Things to change and why: `myapp` is your service name, `appops` is the group that should hold this right, and the `systemctl` path must match `command -v systemctl` on your host, because sudoers matches full paths. Use full paths always. The `--no-pager` option matters: without it, `systemctl status` can open a pager as root, and a pager can run shell commands.

Two rules about the `/etc/sudoers.d` directory: the file must be mode `0440` and owned by root (visudo sets this), and sudo ignores any file whose name contains a dot or ends with `~`. A file called `appops.conf` is silently skipped, which is why the example is `10-appops`.

Check a file without installing it:

```bash
sudo visudo -cf /etc/sudoers.d/10-appops
```

```text
/etc/sudoers.d/10-appops: parsed OK
```

### The wrong fixes

Two habits turn small problems into incidents:

- **`chmod 777`** on a file or directory "to make the error go away". It gives write access to every user and every compromised process on the host. Find out which user needs which access instead.
- **Running everything as root** (`sudo` for every command, services as root). Every bug now has full power. Use a service account and the narrowest `sudo` rule that works.

## Debugging "permission denied" with namei

To open `/srv/app/data/report.csv`, the kernel needs `x` on `/`, `/srv`, `/srv/app` and `/srv/app/data`, and then `r` on the file. One missing `x` anywhere along the path fails the whole open. `namei -l` prints the owner and mode of every component in one go.

```bash
namei -l /srv/app/data/report.csv
```

```text
f: /srv/app/data/report.csv
dr-xr-xr-x root root /
drwxr-xr-x root root srv
drwxr-x--- root root app
drwxr-xr-x root root data
-rw-r--r-- root root report.csv
```

_Illustrative._

Read it top to bottom. Here `app` is mode `750` and owned by `root:root`, so a user who is not in group `root` cannot enter it, no matter how open the file below is. The fix is to change the group or the mode of the directory that blocks you, not the file.

A method for any access problem:

1. Run `id` as the user that fails (a service runs as its own user, not as you).
2. Run `namei -l` on the full path.
3. Find the first component where the matching set of bits (owner, group or other) lacks what is needed.
4. Fix that component with the smallest change, then retest as the same user.

## SSH: logging in without passwords

SSH gives you an encrypted shell on a remote host. Passwords work but are weak and easy to guess at scale. Keys are the standard way.

### The key-pair model

You create two linked files:

- The **private key** stays on your machine and never leaves it. Anyone who has it can pretend to be you.
- The **public key** goes onto every server you want to enter, in that user's `~/.ssh/authorized_keys`. It cannot be used to log in, so it is safe to copy around.

At login the server sends a challenge, your client signs it with the private key, and the server checks the signature against the public key. The private key is never sent, only a signature. That is the answer when someone asks why you must never email or paste a private key: the whole scheme depends on only one copy existing.

```bash
ssh-keygen -t ed25519 -C "you@example.com"
```

```text
Generating public/private ed25519 key pair.
Enter file in which to save the key (/home/ubuntu/.ssh/id_ed25519):
Enter passphrase (empty for no passphrase):
Your identification has been saved in /home/ubuntu/.ssh/id_ed25519
Your public key has been saved in /home/ubuntu/.ssh/id_ed25519.pub
```

_Illustrative._

`ed25519` is the modern default for new keys. Set a **passphrase**: it encrypts the private key on disk, so a stolen laptop or backup does not hand over your access.

### authorized_keys and its permissions

On the server, the key goes into the target user's `~/.ssh/authorized_keys`, one key per line. `sshd` refuses to use keys when the files are writable by others (its `StrictModes` check is on by default), so the permissions matter:

```bash
install -d -m 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

The home directory itself must not be group- or world-writable either. If key login silently fails and falls back to asking for a password, wrong permissions here are the first thing to check.

### known_hosts and fingerprints

The first time you connect to a host, SSH shows its **host key fingerprint** and asks if you trust it. It then stores the key in `~/.ssh/known_hosts` and complains loudly if it changes later. Do not type `yes` by reflex: compare the fingerprint with one you got out of band (from the cloud console, or from a colleague over a different channel). Otherwise a man in the middle on the first connection is invisible.

On the server you can print its fingerprint to compare:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

```text
256 SHA256:AAAAexampleFingerprintOnlyAAAAAAAAAAAAAAAAAAAA root@lab-vm (ED25519)
```

_Illustrative: this is not a real fingerprint._

### ssh-agent and the risk of -A

`ssh-agent` holds your decrypted key in memory so you type the passphrase once. `ssh-add` loads a key into it.

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
ssh-add -l
```

Agent forwarding (`ssh -A`) lets the remote host use your agent to hop further. The danger is that anyone with root on that remote host can use your agent's socket while you are connected, and sign in as you everywhere your key works. They cannot copy the key, but they can use it. Prefer `ProxyJump` (next section), which does not expose your agent to the middle host.

### ~/.ssh/config and a bastion host

A config file saves typing and encodes good defaults. A typical setup reaches private hosts through a bastion:

```text title="~/.ssh/config"
# Bastion in the lab. Change HostName and User to yours.
Host bastion
    HostName bastion.example.com
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes

# Hosts behind the bastion, reached through it.
Host app-*
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ProxyJump bastion

Host app-1
    HostName 198.51.100.21
```

`IdentitiesOnly yes` makes SSH offer only the key named here, instead of every key in your agent. Without it, a client with many keys can hit the server's `MaxAuthTries` limit and be disconnected before the right key is tried. `ProxyJump bastion` opens a connection to the bastion first and tunnels the real session through it, so `ssh app-1` works in one command and your agent never leaves your machine. The address uses a documentation range; change it to your host.

### Hardening sshd

The server side is configured in `/etc/ssh/sshd_config` and, on current distributions, by drop-in files in `/etc/ssh/sshd_config.d/`. A small hardening file for a host where people log in with keys:

```text title="/etc/ssh/sshd_config.d/00-hardening.conf"
# Keys only, no root login, only members of ssh-users may log in.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowGroups ssh-users
```

Things to change and why: `ssh-users` must be a group that exists and contains your own account, or you lock yourself out. Create it first with `sudo groupadd --system ssh-users` and `sudo usermod -aG ssh-users "$USER"`.

> [!warning] Check before relying on this
> Not verified on this lab: on Ubuntu `sshd` reads the first value it finds for a keyword, and the main file includes `/etc/ssh/sshd_config.d/*.conf` near the top. That is why the example is named `00-hardening.conf`, so it is read before files such as `50-cloud-init.conf` that may enable `PasswordAuthentication` on cloud images. Confirm the `Include` line and the effective values with `sudo sshd -T` on your version.

Always test before you reload, and keep your current session open while you try a second one:

```bash
sudo sshd -t && echo "config OK"
sudo systemctl reload ssh      # Ubuntu and Debian
# sudo systemctl reload sshd   # RHEL, Rocky and Alma
```

The unit is called `ssh` on Ubuntu and `sshd` on RHEL-family systems. `sshd -t` checks the syntax and exits non-zero on an error. A reload with a broken config can leave you unable to open new sessions, which is why you test first and keep the old session alive.

> [!warning] Check before relying on this
> Not verified: recent Ubuntu releases start `sshd` by socket activation (`ssh.socket`), so changing the listening port needs the socket unit changed, not only `sshd_config`. Check with `systemctl status ssh.socket` on your release.

### Debugging with ssh -vvv

When login fails, ask the client what it is doing. Each `v` adds detail, and three is the most.

```bash
ssh -vvv -i ~/.ssh/id_ed25519 ubuntu@app-1.example.com
```

```text
debug1: Offering public key: /home/ubuntu/.ssh/id_ed25519 ED25519 SHA256:AAAAexampleFingerprintOnlyAAAAAAAAAAAAAAAAAAAA
debug3: send packet: type 50
debug3: receive packet: type 51
debug1: Authentications that can continue: publickey
```

_Illustrative excerpt._

Read the output for three things. "Offering public key" with no "Server accepts key" afterwards means the server did not accept it (wrong user, key missing from `authorized_keys`, or bad permissions). "Authentications that can continue: publickey" with nothing left means no method remains. Then read the **server's** log for the real reason: on Ubuntu `sudo journalctl -u ssh -n 50`, on RHEL `sudo journalctl -u sshd -n 50`. A line such as `Authentication refused: bad ownership or modes for directory` points straight at the permission rules above.

## Hands-on exercises

Run these in the lab VM, never on a shared or production host. Some need `sudo`. Outputs are illustrative where names, times and UIDs differ.

1. **Read your identity.** Run `id` and `getent passwd "$USER"`.
   Expected: one line from `id` with your UID, GID and groups, and one `passwd` line ending in your home and shell.
   If you see something else: if `getent` prints nothing, you used a name that does not exist. Check `echo "$USER"`.

2. **Decode and set modes.** Run:

   ```bash
   mkdir -p ~/lab02 && cd ~/lab02
   touch report.txt && chmod 640 report.txt
   ls -l report.txt
   chmod u+x,o+r report.txt
   ls -l report.txt
   stat -c '%A %a %n' report.txt
   ```

   Expected: `-rw-r----- 1 ubuntu ubuntu 0 ... report.txt`, then `-rwxr--r-- ...`, then `-rwxr--r-- 744 report.txt`.
   If you see something else: if the owner shows `root`, you ran the commands with `sudo`. Repeat without it.

3. **Debug with namei.** Run:

   ```bash
   mkdir -p ~/lab02/proj/data && echo hello > ~/lab02/proj/data/f.txt
   chmod 000 ~/lab02/proj
   cat ~/lab02/proj/data/f.txt
   namei -l ~/lab02/proj/data/f.txt
   chmod 755 ~/lab02/proj
   cat ~/lab02/proj/data/f.txt
   ```

   Expected: the first `cat` says `Permission denied`; `namei -l` shows `d---------` on `proj`; after the `chmod`, `cat` prints `hello`.
   If you see something else: if the first `cat` works, you are root (`id` shows `uid=0`). Root bypasses mode bits. Use an ordinary user.

4. **See the umask at work.** Run the `umask` example from this lesson. Expected: `-rw-------` for the file made under `077` and `-rw-r--r--` for `022`.
   If you see something else: a group-writable result (`664`) means your normal umask is `002`, which is fine for this lesson.

5. **Build a shared directory.** Run:

   ```bash
   sudo groupadd team
   sudo mkdir /srv/shared
   sudo chgrp team /srv/shared
   sudo chmod 3775 /srv/shared
   ls -ld /srv/shared
   sudo touch /srv/shared/new.txt && ls -l /srv/shared/new.txt
   ```

   Expected: `drwxrwsr-t 2 root team ... /srv/shared`, and the new file is owned by group `team`, not `root`.
   If you see something else: if the file's group is `root`, the setgid bit is missing. The leading `3` in `3775` sets setgid (2) and sticky (1) together; re-run the `chmod`.

6. **Create a service account.** Run the `useradd --system` example, then try to become it: `sudo su - myapp`.
   Expected: `getent passwd myapp` ends in `/usr/sbin/nologin` and the `su` attempt prints `This account is currently not available.`
   If you see something else: if you get a shell, the `--shell` option was not applied. Fix it with `sudo usermod -s /usr/sbin/nologin myapp`.

7. **Write a least-privilege sudo rule.** Create the group and the drop-in:

   ```bash
   sudo groupadd appops
   sudo visudo -f /etc/sudoers.d/10-appops
   ```

   Paste the `Cmnd_Alias` example, save, and run `sudo visudo -cf /etc/sudoers.d/10-appops` and `sudo ls -l /etc/sudoers.d/10-appops`.
   Expected: `parsed OK`, and a file with mode `-r--r-----` owned by `root root`.
   If you see something else: if `visudo` reports a syntax error, it offers to re-edit; say `e` and fix it. Never choose to save a broken file.

8. **Create a key pair.** Run `ssh-keygen -t ed25519 -f ~/.ssh/lab_ed25519 -C "lab@example.com"`, set a passphrase, then `ls -l ~/.ssh/lab_ed25519*` and `ssh-keygen -lf ~/.ssh/lab_ed25519.pub`.
   Expected: a private file with mode `-rw-------`, a public file with `.pub`, and a fingerprint line starting `256 SHA256:`.
   If you see something else: if `ssh-keygen` is not found, install the client: `sudo apt install openssh-client`.

9. **Log in with the key, then break it.** Install the server and log in to your own VM as a test user:

   ```bash
   sudo apt install -y openssh-server
   sudo useradd --create-home --shell /bin/bash labuser
   sudo install -d -m 700 -o labuser -g labuser /home/labuser/.ssh
   cat ~/.ssh/lab_ed25519.pub | sudo tee -a /home/labuser/.ssh/authorized_keys >/dev/null
   sudo chown labuser:labuser /home/labuser/.ssh/authorized_keys
   sudo chmod 600 /home/labuser/.ssh/authorized_keys
   ssh -i ~/.ssh/lab_ed25519 -o IdentitiesOnly=yes -o PreferredAuthentications=publickey labuser@localhost whoami
   ```

   Expected: a host key prompt on first connect (answer `yes` here, because this is your own VM), your key passphrase prompt, then `labuser`. `PreferredAuthentications=publickey` stops ssh from falling back to a password prompt.
   Now run `sudo chmod 777 /home/labuser/.ssh` and repeat the `ssh` line.
   Expected: a failure with `Permission denied (publickey).` and, in `sudo journalctl -u ssh -n 5`, a line about bad ownership or modes. Restore with `sudo chmod 700 /home/labuser/.ssh`.
   If you see something else: if the first login fails with `Permission denied (publickey)`, the key was not appended or `~/.ssh` is not mode 700. Run `sudo namei -l /home/labuser/.ssh/authorized_keys`. On RHEL use `-u sshd` for the log.

10. **Check a bastion config without a bastion.** Save the `~/.ssh/config` example (change nothing), then run `ssh -G app-1 | grep -E '^(hostname|user|proxyjump|identitiesonly) '`.
    Expected: `hostname 198.51.100.21`, `user ubuntu`, `proxyjump bastion` and `identitiesonly yes`.
    If you see something else: if `hostname app-1` appears, the `Host app-1` block is missing or misspelled. `ssh -G` prints what the client would use without connecting.

11. **Harden sshd safely.** Create the `ssh-users` group, add your user, write the drop-in, then test and reload. Keep your current terminal open and open a second one to test.

    ```bash
    sudo groupadd --system ssh-users
    sudo usermod -aG ssh-users "$USER"
    sudo tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
    PermitRootLogin no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowGroups ssh-users
    EOF
    sudo sshd -t && sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|allowgroups) '
    sudo systemctl reload ssh
    ```

    Expected: no output from `sshd -t`, then `permitrootlogin no`, `passwordauthentication no` and `allowgroups ssh-users`. A new session from the second terminal still works.
    If you see something else: if `passwordauthentication yes` appears, another file set it first; look at `sudo grep -R PasswordAuthentication /etc/ssh/`. If `sshd -t` prints an error, fix it and do not reload. Remember `labuser` is not in `ssh-users`, so it can no longer log in; that proves `AllowGroups` works.

When you finish, clean up: `sudo userdel -r labuser`, `sudo userdel -r myapp`, `sudo rm /etc/ssh/sshd_config.d/00-hardening.conf /etc/sudoers.d/10-appops`, `sudo rm -r /srv/shared`, then `sudo systemctl reload ssh` and `sudo groupdel team; sudo groupdel appops; sudo groupdel ssh-users`.

## Common mistakes

- **`chmod 777` to fix an error.** It hides the real cause and opens the file to every user and process. Use `id` and `namei -l` to find the missing bit and grant exactly that.
- **`chmod -R` or `chown -R` on a path built from a variable.** An empty variable turns it into `/`. Use `${VAR:?}` and `ls -ld` first, and use `find -type d` and `-type f` when files and directories need different modes.
- **Editing sudoers with a normal editor.** One typo can end `sudo` for everyone. Always use `visudo`, and use `visudo -cf` to check a drop-in.
- **A sudoers drop-in with a dot in its name.** `sudo` skips it without any warning. Name it `10-appops`, and check with `sudo -l -U <user>`.
- **Reloading sshd with an untested config, or without a second session open.** If the new config is wrong or too strict you are locked out of a remote machine. Run `sshd -t`, keep one session open, and test with a new one.
- **Typing `yes` at a host key prompt without checking.** You trust whoever answered. Compare the fingerprint out of band, especially for production.
- **Using `ssh -A` everywhere.** Anyone with root on the intermediate host can use your agent while you are connected. Use `ProxyJump`.
- **Sharing a private key.** If a private key is copied, pasted into chat or committed, treat it as stolen and replace it; the steps are in [[runbooks/leaked-credential-rotation]].

## Check your understanding

1. What does the `x` bit mean on a directory, and what can you do with `r` but not `x`?
2. Why set the setgid bit on a shared team directory?
3. Why must the private key never leave your machine, when the server needs to check your identity?
4. Why run `sshd -t` before reloading `sshd`, and why keep your current session open?
5. What does SSH agent forwarding (`-A`) expose, and what is a safer alternative?
6. A service user cannot read `/srv/app/data/report.csv`, which is mode `644`. What do you run, and what do you look for?

> [!question]- Answers
>
> 1. On a directory `x` means you may enter it and reach entries by name. With `r` but no `x` you can list the names but cannot open or stat anything inside.
> 2. New files and subdirectories inherit the directory's group instead of the creator's primary group, so every member of the team gets the access the group mode grants without anyone running `chgrp`.
> 3. The login proves possession by signing a challenge, and only the signature is sent. If the private key were copied, anyone could sign as you, so there must be exactly one copy that you protect with a passphrase.
> 4. `sshd -t` catches syntax and value errors before the running daemon sees them. A bad config can stop new logins, and an already open session lets you fix the file instead of losing access.
> 5. It lets root on the remote host use your agent to authenticate as you for as long as you are connected. `ProxyJump` passes the connection through the bastion without giving it your agent.
> 6. Run `namei -l` on the full path while using `id` of the service user. Look for a directory in the chain without `x` for that user's owner, group or other set. The file mode is fine, so the block is a parent directory.

## Next steps

Next lesson: [[learn/text-and-data-tools|Linux 03: Text and data tools]]. Previous lesson: [[learn/linux-shell-and-filesystem|Linux 01: The shell and the filesystem]].

For going deeper as a senior engineer:

- [[runbooks/leaked-credential-rotation]] for what to do when a key or token escapes.
- [[patterns/linux-host-hardening-with-chef-and-inspec]] for enforcing host settings such as the sshd file above across a fleet.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- `man 7 credentials`, `man 1 chmod`, `man 1 chown`, `man 2 umask`, `man 1 namei` (Linux man-pages project, https://man7.org/linux/man-pages/). The `namei`, `chmod` and `umask` behaviour shown here was run on Ubuntu 24.04 LTS.
- `man 5 sudoers` and `man 8 visudo` (Sudo project documentation, https://www.sudo.ws/docs/man/sudoers.man/). The `visudo -cf` check was run on Ubuntu 24.04 LTS; the rest of the sudo behaviour was not re-run.
- `man 5 sshd_config`, `man 5 ssh_config`, `man 1 ssh-keygen`, `man 1 ssh-agent` (OpenSSH, https://www.openssh.com/manual.html). Not run in this lab: no SSH client or server was installed, so the SSH outputs are illustrative and the OpenSSH version is not stated.
- Ubuntu Server documentation on OpenSSH (https://documentation.ubuntu.com/server/). Check the `sshd_config.d` include order and the `ssh.socket` defaults against your release.
