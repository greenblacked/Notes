---
title: "Linux 01: The shell, the filesystem and the command line"
description: Learn how the Linux directory tree is laid out and how paths, PATH, redirection, pipes, quoting and variables work, so you can use a shell safely.
type: guide
tags:
  - learning
  - linux
created: 2026-10-17
modified: 2026-10-17
verified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 4 h | You need: [[learn/lab-setup|Start 01: Set up your lab]] | Lab: Lab A (the Ubuntu VM or the Docker container)
> Checked on Ubuntu 24.04.5 LTS with GNU Bash 5.2.21 on 2026-10-17. Sample output is illustrative: dates, sizes and paths differ on your machine. Manual pages were not installed on the checking machine, so the `man` steps were not run.

Almost everything in DevOps happens in a shell: you log in to a server, read logs, run a deployment tool, check a cluster. This lesson gives you the model that makes the rest of the path readable. Without it, commands look like spells; with it, you can predict what a command will do before you press Enter.

## What you will learn

- What lives where in the Linux directory tree, so you know where to look for configuration, logs and temporary files.
- How absolute and relative paths work, and how to move around quickly.
- How the shell finds a command, and why the order of `PATH` matters for both correctness and security.
- How to redirect output, pipe commands together and read exit status.
- When the shell expands a pattern or splits a word, and how quoting controls that.
- How shell variables differ from environment variables, and how to get help from a command.

## Why the layout matters

On a Linux machine everything is a file in one tree that starts at `/`, the root directory. There are no drive letters. Disks, USB sticks and network shares are attached ("mounted") somewhere inside the same tree. Even running processes and kernel settings appear as files.

That uniform design is why the same few tools (`ls`, `cat`, `grep`, `cp`) work on all of it. It also means the location of a file tells you what it is for. A DevOps engineer reading `/etc/nginx/nginx.conf` knows it is configuration; reading `/var/log/nginx/error.log` knows it is a log that grows over time. Knowing the convention lets you debug a machine you have never seen before.

## The filesystem map

Linux distributions follow the Filesystem Hierarchy Standard (FHS), which describes the purpose of each top-level directory. Distributions differ in details, so treat this as a map, not a law.

| Directory | What belongs there                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `/etc`    | System-wide configuration files, as text. Back this up. Example: `/etc/ssh/sshd_config`.                |
| `/var`    | Variable data that changes while the system runs: logs (`/var/log`), caches, spools, package databases. |
| `/usr`    | Installed programs and libraries, read-only in normal use. `/usr/bin` holds most commands.              |
| `/opt`    | Optional, self-contained third-party software installed outside the package manager.                    |
| `/home`   | Home directories of normal users: `/home/alice`.                                                        |
| `/root`   | The home directory of the `root` user. It is not under `/home`.                                         |
| `/tmp`    | Temporary files, readable by every user. May be cleared on reboot. Never store anything you need here.  |
| `/proc`   | A virtual view of processes and kernel state. It is not stored on disk.                                 |
| `/sys`    | A virtual view of devices and drivers, also not on disk.                                                |

Two more you will meet soon: `/dev` (device files such as `/dev/null`) and `/bin`, `/sbin`, `/lib`, which on current Ubuntu releases are links into `/usr`. Check yours with `ls -ld /bin`.

Look at the top of the tree. The output is illustrative:

```bash
ls -ld /etc /var/log /usr/bin /opt /home /root /tmp /proc /sys
```

```text
drwxr-xr-x  81 root root  4096 Oct 17 11:41 /etc
drwxr-xr-x   5 root root  4096 Oct 10 17:42 /home
drwxr-xr-x  19 root root  4096 Oct 10 17:40 /opt
dr-xr-xr-x  88 root root     0 Oct 16 07:07 /proc
drwx------  16 root root  4096 Oct 17 11:41 /root
dr-xr-xr-x  12 root root     0 Oct 16 07:07 /sys
drwxrwxrwt 145 root root 20480 Oct 17 16:31 /tmp
drwxr-xr-x   2 root root 24576 Oct  3 05:42 /usr/bin
drwxr-xr-x   7 root root  4096 Oct  3 05:36 /var/log
```

Read the columns left to right: type and permissions, link count, owner, group, size in bytes, modification time, name. Three things to notice:

- `/proc` and `/sys` show size `0`. They are virtual. The kernel generates their contents when you read them.
- `/root` is `drwx------`: only root can enter it.
- `/tmp` ends in `t` (`drwxrwxrwt`): the sticky bit. Everyone can create files there, but only a file's owner can delete it. You will meet permissions properly in [[learn/linux-users-permissions-sudo-and-ssh]].

To see which parts of the tree are real disks and which are virtual, ask for the filesystem type:

```bash
findmnt -n -o TARGET,FSTYPE /proc /sys /tmp
```

```text
/proc proc
/sys  sysfs
/tmp  ext4
```

`proc` and `sysfs` are in-memory views. What `/tmp` uses depends on the machine (some mount it as `tmpfs`, in memory).

## Paths, and moving around

A **path** says where a file is. There are two kinds:

- An **absolute path** starts with `/` and is complete: `/etc/hosts`. It means the same thing wherever you are.
- A **relative path** does not start with `/` and is resolved from your **current working directory**: `projects/web` means "the `projects` directory in the directory I am in now".

Two names exist in every directory: `.` is the directory itself and `..` is its parent. `~` is shorthand for your home directory (the shell expands it before the command runs).

```bash
mkdir -p ~/lab-linux01/projects/web
cd ~/lab-linux01/projects/web
pwd
cd ..
pwd
cd -
```

```text
/home/alice/lab-linux01/projects/web
/home/alice/lab-linux01/projects
/home/alice/lab-linux01/projects/web
```

`pwd` prints the working directory. `cd ..` goes up one level. `cd -` jumps back to the previous directory and prints it. That is the quickest way to bounce between two places.

For more than two places, the shell keeps a stack of directories:

```bash
pushd /etc
pushd /var/log
popd
popd
pwd
```

```text
/etc ~/lab-linux01/projects/web
/var/log /etc ~/lab-linux01/projects/web
/etc ~/lab-linux01/projects/web
~/lab-linux01/projects/web
/home/alice/lab-linux01/projects/web
```

`pushd` changes directory and remembers where you were; `popd` goes back. They are useful in scripts that must return to where they started.

> [!tip] Tab completion
> Press Tab to complete a command or path, and press it twice to list the options. Besides saving typing, it proves the path exists. If Tab completes, you did not make a typo.

## How the shell finds commands

When you type `ls`, the shell has to decide what to run. It checks in this order:

1. An **alias** (a nickname you or your distribution defined).
2. A shell **function**.
3. A shell **builtin**: a command that is part of the shell itself.
4. A program found by searching the directories in the **`PATH`** variable, left to right. The first match wins.

Use `type` to see which one the shell would use:

```bash
type cd
type ls
type -a echo
command -v ls
type -t cd ls if
```

```text
cd is a shell builtin
ls is /usr/bin/ls
echo is a shell builtin
echo is /usr/bin/echo
echo is /bin/echo
/usr/bin/ls
builtin
file
keyword
```

On many Ubuntu installs an interactive shell prints `ls is aliased to 'ls --color=auto'` instead, because the default profile defines that alias. Aliases differ per distribution and per user, so your answer may differ. (If you have already run `ls` in the same shell, you may see `ls is hashed (/usr/bin/ls)`: Bash remembers the location.)

`echo` appears three times: a builtin and two programs. The builtin wins because builtins come before `PATH`. `command -v NAME` prints how a name would be resolved and returns a non-zero status if it is not found, which makes it the right test inside scripts. For a name that is not found:

```bash
type nosuchcmd
echo "exit status: $?"
```

```text
bash: type: nosuchcmd: not found
exit status: 1
```

**Why `cd` is a builtin.** A program you run starts as a separate child process, and a child cannot change its parent's working directory. If `cd` were a program in `/usr/bin`, it would change its own directory and exit, and your shell would not move. It must be part of the shell to work.

### PATH order

`PATH` is a colon-separated list of directories. Print it one directory per line, numbered:

```bash
echo "$PATH" | tr ':' '\n' | nl
```

```text
     1	/usr/local/sbin
     2	/usr/local/bin
     3	/usr/sbin
     4	/usr/bin
     5	/sbin
     6	/bin
```

Illustrative: yours will have different entries (tools installed under your home directory, for example). The order decides which program runs when two directories hold a command with the same name. Anything earlier in `PATH` shadows anything later. That is how a newer `python3` in `/usr/local/bin` beats the system one in `/usr/bin`, and also how a mistake or an attacker can replace a command.

> [!warning] Never put `.` (the current directory) in PATH
> If `.` or an empty entry is in `PATH`, typing `ls` in a directory that contains a file called `ls` runs that file. Someone who can write to a shared directory can plant a program named after a common command and wait for you to `cd` there. Keep `PATH` to absolute directories you trust, and put user-writable directories after the system ones. To run a script in the current directory, type `./script.sh` on purpose.

You also see this safe-by-design rule: to run something that is not in `PATH`, give its path explicitly (`./deploy.sh` or `/opt/tool/bin/tool`).

## Streams, redirection and pipes

Every process starts with three open streams:

| Number | Name            | Default  | Used for                      |
| ------ | --------------- | -------- | ----------------------------- |
| 0      | standard input  | keyboard | data the program reads        |
| 1      | standard output | terminal | normal results                |
| 2      | standard error  | terminal | error and diagnostic messages |

Keeping errors on their own stream is what lets you save results to a file and still see problems on the screen. Redirection changes where a stream goes:

| Syntax        | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `> file`      | Send stdout to `file`, replacing it                               |
| `>> file`     | Append stdout to `file`                                           |
| `2> file`     | Send stderr to `file`                                             |
| `2>&1`        | Send stderr to wherever stdout currently goes                     |
| `&> file`     | Bash shortcut: stdout and stderr to `file`                        |
| `< file`      | Read stdin from `file`                                            |
| `<<< "text"`  | Here-string: use the text as stdin                                |
| `> /dev/null` | Throw output away (`/dev/null` discards everything written to it) |

A short session, using a directory that does not exist to produce an error:

```bash
cd ~/lab-linux01
echo hello > out.txt
echo again >> out.txt
cat out.txt
ls /nonexistent > o.txt 2> e.txt
cat o.txt
cat e.txt
```

```text
hello
again
ls: cannot access '/nonexistent': No such file or directory
```

`o.txt` is empty (the command printed nothing on stdout), so `cat o.txt` prints nothing, and the error message went to `e.txt`.

### The order of redirections matters

Redirections are processed left to right. Compare:

```bash
ls /nonexistent > both.txt 2>&1
ls /nonexistent 2>&1 > both2.txt
```

In the first command, stdout goes to `both.txt`, then stderr is pointed at where stdout now goes: the file. Both end up in `both.txt`, and the terminal shows nothing. In the second command, stderr is pointed at the terminal (where stdout goes at that moment), and only then is stdout sent to the file. The error still appears on screen, and `both2.txt` is empty.

So `2>&1 > file` does **not** mean "both to the file". Write `> file 2>&1`, or `&> file` in Bash.

### Pipes and exit status

A pipe (`|`) connects the stdout of one command to the stdin of the next. It is the basic building block of shell work:

```bash
printf 'b\na\nc\n' | sort | head -n 2
grep root <<< "root:x:0:0"
```

```text
a
b
root:x:0:0
```

Every command finishes with an **exit status**, a number from 0 to 255. `0` means success; anything else means failure, and the program documents what each non-zero value means. The shell stores the last status in `$?`:

```bash
ls /nonexistent 2>/dev/null
echo "status: $?"
```

```text
status: 2
```

For a pipeline, the shell by default reports only the status of the **last** command, which hides earlier failures:

```bash
false | true
echo "status: $?"
set -o pipefail
false | true
echo "status: $?"
set +o pipefail
```

```text
status: 0
status: 1
```

`false` always fails and `true` always succeeds. With `pipefail` the pipeline fails if any command in it fails. After a pipeline, Bash also keeps every status in the array `PIPESTATUS`; `false | true; echo "${PIPESTATUS[@]}"` prints `1 0`. Scripts that use pipes should turn `pipefail` on, which [[learn/safe-bash-scripts]] covers.

## Globbing, quoting and expansion

Before a command runs, the shell rewrites the line. The program never sees `*` or `~`; it sees the result. This is the single most important thing to understand about the shell.

**Globbing** expands wildcard patterns into matching file names:

| Pattern | Matches                     |
| ------- | --------------------------- |
| `*`     | Any string, including empty |
| `?`     | Exactly one character       |
| `[abc]` | One character from the set  |

```bash
cd ~/lab-linux01
touch a.txt b.txt c.log
echo *.txt
echo "*.txt"
echo *.nomatch
```

```text
a.txt b.txt
*.txt
*.nomatch
```

The first line shows the shell turning `*.txt` into a list before `echo` runs. In the second, double quotes stop expansion, so `echo` receives the literal `*.txt`. In the third, a pattern with no match stays as typed in default Bash, so a script that loops over `*.nomatch` gets one iteration with that literal name. That surprises many people.

**Brace expansion** generates strings (it does not look at the disk):

```bash
echo {1..3}
echo file{A,B,C}.bak
mkdir -p proj/{src,docs,tests}
ls proj
```

```text
1 2 3
fileA.bak fileB.bak fileC.bak
docs
src
tests
```

**Quoting** controls all of this:

- `'single quotes'`: everything is literal.
- `"double quotes"`: the shell still expands variables (`$name`) and command substitutions (`$(command)`), but it does not split the result into words and does not expand wildcards.
- No quotes: the result of an expansion is split on spaces and then globbed.

The unquoted case is the source of many bugs. With a file name containing a space:

```bash
name="my file.txt"
printf '[%s]\n' $name
printf '[%s]\n' "$name"
```

```text
[my]
[file.txt]
[my file.txt]
```

`printf` repeated its format once per argument. Without quotes, the variable became two arguments; with quotes, one. The same thing happens to `rm $name`: it tries to delete two files called `my` and `file.txt`. **Quote every variable expansion: `"$var"`.** The exception is when you want splitting, which is rare and deliberate.

## Variables and the environment

A **shell variable** exists only in the current shell. An **environment variable** is a shell variable that has been **exported**, so child processes inherit a copy.

```bash
X=local
bash -c 'echo "[$X]"'
export X
bash -c 'echo "[$X]"'
```

```text
[]
[local]
```

The first child shell (`bash -c`) is a new process and cannot see the unexported `X`. After `export X` it can. A child's changes never flow back to the parent. You can also set a variable for one command only:

```bash
MYVAR=1 env | grep MYVAR
```

```text
MYVAR=1
```

`env` with no arguments prints the whole environment; `printenv NAME` prints one variable. Common ones are `HOME`, `USER`, `PATH`, `PWD` and `SHELL`. Never put secrets in environment variables for long-lived shells, because child processes (and some tools that dump the environment into logs) can read them.

## Getting help

- `command --help` gives a short usage summary. Try `ls --help | head`.
- `help cd` shows documentation for a Bash builtin (builtins have no manual page).
- `man command` opens the manual page. Pages are grouped in **sections**: section 1 is user commands (`man 1 ls`), section 5 is file formats and configuration files (`man 5 passwd` describes `/etc/passwd`), and section 8 is system administration commands (`man 8 mount`).
- `man -k word` (the same as `apropos`) searches page titles and descriptions when you do not know the command name.

Inside a manual page, press `/` to search, `n` for the next match and `q` to quit. Minimal VMs and containers often have no manual pages installed. The checking machine printed a notice that the system had been minimized and suggested `unminimize`; installing `man-db` and your distribution's `manpages` package is the usual fix, but check the documentation for your image.

## Safe habits

These cost seconds and prevent most disasters:

- **`pwd` before `rm`.** Know where you are before you delete.
- **`ls` before `cp`, `mv` and `rm`** with the same pattern, so you see what it matches.
- **`echo` before a loop.** Put `echo` in front of the dangerous command, read the output, then remove the `echo`.
- **Quote variables.** Always `"$var"`.
- **The three-second check.** Before pressing Enter on a destructive command, read it once more from left to right, especially the path and the glob. A trailing space in `rm -rf /tmp/build /` is one of the oldest ways to destroy a system.

The dry-run loop looks like this:

```bash
cd ~/lab-linux01
for f in *.txt; do
  echo mv "$f" "${f%.txt}.md"
done
```

```text
mv a.txt a.md
mv b.txt b.md
mv out.txt out.md
```

`${f%.txt}` removes the suffix `.txt` from the value. The loop only prints the commands. When the list is right, delete `echo` and run it again. (The exact list depends on the `.txt` files in your directory.)

## Hands-on exercises

Work in your lab, and use a scratch directory.

1. **Look at the tree and spot the virtual filesystems.**

   ```bash
   ls -ld /proc /etc
   stat -c '%n size=%s' /proc/cpuinfo
   head -n 3 /proc/cpuinfo
   ```

   Expected: `/proc` shows size `0` and `dr-xr-xr-x`; `/proc/cpuinfo` reports `size=0` yet `head` prints CPU details. The file is generated by the kernel when you read it, which is why its size is 0 and why it is not on disk. Do not expect exact dates. If you see something else: in some containers `/proc/cpuinfo` is trimmed or the line labels differ; any readable text proves the point. A non-zero size is possible on other systems, so rely on `findmnt -n -o TARGET,FSTYPE /proc`, which should say `proc`.

2. **Move around with absolute and relative paths.**

   ```bash
   mkdir -p ~/lab-linux01/projects/web
   cd ~/lab-linux01/projects/web
   pwd
   cd ../..
   pwd
   cd -
   pushd /etc
   popd
   ```

   Expected: `pwd` prints the full path ending in `projects/web`, then ending in `lab-linux01`; `cd -` prints the `web` path again; `pushd /etc` prints the stack, and `popd` returns you to `web`. If you see something else: `No such file or directory` means a typo in a path, so use Tab completion; `pushd: no other directory` means the stack is empty, so run `pushd` with a directory first.

3. **Find out what the shell runs.**

   ```bash
   type cd
   type -a echo
   command -v ls
   type nosuchcmd; echo "status: $?"
   echo "$PATH" | tr ':' '\n' | nl
   ```

   Expected: `cd` is a shell builtin; `echo` is listed as a builtin and as one or two files; `command -v ls` prints a path like `/usr/bin/ls`; `type nosuchcmd` prints `not found` and the status is `1`; `PATH` appears as numbered lines without any `.` entry. If you see something else: if you do see an empty line or `.` in the PATH listing, an empty entry or a leading or trailing colon is the cause. Remove it from the `PATH=` line in your shell profile.

4. **Practise redirection.**

   ```bash
   cd ~/lab-linux01
   echo hello > out.txt
   echo again >> out.txt
   ls /nonexistent > o.txt 2> e.txt
   ls /nonexistent > both.txt 2>&1
   ls /nonexistent 2>&1 > both2.txt
   wc -c o.txt e.txt both.txt both2.txt
   ```

   Expected: `ls` prints the error message once on the screen (from the last command only); the byte counts show `o.txt` is `0`, `e.txt` and `both.txt` have the same size (the length of the error line), and `both2.txt` is `0`. If you see something else: if `both2.txt` is not empty, you typed the redirections in the other order. If the error appears on screen from the third command, that is correct, because it belongs to the final line.

5. **Pipes and pipefail.**

   ```bash
   printf 'b\na\nc\n' | sort | head -n 2
   false | true; echo "status: $?"
   set -o pipefail
   false | true; echo "status: $?"
   set +o pipefail
   false | true; echo "${PIPESTATUS[@]}"
   ```

   Expected: `a` and `b` on two lines, then `status: 0`, then `status: 1`, then `1 0`. If you see something else: if both statuses are `0`, `set -o pipefail` was not applied; make sure you ran it in the same shell, not in a subshell or a script. If you use a shell other than Bash, `PIPESTATUS` may be `pipestatus` or missing.

6. **Globbing, braces and quotes.**

   ```bash
   cd ~/lab-linux01
   touch a.txt b.txt c.log
   echo *.txt
   echo "*.txt"
   echo *.nomatch
   echo file{A,B,C}.bak
   ```

   Expected: `a.txt b.txt` (plus any other `.txt` files you made), then `*.txt`, then `*.nomatch`, then `fileA.bak fileB.bak fileC.bak`. If you see something else: if `echo *.nomatch` printed nothing, your shell has `nullglob` or uses another default (`shopt nullglob` shows it); Bash's default leaves the pattern as typed.

7. **The unquoted `rm`.**

   ```bash
   cd ~/lab-linux01
   touch "my file.txt"
   rm my file.txt
   ls
   rm "my file.txt"
   ls
   ```

   Expected: the first `rm` fails twice (`cannot remove 'my': No such file or directory` and the same for `file.txt`), and `my file.txt` is still listed; the quoted `rm` succeeds silently and the file is gone. If you see something else: if you have real files named `my` or `file.txt` in that directory, the unquoted command would have deleted them, which is the point. Run this only in the scratch directory.

8. **Environment versus shell variables.**

   ```bash
   X=local
   bash -c 'echo "[$X]"'
   export X
   bash -c 'echo "[$X]"'
   ```

   Expected: `[]`, then `[local]`. If you see something else: if you see `[local]` both times, `X` was already exported in your profile; pick another name such as `LESSON_VAR`.

## Common mistakes

- **Unquoted variables.** Why it bites: a space or `*` in the value changes the number of arguments. Fix: write `"$var"` everywhere, and run `shellcheck` on scripts ([[learn/safe-bash-scripts]]).
- **Running `rm` with a glob without looking first.** Why: the shell expands the pattern before `rm` runs, so you delete everything it matched. Fix: `ls` the same pattern first, or put `echo` in front.
- **`2>&1 > file` in the wrong order.** Why: redirections apply left to right, so stderr still goes to the terminal. Fix: `> file 2>&1` or `&> file`.
- **Trusting the status of a pipeline.** Why: without `pipefail`, only the last command counts, so a failed first stage looks like success. Fix: `set -o pipefail` in scripts, or check `PIPESTATUS`.
- **Putting `.` in PATH.** Why: it lets a planted file run in place of a normal command. Fix: use `./script` explicitly and keep `PATH` to absolute directories.
- **Storing important files in `/tmp`.** Why: it can be wiped on reboot and any user can read the directory. Fix: use a proper directory, with the right permissions.
- **Assuming your aliases exist elsewhere.** Why: aliases are per user and per distribution, so `ll` may not exist on a server or in a script. Fix: use the real command (`ls -l`) in scripts and documentation.

## Check your understanding

1. Why is `cd` a shell builtin and not a program?
2. What is the difference between `command > file 2>&1` and `command 2>&1 > file`?
3. Why does `"$var"` matter, and what happens to `rm $var` when `var="my file.txt"`?
4. What do `/proc` and `/sys` contain, and where are they stored?
5. What does the order of directories in `PATH` decide, and why is `.` dangerous there?
6. In a pipeline `a | b | c`, which exit status does the shell report by default, and how do you change that?

> [!question]- Answers
>
> 1. A program runs in a child process, and a child cannot change its parent's working directory. To move the shell itself, `cd` must run inside the shell.
> 2. In the first, stdout goes to the file and then stderr is pointed at the same place, so both go to the file. In the second, stderr is pointed at the terminal first and only then is stdout sent to the file, so errors still show on screen and the file gets only stdout.
> 3. Without quotes the shell splits the value into words at spaces and expands wildcards. `rm $var` becomes `rm my file.txt`, which tries to delete two different files. With quotes, `rm` gets one argument.
> 4. Views of running processes, kernel state, devices and drivers. They are generated by the kernel when read, so they are not stored on disk and show size 0.
> 5. When two directories hold the same command name, the earlier directory wins. A `.` entry means the current directory is searched, so a file planted in a directory you `cd` into can run in place of a real command.
> 6. The status of the last command (`c`). Turn on `set -o pipefail` so a failure in any stage fails the pipeline, or inspect `PIPESTATUS` in Bash.

## Next steps

- Next lesson: [[learn/linux-users-permissions-sudo-and-ssh|Linux 02: Users, permissions, sudo and SSH]].
- Previous lesson: [[learn/lab-setup|Start 01: Set up your lab]].
- Go deeper: [[standards/bash-scripts]] shows how this team writes shell scripts, and [[runbooks/kubernetes-pod-troubleshooting]] uses these tools on a live problem.
- Back to the [[learn/index|learning path]].

## Sources

- Filesystem Hierarchy Standard 3.0: <https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html>
- GNU Bash Reference Manual (redirections, shell expansions, quoting, shell variables): <https://www.gnu.org/software/bash/manual/bash.html>
- Linux man-pages project, `man(1)`, `hier(7)`, `file-hierarchy(7)`: <https://man7.org/linux/man-pages/>
- GNU Coreutils manual: <https://www.gnu.org/software/coreutils/manual/coreutils.html>

Versions checked: Ubuntu 24.04.5 LTS, GNU Bash 5.2.21, on 2026-10-17.
