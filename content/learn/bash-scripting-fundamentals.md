---
title: "Scripting 01: Bash fundamentals"
description: "Write small, correct Bash scripts: exit codes, variables, quoting, tests, loops, functions, arrays, heredocs and the pipeline subshell trap."
type: guide
tags:
  - learning
  - linux
created: 2026-10-17
modified: 2026-10-17
verified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 6 h | You need: [[learn/linux-shell-and-filesystem|Linux 01: The shell and the filesystem]] and [[learn/text-and-data-tools|Linux 03: Text and data tools]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]] (Option B, the container, also works)

A shell script is a text file of commands that you would otherwise type by hand. Most operations work starts this way: a deploy helper, a cleanup job, a check that runs from cron. Bash is quick to write and easy to get subtly wrong. This lesson teaches the language from first principles, with the habits that keep small scripts from deleting the wrong thing. The next lesson, [[learn/safe-bash-scripts|Scripting 02]], adds strict mode, traps and ShellCheck on top.

## What you will learn

- How a script starts: the shebang line, the execute bit, and the difference between `bash script.sh` and `./script.sh`.
- How exit codes work, and how `&&`, `||`, `if` and `$?` use them.
- How variables, quoting, word splitting and globbing interact, and why you write `"$var"` almost every time.
- How to take arguments, test conditions, branch with `if` and `case`, and loop safely over files and lines.
- How to write functions, use arrays (indexed and associative), heredocs and arithmetic.
- Why a counter changed inside `cat file | while read ...` is still zero afterwards.

## A script is a file the kernel hands to an interpreter

Create a first script in a lab directory.

```bash
mkdir -p ~/lab15 && cd ~/lab15
cat > hello.sh <<'EOF'
#!/usr/bin/env bash
echo "hello from $0"
EOF
bash hello.sh
./hello.sh
echo "exit=$?"
```

```text
hello from hello.sh
bash: ./hello.sh: Permission denied
exit=126
```

The first line, `#!/usr/bin/env bash`, is the **shebang**. When you run a file directly, the kernel reads those first two characters (`#!`), takes the rest of the line as the interpreter and runs `interpreter file`. `env bash` looks for `bash` on the `PATH`, which also works on systems where Bash is not in `/bin`. To the shell itself, a line starting with `#` is a comment, so the shebang costs nothing.

`bash hello.sh` works without the shebang and without the execute bit, because you named the interpreter yourself. `./hello.sh` needs the **execute bit**, which `chmod +x` sets. Without it the shell refuses with exit code `126` ("found, but cannot execute"). The `./` is needed because the current directory is not on `PATH`; without a slash the shell searches `PATH` only.

```bash
chmod +x hello.sh
./hello.sh
ls -l hello.sh
```

```text
hello from ./hello.sh
-rwxr-xr-x 1 student student 40 Oct 17 10:00 hello.sh
```

_Illustrative: owner, size and time differ on your machine._

> [!note] sh is not bash
> `#!/bin/sh` runs a smaller POSIX shell. On Debian and Ubuntu that is `dash`, which has no arrays, no `[[ ]]` and no `(( ))`. If you use those features, use a `bash` shebang. Everything in this lesson is Bash.

## Exit codes: how commands report success

Every command ends with a number between 0 and 255, its **exit code**. Zero means success. Anything else means failure, and the number says what kind. The shell stores the last one in `$?`.

```bash
true;  echo $?
false; echo $?
ls /nonexistent; echo $?
```

```text
0
1
ls: cannot access '/nonexistent': No such file or directory
2
```

Some codes have conventional meanings:

| Code    | Usual meaning                                         |
| ------- | ----------------------------------------------------- |
| 0       | Success.                                              |
| 1       | General failure (also "no match" for `grep`).         |
| 2       | Misuse: wrong arguments or a usage error.             |
| 126     | Found, but not executable (permission).               |
| 127     | Command not found.                                    |
| 128 + n | Killed by signal n (130 is Ctrl-C, 137 is `SIGKILL`). |

Your scripts follow the same convention: exit `0` when everything worked, `1` when something failed at runtime, `2` when the caller used the script wrongly. Other scripts, cron, CI and Kubernetes all read that number and nothing else.

### Chaining on success and failure

`&&` runs the next command only if the previous one succeeded. `||` runs it only if the previous one failed. `;` runs it regardless.

```bash
(mkdir -p proj && cd proj && echo "inside proj")
false && echo "A" || echo "B"
```

```text
inside proj
B
```

The parentheses on the first line run it in a subshell, so the `cd` does not change your own shell's directory. Without them you would stay in `proj` and the later files would land there.

`a && b || c` looks like `if a then b else c`, but it is not the same: if `a` succeeds and `b` fails, `c` runs too. Use a real `if` when both branches matter.

`if` takes a command, not a condition. It runs the command and checks the exit code:

```bash
if grep -q "localhost" /etc/hosts; then
  echo "found"
else
  echo "missing"
fi
```

```text
found
```

`-q` makes `grep` print nothing and only set the exit code, which is exactly what an `if` wants. `[` is a command and `[[` is a shell keyword; both set an exit code that `if` reads (more on that below).

## Variables

A variable is assigned with `name=value`. There must be **no spaces** around the `=`. With a space, the shell reads `name` as a command and `=value` as its argument.

```bash
name="Ada"
echo "Hi, ${name}!"
echo "${missing:-default}"
echo "${#name}"
```

```text
Hi, Ada!
default
3
```

- `$name` and `${name}` are the same. Use the braces when the next character could be part of a name (`${name}_backup`).
- `${var:-default}` expands to `default` when `var` is unset or empty. `${var:=default}` also assigns it.
- `${var:?message}` stops the script with `message` when `var` is unset or empty. It is the cheapest safety check there is.
- `${#var}` is the length.
- `${var#prefix}`, `${var%suffix}` remove a prefix or suffix. `${file%.txt}` strips the extension; `${path##*/}` keeps what is after the last slash.

Variables are local to the current shell. `export` copies a variable into the environment of the programs it starts (**child processes**); it never travels back up.

```bash
GREETING=hello
bash -c 'echo "child sees: [$GREETING]"'
export GREETING
bash -c 'echo "child sees: [$GREETING]"'
```

```text
child sees: []
child sees: [hello]
```

### Command substitution

`$(command)` runs a command and puts its output in the place of the expression, minus trailing newlines. The older form with backticks does the same, but it does not nest cleanly and is hard to read. Use `$(...)`.

```bash
today=$(date -u +%F)
echo "report-${today}.txt"
echo "files here: $(ls | wc -l)"
```

```text
report-2026-10-17.txt
files here: 1
```

_Illustrative: the date and the count differ._

## Quoting, word splitting and globbing

This section explains most Bash bugs. When the shell expands a variable that is **not in quotes**, it does two more things to the result: it splits it into words at every space, tab and newline (**word splitting**), and it replaces any word containing `*`, `?` or `[` with matching file names (**globbing**). Double quotes switch both off.

```bash
touch "my file.txt"
f="my file.txt"
ls -l $f
ls -l "$f"
```

```text
ls: cannot access 'my': No such file or directory
ls: cannot access 'file.txt': No such file or directory
-rw-r--r-- 1 student student 0 Oct 17 10:00 my file.txt
```

_Illustrative: owner and time differ._

The unquoted form gave `ls` two arguments, `my` and `file.txt`. With `rm`, the same mistake deletes the wrong files. **Rule: always write `"$var"`**, and quote `"$(command)"` too. Leave the quotes off only when you want splitting, and then add a comment that says so.

The three kinds of quotes:

| Form    | Behaviour                                                              |
| ------- | ---------------------------------------------------------------------- |
| `"..."` | Expands `$var`, `$(cmd)` and `$((math))`. No splitting, no globbing.   |
| `'...'` | Nothing expands. Everything is literal. Use it for regex and awk code. |
| `\x`    | Escapes the next single character.                                     |

> [!danger] The classic disaster
> Think about `rm -rf $DIR/` when `DIR` is unset or empty. The variable vanishes and the command becomes `rm -rf /`. Quoting alone does not help, because `"$DIR/"` is still `/`. What helps is refusing to run with an empty value: `rm -rf -- "${DIR:?DIR is not set}/"`. Try it safely with `echo` first, as in the exercises.

## Arguments to a script

Inside a script, `$1`, `$2`, ... are the arguments, `$0` is the script name, and `$#` is the count. `"$@"` expands to all arguments, each as a separate word, with its internal spaces kept. `"$*"` joins them into one word.

```bash
cat > args.sh <<'EOF'
#!/usr/bin/env bash
echo "count=$#"
for a in "$@"; do echo "[$a]"; done
echo "--- with \$*"
for a in "$*"; do echo "[$a]"; done
echo "--- unquoted \$@"
for a in $@; do echo "[$a]"; done
EOF
chmod +x args.sh
./args.sh one "two words" three
```

```text
count=3
[one]
[two words]
[three]
--- with $*
[one two words three]
--- unquoted $@
[one]
[two]
[words]
[three]
```

Use `"$@"` when you pass arguments on to another command: `exec docker run "$@"`. An unquoted `$@` loses the grouping, which is the same word-splitting trap again.

### Your first real script, with usage and an exit code

```bash
cat > greet.sh <<'EOF'
#!/usr/bin/env bash
# greet.sh - print a greeting. Usage: greet.sh NAME [GREETING]

if [[ $# -lt 1 ]]; then
  echo "Usage: ${0##*/} NAME [GREETING]" >&2
  exit 1
fi

name="$1"
greeting="${2:-Hello}"
echo "${greeting}, ${name}!"
EOF
chmod +x greet.sh
./greet.sh
echo "exit=$?"
./greet.sh Ada
./greet.sh Ada Hi
```

```text
Usage: greet.sh NAME [GREETING]
exit=1
Hello, Ada!
Hi, Ada!
```

Two details matter. The usage message goes to **standard error** (`>&2`), so it does not pollute output that another program reads. And `${2:-Hello}` gives an optional argument a default. By the convention above a usage error should exit `2`, but `1` is fine for a first script. [[learn/safe-bash-scripts|Scripting 02]] settles the convention.

## Tests: double brackets, numbers and strings

`[[ expression ]]` is a Bash keyword that evaluates a condition and sets the exit code. The older `[ expression ]` is an ordinary command (it is a program called `[`, and `]` is its last argument), which is why it needs quoting care that `[[` does not.

```bash
[ -f /etc/hosts ] && echo "is a file"
n=10
[[ $n -eq 10 ]] && echo "numeric equal"
[[ "10" == "10.0" ]] || echo "different as strings"
[[ hello == h* ]] && echo "glob match"
[[ hello =~ ^h.l+o$ ]] && echo "regex match"
```

```text
is a file
numeric equal
different as strings
glob match
regex match
```

Why prefer `[[`:

```bash
e=""
[ $e = x ]; echo "rc=$?"
[[ $e = x ]]; echo "rc=$?"
```

```text
bash: [: =: unary operator expected
rc=2
rc=1
```

With `[`, the unquoted empty `$e` disappears, so `[` sees `= x` and complains. `[[` knows it is parsing a condition, so it does not split or glob inside it. Always use `[[` in Bash scripts; use `[` only when you target plain `sh`.

Common tests:

| Test                               | True when                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `-e path`, `-f`, `-d`              | The path exists, is a regular file, is a directory.                                |
| `-r`, `-w`, `-x`                   | Readable, writable, executable by you.                                             |
| `-s file`                          | The file exists and is not empty.                                                  |
| `-z "$s"`, `-n "$s"`               | The string is empty, is not empty.                                                 |
| `"$a" == "$b"`, `!=`               | String comparison. `==` and `=` match; right side is a glob pattern unless quoted. |
| `"$a" =~ regex`                    | Extended regex match (do not quote the regex).                                     |
| `$a -eq $b`, `-ne -lt -le -gt -ge` | Integer comparison.                                                                |

Mixing the two families is a common bug: `-eq` only understands integers (`[[ $n -eq 10.0 ]]` is an error), and `==` compares text (`"10" == "10.0"` is false). Inside `(( ))` you can write numeric comparisons with `<`, `>=` and `==`, as shown later.

### if, elif and case

```bash
used=85
if (( used >= 90 )); then
  echo "CRIT"
elif (( used >= 80 )); then
  echo "WARN"
else
  echo "OK"
fi
```

```text
WARN
```

When you compare one value against several fixed choices, `case` is clearer than a chain of `elif`:

```bash
cat > envhost.sh <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  dev)         host="dev.example.com" ;;
  stage | test) host="stage.example.com" ;;
  prod)        host="www.example.com" ;;
  *)
    echo "unknown environment: '${1:-}' (use dev, stage or prod)" >&2
    exit 2
    ;;
esac
echo "$host"
EOF
chmod +x envhost.sh
./envhost.sh dev
./envhost.sh qa
echo "exit=$?"
```

```text
dev.example.com
unknown environment: 'qa' (use dev, stage or prod)
exit=2
```

Each branch ends with `;;`. Patterns are globs, `|` means "or", and `*` is the catch-all. The `*)` branch is where you reject input you do not know. Exit code `2` is the "wrong usage" convention. `example.com` is a reserved name, so this script is safe to publish.

## Redirection recap

You met these in [[learn/linux-shell-and-filesystem|Linux 01]]. In scripts they appear constantly:

| Form                   | Meaning                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `cmd > f`              | Write stdout to `f`, replacing it.                                           |
| `cmd >> f`             | Append stdout to `f`.                                                        |
| `cmd 2> f`             | Write stderr to `f`.                                                         |
| `cmd > f 2>&1`         | Both streams to `f`. Order matters: `2>&1` copies where stdout points _now_. |
| `cmd &> f`             | Bash shorthand for the line above.                                           |
| `cmd < f`              | Read stdin from `f`.                                                         |
| `cmd >&2`              | Send this command's stdout to stderr. Used for messages.                     |
| `cmd > /dev/null 2>&1` | Throw everything away.                                                       |

A rule of thumb for scripts: **data goes to stdout, messages go to stderr.** Then `./script.sh > result.txt` captures only the data.

## Loops

### for over a list, and over files

```bash
for env in dev stage prod; do
  echo "deploying to ${env}"
done
```

```text
deploying to dev
deploying to stage
deploying to prod
```

To loop over files, use a glob. Never loop over `$(ls)`. The output of `ls` is split on whitespace, so a file called `my file.txt` becomes two items.

```bash
touch "a b.txt" c.txt
for f in $(ls *.txt); do echo "[$f]"; done
echo
for f in *.txt; do echo "[$f]"; done
```

```text
[a]
[b.txt]
[c.txt]

[a b.txt]
[c.txt]
```

There is one more catch. When a glob matches nothing, Bash leaves the pattern as it is, so the loop runs once with the literal text `*.log`:

```bash
mkdir -p empty && cd empty
for f in *.log; do echo "[$f]"; done
cd ..
```

```text
[*.log]
```

`shopt -s nullglob` changes that: a glob with no match expands to nothing, so the loop body never runs. The next script uses it together with an **array**, which stores the matches safely.

```bash
cat > count_ext.sh <<'EOF'
#!/usr/bin/env bash
# count_ext.sh EXT - count files with the extension in the current directory
ext="${1:?usage: count_ext.sh EXT}"
shopt -s nullglob
files=( *."$ext" )
echo "count=${#files[@]}"
EOF
chmod +x count_ext.sh
(cd empty && ../count_ext.sh log)
mkdir -p full && cd full && touch a.log b.log "c d.log" e.txt && ../count_ext.sh log && cd ..
```

```text
count=0
count=3
```

### while read: process a file line by line

```bash
cat > hosts.sample <<'EOF'
# sample hosts file
127.0.0.1 localhost

192.0.2.10 web-1.example.com
198.51.100.7 db-1.example.com   # primary
EOF

while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  echo "> $line"
done < hosts.sample
```

```text
> 127.0.0.1 localhost
> 192.0.2.10 web-1.example.com
> 198.51.100.7 db-1.example.com   # primary
```

Read the loop header piece by piece. `read` reads one line into `line`. `IFS=` (an empty field separator, set just for this command) stops `read` from trimming leading and trailing whitespace. `-r` stops it from treating a backslash as an escape. Without these two, `read` silently changes your data. The loop ends when `read` hits end of file. `< hosts.sample` feeds the file into the whole loop.

`continue` skips to the next iteration; `break` leaves the loop. Here, `continue` skips blank lines and comments. The rest of the lines print.

To split each line into fields, give `read` several variable names: `while read -r ip name _; do ...`. Fields are separated by `IFS` (whitespace by default), and the last variable receives the remainder.

## Functions

A function is a named block of commands. It receives its arguments as `$1`, `$2`, ... of its own, and `local` keeps its variables from leaking into the rest of the script.

```bash
add() {
  local a="$1" b="$2"
  echo $(( a + b ))
}
sum=$(add 2 3)
echo "sum=${sum}"
```

```text
sum=5
```

A function has two ways of giving back a result, and they are different things:

- **`return N`** sets the exit code (0 to 255). It cannot return text or large numbers. Use it for success or failure.
- **`echo`** (or `printf`) writes to stdout, and the caller captures it with `$(...)`. Use it for data.

```bash
is_even() { (( $1 % 2 == 0 )); }
if is_even 4; then echo "4 is even"; fi
is_even 3; echo "rc=$?"
```

```text
4 is even
rc=1
```

The function's exit code is the exit code of its last command, here the arithmetic test. This is how most "predicate" functions are written. Anything else a function prints to stdout becomes part of what the caller captures, so send log messages to stderr.

A retry helper shows `return` carrying the last failure up to the caller:

```bash
cat > retry.sh <<'EOF'
#!/usr/bin/env bash
# retry MAX CMD... - run CMD up to MAX times; return the last exit code

retry() {
  local max="$1"; shift
  local attempt=1 rc=0
  while (( attempt <= max )); do
    "$@" && return 0
    rc=$?
    echo "attempt ${attempt}/${max} failed with exit code ${rc}" >&2
    (( attempt++ ))
  done
  return "$rc"
}

retry 3 bash -c 'exit 7'
echo "retry returned $?"
retry 3 true
echo "retry returned $?"
EOF
bash retry.sh
```

```text
attempt 1/3 failed with exit code 7
attempt 2/3 failed with exit code 7
attempt 3/3 failed with exit code 7
retry returned 7
retry returned 0
```

`shift` drops `$1`, so `"$@"` is now the command to run. A real retry would also sleep between attempts, and you should only retry operations that are safe to repeat.

> [!note] set -e and (( attempt++ ))
> `(( expression ))` returns exit code `1` when the expression evaluates to `0`. With `attempt` starting at 1 that never happens here, but in a script with `set -e` (next lesson) `(( count++ ))` with `count=0` would stop the script. Write `count=$(( count + 1 ))` instead.

## Arrays

An **indexed array** holds a list, and each element keeps its spaces. It is the right tool when you would otherwise build a string of items.

```bash
files=(a.txt "b c.txt" d.txt)
echo "${#files[@]}"
echo "${files[1]}"
printf '[%s]\n' "${files[@]}"
files+=(e.txt)
echo "${#files[@]}"
```

```text
3
b c.txt
[a.txt]
[b c.txt]
[d.txt]
4
```

`"${files[@]}"` expands to one word per element, the array equivalent of `"$@"`. `${#files[@]}` is the number of elements. Counting starts at 0.

An **associative array** maps keys to values. It needs Bash 4 or newer and a `declare -A`.

```bash
cat > ports.sh <<'EOF'
#!/usr/bin/env bash
declare -A ports=( [http]=80 [https]=443 [ssh]=22 )
ports[postgres]=5432
echo "https is ${ports[https]}"
for name in "${!ports[@]}"; do
  echo "$name ${ports[$name]}"
done | sort
echo "count=${#ports[@]}"
if [[ -v ports[ssh] ]]; then echo "ssh is known"; fi
EOF
bash ports.sh
```

```text
https is 443
http 80
https 443
postgres 5432
ssh 22
count=4
ssh is known
```

`"${!ports[@]}"` lists the keys. Bash does not keep a stable order for them, so the loop output goes through `sort` to make it predictable. `[[ -v ports[ssh] ]]` tests whether a key exists.

> [!warning] Check before relying on this
> Associative arrays need Bash 4 or newer. Linux distributions ship it. macOS ships a much older Bash, so a script that runs on a Mac needs testing there (not verified here).

## Heredocs and here-strings

A **heredoc** feeds several lines to a command's stdin. The word after `<<` marks the end. With a plain delimiter, variables expand; with a quoted delimiter (`'EOF'`), the text is literal.

```bash
user=ada
cat <<EOF
User: $user
Home: $HOME
EOF
echo ---
cat <<'EOF'
User: $user
Home: $HOME
EOF
```

```text
User: ada
Home: /home/student
---
User: $user
Home: $HOME
```

_Illustrative: `HOME` differs._

Use the quoted form when you write a script or config file out of a script: otherwise the outer shell expands the `$` signs you meant for the file. This lesson used `<<'EOF'` for exactly that reason when it created `hello.sh`. A **here-string** (`<<<`) is a one-line version: `grep -c o <<< "foo boo"` prints `1`.

## Arithmetic

Bash does integer arithmetic only. `$(( expr ))` gives the result as text; `(( expr ))` is a command that succeeds when the result is not zero and can assign.

```bash
x=7
(( x *= 2 ))
echo "$x"
echo $(( 10 / 3 )) $(( 10 % 3 ))
```

```text
14
3 1
```

Division truncates (`10 / 3` is `3`). For decimals use `awk` or `bc`. Inside `(( ))` and `$(( ))`, names are variables without a `$`. An unset or non-numeric name counts as `0`, which hides typos: `y=abc; echo $(( y + 1 ))` prints `1`.

## Capturing output and exit codes

You often need both the output of a command and its success. Assign first, then test:

```bash
if out=$(grep -c localhost hosts.sample); then
  echo "matches: ${out}"
else
  echo "grep failed or found nothing (rc=$?)"
fi
```

```text
matches: 1
```

In an `if` the assignment's exit code is the command's, so one statement does both jobs. Remember that `$(...)` captures only stdout. Add `2>&1` inside it to capture the error text too.

## The pipeline subshell trap

Every stage of a pipeline runs in its own **subshell**, a child copy of the shell. Variables set in a child never reach the parent. This is why the following counter stays at zero:

```bash
count=0
cat hosts.sample | while read -r line; do (( count++ )); done
echo "count=${count}"

count=0
while read -r line; do (( count++ )); done < hosts.sample
echo "count=${count}"
```

```text
count=0
count=5
```

In the first form the `while` loop is the right-hand side of a pipe, so it runs in a subshell that increments its own copy of `count`, then exits. In the second the loop reads from a file redirect and runs in the main shell. The fixes, in order of preference:

1. Redirect a file into the loop: `done < file`.
2. Use **process substitution** for a command: `done < <(command)`. The command runs in the background and the loop stays in the main shell.
3. In a script, `shopt -s lastpipe` runs the last stage of a pipeline in the current shell. It does nothing in an interactive shell with job control on (not verified for every Bash version).

## Hands-on exercises

Work in `~/lab15`. The scripts are the ones created above. Output is illustrative where it depends on your machine.

1. **Shebang and execute bit.** First remove the execute bit you added above with `chmod -x hello.sh`. Then run `bash hello.sh`, then `./hello.sh; echo "exit=$?"`, then `chmod +x hello.sh` and `./hello.sh` again.
   Expected: `hello from hello.sh`; then `bash: ./hello.sh: Permission denied` with `exit=126`; then `hello from ./hello.sh`.
   If you see something else: `bad interpreter` means a typo in the shebang. `No such file or directory` on a script that exists can mean Windows line endings. Run `file hello.sh` and convert with `sed -i 's/\r$//' hello.sh`.

2. **Usage and exit code.** Run `./greet.sh; echo "exit=$?"`, then `./greet.sh Ada`, then `./greet.sh Ada Hi`, then `./greet.sh 2>/dev/null; echo "exit=$?"`.
   Expected: the usage line and `exit=1`; `Hello, Ada!`; `Hi, Ada!`; and only `exit=1` (the usage text went to stderr and was discarded).
   If you see something else: if the usage text still shows with `2>/dev/null`, the `>&2` is missing and the message goes to stdout.

3. **Quoted and unquoted.** Run `touch "my file.txt"; f="my file.txt"; ls -l $f; ls -l "$f"`.
   Expected: two `cannot access` errors (for `my` and `file.txt`) and then one listing of `my file.txt`.
   If you see something else: if both work, the file name has no space. Check what you typed in `f=`.

4. **Disk usage with awk.** Run `df -P / | awk 'NR==2 {gsub("%","",$5); print $5}'`. Then put it in a variable and branch on it:

   ```bash
   used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
   if (( used >= 90 )); then echo "CRIT"; elif (( used >= 80 )); then echo "WARN"; else echo "OK"; fi
   ```

   Expected: a number such as `81`, then `OK`, `WARN` or `CRIT` for your machine. Change the thresholds to prove each branch works.
   If you see something else: `df -P` forces one-line-per-filesystem POSIX output, so `NR==2` is the data row. Without `-P`, a long device name can wrap onto two lines and shift the columns.

5. **Environment mapping with case.** Run `./envhost.sh dev`, `./envhost.sh test`, `./envhost.sh qa; echo "exit=$?"`.
   Expected: `dev.example.com`, `stage.example.com`, then the "unknown environment" message and `exit=2`.
   If you see something else: if `qa` prints an empty line, the `*)` branch is missing or comes first.

6. **count_ext.sh in an empty directory.** From `~/lab15` run `(cd empty && ../count_ext.sh log)`, then `(cd full && ../count_ext.sh log)`.
   Expected: `count=0`, then `count=3` (the `c d.log` file counts as one).
   If you see something else: `count=1` in the empty directory means `nullglob` is not set, so the literal `*.log` was counted.

7. **Read a file and skip comments.** Run the `while IFS= read -r` loop on `hosts.sample`, then on `/etc/hosts`.
   Expected: the three non-comment lines of `hosts.sample`. For `/etc/hosts`, your own entries.
   If you see something else: if comment lines appear, check the test `"$line" == \#*`. The backslash keeps `#` from starting a shell comment.

8. **retry returns the last code.** Run `bash retry.sh`.
   Expected: three `attempt N/3 failed with exit code 7` lines, `retry returned 7`, then `retry returned 0`.
   If you see something else: if the first `retry returned` shows `1`, you read `$?` after `(( attempt++ ))`. Capture `rc=$?` right after the command, as the script does.

9. **Associative array, sorted.** Run `bash ports.sh`.
   Expected: the lines shown in the section, with `http`, `https`, `postgres`, `ssh` in alphabetical order.
   If you see something else: `declare: -A: invalid option` means an old Bash (check `bash --version`; it must be 4 or newer). A different order means the `| sort` is missing.

10. **The subshell trap.** Run the two counting loops from the previous section.
    Expected: `count=0`, then `count=5` for `hosts.sample`.
    If you see something else: if both print `5`, you ran in an environment where the last pipe stage is not in a subshell (for example `zsh` or `lastpipe`). Run `bash` explicitly.

11. **Rehearse the disaster safely.** Run `unset DIR; echo rm -rf "$DIR/"` and then `unset DIR; echo rm -rf -- "${DIR:?DIR is not set}/"`.
    Expected: `rm -rf /`, then `bash: DIR: DIR is not set`. The first line is what would have been run, which is why the second form exists.
    If you see something else: never replace `echo` with the real `rm` in this exercise.

## Common mistakes

- **Spaces around `=`.** `name = "Ada"` runs a command called `name`. Write `name="Ada"`.
- **Unquoted variables.** A value with a space, or a `*`, becomes several arguments or a file list. Write `"$var"` and `"$(cmd)"`.
- **Looping over `$(ls)`.** File names with spaces split into pieces. Loop over a glob, and set `shopt -s nullglob` when an empty match is possible.
- **`[ ]` and unquoted variables.** `[ $x = y ]` fails when `x` is empty. Use `[[ ]]`.
- **`-eq` on strings, `==` on numbers.** `-eq` is integer-only and `==` is text. Pick the one that matches the data, or use `(( ))` for numbers.
- **`a && b || c` as if/else.** If `b` fails, `c` also runs. Use `if`.
- **`read` without `IFS=` and `-r`.** It trims whitespace and eats backslashes. Always `while IFS= read -r line`.
- **Changing variables inside `cmd | while`.** The loop runs in a subshell and the change is lost. Redirect a file or use `< <(cmd)`.
- **Messages on stdout.** A script whose log lines go to stdout corrupts its own output when someone pipes it. Send messages to stderr.
- **Forgetting to check the exit code.** A failed `cd` followed by `rm *` deletes in the wrong place. Chain with `&&`, or use the strict mode in the next lesson.

## Check your understanding

1. What does `rm -rf "$DIR/"` do when `DIR` is unset, and what is the safer way to write it?
2. What is the difference between `[[ ... ]]` and `[ ... ]`, and why prefer the first in a Bash script?
3. Why does the counter print `0` after `cat file | while read -r l; do (( n++ )); done`, and how do you fix it?
4. Why do you write `"$@"` and not `$@` or `"$*"` when forwarding arguments?
5. A script exits `2` for a bad option and `1` when a download fails. What does the caller gain from that?
6. Why does `for f in $(ls *.txt)` fail on a file called `a b.txt`, and what replaces it?

> [!question]- Answers
>
> 1. The variable expands to nothing and the command becomes `rm -rf /`, which tries to delete everything it is allowed to. The safer form stops the script when the variable is empty: `rm -rf -- "${DIR:?DIR is not set}/"`. Check paths before destructive commands, and rehearse with `echo`.
> 2. `[` is an ordinary command, so the shell has already split and globbed its arguments, and an empty unquoted variable disappears. `[[` is part of the language: it does not split or glob its operands, supports `==` patterns and `=~` regex, and allows `&&` and `||` inside. Use `[` only for plain `sh` scripts.
> 3. The right side of a pipe runs in a subshell, so the increments change a copy of `n` that disappears. Use `done < file`, or `done < <(command)`, so the loop runs in the main shell.
> 4. `"$@"` keeps each argument as its own word, including arguments with spaces. `$@` unquoted splits them again, and `"$*"` joins them into a single word.
> 5. Callers, cron and CI can tell a usage error (fix the command line, do not retry) from a runtime failure (maybe retry). Distinct codes make automation and troubleshooting simpler.
> 6. `ls` output is split on whitespace, giving `a` and `b.txt`. Loop over the glob directly, `for f in *.txt`, with `"$f"` quoted in the body.

## Next steps

Next lesson: [[learn/safe-bash-scripts|Scripting 02: Safe Bash: strict mode, traps and ShellCheck]]. Previous lesson: [[learn/pull-requests-and-code-review|Git 03: Pull requests and code review]].

To go deeper:

- [[standards/bash-scripts]] is the team standard that these habits build towards.
- [[learn/text-and-data-tools|Linux 03]] covers the tools your scripts will call most: `grep`, `awk`, `sed`, `find` and `jq`.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- GNU Bash Reference Manual (https://www.gnu.org/software/bash/manual/), in particular "Shell Expansions", "Shell Parameter Expansion", "Conditional Constructs", "Bash Conditional Expressions" and "Arrays". The examples in this lesson were run with GNU bash 5.2.21 on Ubuntu 24.04 LTS; the `lastpipe` note and the macOS Bash note were not tested.
- Greg's Wiki, BashFAQ 001, "How can I read a file line by line?" (https://mywiki.wooledge.org/BashFAQ/001) and "Quotes" (https://mywiki.wooledge.org/Quotes).
- Google Shell Style Guide (https://google.github.io/styleguide/shellguide.html).
- POSIX Shell Command Language, for the `sh` behaviour mentioned in the shebang note (https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html).
