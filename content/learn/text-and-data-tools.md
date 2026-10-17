---
title: "Linux 03: Text and data tools: grep, sed, awk, find, regex, jq and yq"
description: Find the needle in a log, edit config safely and query JSON and YAML from the command line with grep, sed, awk, find, regular expressions, jq and yq.
type: guide
tags:
  - learning
  - linux
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 5 h | You need: [[learn/linux-users-permissions-sudo-and-ssh|Linux 02: Users, permissions, sudo and SSH access]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]]

Most operations work is reading text: logs, config files, command output and JSON from cloud APIs. The tools in this lesson are small, old and everywhere. Learn them well and you can answer "what is going wrong?" on a server with nothing installed except the base system.

## What you will learn

- How streams and pipes connect small tools into a pipeline.
- Enough regular expression syntax to write patterns you can trust, and the three dialects you will meet.
- How to search with `grep`, edit with `sed`, summarise with `awk`, and combine them with `sort`, `uniq`, `cut`, `tr` and `wc`.
- How to use `find` safely, including file names with spaces.
- How to query JSON with `jq` and YAML with `yq`, and when to stop using `grep` on structured data.

## Streams: a quick recap

Every program has standard input (stdin), standard output (stdout) and standard error (stderr). A pipe (`|`) connects one program's stdout to the next program's stdin. That is all a pipeline is. The text tools below read stdin when you give no file name, which is why they chain so well. If you need a refresher on redirection, see [[learn/linux-shell-and-filesystem|Linux 01]].

Exit status matters too: `0` means success, anything else means something. `grep` uses it to tell you whether it found a match, as shown below.

## The lab data

Several examples use one small web access log. Create it once with a heredoc. The addresses come from the documentation ranges, so they are not real hosts.

```bash
mkdir -p ~/lab03 && cd ~/lab03
cat > access.log <<'EOF'
203.0.113.10 - - [17/Oct/2026:10:00:01 +0000] "GET /index.html HTTP/1.1" 200 512
203.0.113.10 - - [17/Oct/2026:10:00:02 +0000] "GET /api/orders HTTP/1.1" 500 87
198.51.100.7 - - [17/Oct/2026:10:00:03 +0000] "GET /api/orders HTTP/1.1" 200 1310
198.51.100.7 - - [17/Oct/2026:10:00:04 +0000] "POST /api/login HTTP/1.1" 401 42
192.0.2.55 - - [17/Oct/2026:10:00:05 +0000] "GET /api/orders HTTP/1.1" 500 87
192.0.2.55 - - [17/Oct/2026:10:00:06 +0000] "GET /healthz HTTP/1.1" 200 2
203.0.113.10 - - [17/Oct/2026:10:00:07 +0000] "GET /api/users HTTP/1.1" 503 0
203.0.113.10 - - [17/Oct/2026:10:00:08 +0000] "GET /index.html HTTP/1.1" 304 0
EOF
wc -l access.log
```

```text
8 access.log
```

Splitting each line on spaces gives numbered fields: field 1 is the client address, 7 is the path, 9 is the status code and 10 is the response size. `awk` counts fields from 1.

## Regular expressions

A **regular expression** (regex) is a pattern that describes a set of strings. Tools use it to decide whether a line matches, and sometimes to pick out the matching part.

| Piece       | Meaning                                                 | Example                              |
| ----------- | ------------------------------------------------------- | ------------------------------------ |
| literal     | Matches itself.                                         | `error` matches the letters `error`. |
| `.`         | Any one character.                                      | `a.c` matches `abc` and `a-c`.       |
| `[abc]`     | One character from the set. `[a-z]` is a range.         | `[0-9]` is one digit.                |
| `[^abc]`    | One character not in the set.                           | `[^ ]` is one non-space.             |
| `^` and `$` | Start and end of the line.                              | `^ERROR` only matches at the start.  |
| `*` `+` `?` | Zero or more, one or more, zero or one of the previous. | `x[0-9]+` matches `x1` and `x22`.    |
| `{n,m}`     | Between n and m repeats.                                | `[0-9]{3}` is exactly three digits.  |
| `( )`       | Group, and remember the match.                          | `(ab)+` matches `abab`.              |
| `a\|b`      | Either side (alternation).                              | `error\|warn`.                       |

Two ideas cause most regex trouble.

**Greedy versus lazy.** `*` and `+` take as much as they can. In `<b>a</b><b>c</b>`, the pattern `<b>.*</b>` matches the whole string, because `.*` runs to the last `</b>`. A lazy quantifier (`.*?`) takes as little as possible and matches `<b>a</b>` only. Lazy quantifiers exist in PCRE (Perl-compatible) and Python, not in POSIX ERE.

**Three dialects.** Tools differ on which characters are special.

| Dialect | Where                          | Notes                                                                      |
| ------- | ------------------------------ | -------------------------------------------------------------------------- |
| BRE     | `grep`, `sed` by default       | `+ ? ( ) { } \|` are literal. GNU adds backslash forms such as `\+`, `\|`. |
| ERE     | `grep -E`, `sed -E`, `awk`     | `+ ? ( ) { } \|` are special without backslashes. Start here.              |
| PCRE    | `grep -P`, Python, many others | Adds `\d`, `\w`, lazy quantifiers and lookarounds. `grep -P` is GNU only.  |

When a pattern "does not work" on one machine, check the dialect first. In this lesson, use `-E` with `grep` and `sed`, and use `-P` only where noted.

## grep: find the lines that matter

`grep pattern file` prints matching lines. The flags you will use daily:

| Flag        | What it does                                                |
| ----------- | ----------------------------------------------------------- |
| `-i`        | Ignore case.                                                |
| `-v`        | Invert: print lines that do not match.                      |
| `-n`        | Show line numbers.                                          |
| `-c`        | Print only the count of matching lines.                     |
| `-o`        | Print only the matching part of each line.                  |
| `-E`        | Use extended regular expressions.                           |
| `-r`        | Recurse into directories.                                   |
| `-w`        | Match whole words only.                                     |
| `-A n -B n` | Print n lines after or before each match (`-C n` for both). |

```bash
grep -c ' 500 ' access.log
grep -n 'POST' access.log
grep -E ' (4|5)[0-9]{2} ' access.log | wc -l
```

```text
2
4:198.51.100.7 - - [17/Oct/2026:10:00:04 +0000] "POST /api/login HTTP/1.1" 401 42
4
```

### Exit codes

`grep` exits `0` if it found a match, `1` if it ran fine and found none, and `2` on an error such as a missing file. Scripts rely on this: `if grep -q ERROR app.log; then ...` works because `-q` stays quiet and just sets the status. The difference between 1 and 2 matters. A typo in a file name must not look like "no errors found".

```bash
echo zzz | grep nomatch;  echo "exit=$?"
grep x /nonexistent;      echo "exit=$?"
```

```text
exit=1
grep: /nonexistent: No such file or directory
exit=2
```

### Why 'error|warn' matches "warning"

`grep -E 'error|warn'` matches any line containing the letters `warn`, and that includes `warning` and `forewarned`. A pattern matches anywhere in the line unless you anchor it. If you want the whole word, use `-w` or word boundaries, and group the alternation:

```bash
echo "error warning" | grep -oE 'error|warn'
echo "error warning" | grep -owE 'error|warn'
```

```text
error
warn
error
```

The first prints `warn` because it found those four letters inside `warning`. The second prints only `error` because `-w` requires a whole word.

## sed: edit streams

`sed` reads lines, applies commands and prints the result. The command you will use most is substitution: `s/old/new/flags`.

```bash
echo "GET /a GET /b" | sed 's/GET/FETCH/'
echo "GET /a GET /b" | sed 's/GET/FETCH/g'
```

```text
FETCH /a GET /b
FETCH /a FETCH /b
```

Without `g`, only the first match on each line changes. An **address** limits which lines a command touches: `sed '3s/a/b/'` only line 3, `sed '2,4d'` deletes lines 2 to 4, and `sed '/^#/d'` deletes comment lines. Use `-E` for extended regex, and `-n` with the `p` command to print only chosen lines (`sed -n '2,4p'`).

### Editing a file in place, safely

`sed -i` changes the file itself. Always keep a backup and look at the difference before you trust the result.

```bash
cp access.log app.conf
sed -i.bak 's/GET/FETCH/' app.conf
diff app.conf.bak app.conf | head -4
```

```text
1,3c1,3
< 203.0.113.10 - - [17/Oct/2026:10:00:01 +0000] "GET /index.html HTTP/1.1" 200 512
< 203.0.113.10 - - [17/Oct/2026:10:00:02 +0000] "GET /api/orders HTTP/1.1" 500 87
```

_Illustrative: your diff may show more lines._

> [!warning] GNU sed and BSD sed differ on -i
> On Linux (GNU sed) `-i` alone edits in place and `-i.bak` keeps a backup. On macOS (BSD sed) `-i` requires a suffix argument, so `-i.bak` works on both, but `-i 's/a/b/' file` breaks on macOS (it reads the script as a suffix). Writing `-i.bak` everywhere is the portable habit. Not verified on macOS in this lab.

## awk: fields, patterns and summaries

`awk` splits each line into fields (on whitespace by default), and runs `pattern { action }` for each line. `$1` is the first field, `$NF` the last, and `$0` the whole line. `-F` sets the separator, for example `-F,` for CSV (simple CSV only: quoted commas break it).

Count requests per status code:

```bash
awk '{print $9}' access.log | sort | uniq -c | sort -rn
```

```text
      3 200
      2 500
      1 503
      1 401
      1 304
```

_Illustrative: lines with equal counts may appear in a different order._

This is the classic pipeline: extract the field, `sort` it so equal values touch, count with `uniq -c` (which only counts adjacent duplicates, so sorting first is required), then sort by the count, largest first.

`awk` can do the counting itself with an **associative array**, an array indexed by text. This answers "which endpoints return server errors, and how often":

```bash
awk '$9 >= 500 {c[$7]++} END {for (p in c) printf "%-14s %d\n", p, c[p]}' access.log | sort -k2 -rn
```

```text
/api/orders    2
/api/users     1
```

Read it left to right: for every line where field 9 is at least 500, add one to the counter for the path in field 7. `END` runs after the last line. `printf` formats the output, here a path padded to 14 characters, then the count. Totals work the same way: `awk '{b[$1]+=$10} END{for(i in b) print i, b[i]}'` sums bytes per client.

### The small tools around them

| Tool      | Use                                                                          |
| --------- | ---------------------------------------------------------------------------- |
| `sort`    | Order lines. `-n` numeric, `-r` reverse, `-u` unique, `-k2` by second field. |
| `uniq -c` | Count adjacent identical lines. Always `sort` first.                         |
| `cut`     | Take columns: `cut -d' ' -f1` is the first space-separated field.            |
| `tr`      | Translate or delete characters: `tr 'a-z' 'A-Z'`, `tr -d '\r'`.              |
| `wc -l`   | Count lines.                                                                 |

```bash
cut -d' ' -f1 access.log | sort -u | wc -l
```

```text
3
```

## find: locate files by what they are

`find path tests actions` walks a tree and tests each entry. Tests (predicates) include `-name '*.log'`, `-type f` or `d`, `-mtime +7` (modified more than 7 days ago), `-size +100M` and `-user`. Quote globs so the shell does not expand them first.

To act on matches, you have three options, and the choice matters.

- `-exec cmd {} \;` runs the command once for each file. Safe but slow on large sets.
- `-exec cmd {} +` packs many files into each command, like `xargs`. Fast, and file names with spaces are safe.
- `-print0 | xargs -0 -r cmd` prints names separated by NUL bytes (the only character that cannot appear in a path) and `xargs -0` splits on them. `-r` means do nothing when there is no input.

```bash
mkdir -p ft && cd ft && touch 'a b.log' c.log
find . -name '*.log' -print0 | xargs -0 -r gzip -k
ls
cd ..
```

```text
a b.log
a b.log.gz
c.log
c.log.gz
```

Plain `find ... | xargs gzip` would split `a b.log` into two arguments, `a` and `b.log`, and fail. That is why `-print0` and `-0` come as a pair.

### Do not parse ls

`ls` output is for humans. File names can contain spaces, newlines and other surprises, and `ls` formats differ by locale. In scripts, use globs (`for f in *.log`) or `find`, never `for f in $(ls)`.

### Stop grepping structured data

`grep` treats JSON and YAML as lines of text. JSON may be minified onto one line, keys can appear in any order and nested objects repeat names. `grep '"status"'` finds every `status` at any depth, which is rarely what you want. When the data has structure, use a tool that understands the structure: `jq` for JSON and `yq` for YAML.

## jq: query JSON

`jq` takes a JSON document and a filter and prints the result. The cloud CLIs produce JSON, so `gcloud ... --format=json | jq ...` is a daily pattern. Create a small sample shaped like `gcloud compute instances list --format=json` output (reduced for the lesson, with example names):

```bash
cat > instances.json <<'EOF'
[
  {"name": "web-1", "zone": "europe-west1-b", "status": "RUNNING", "labels": {"env": "dev"}},
  {"name": "web-2", "zone": "europe-west1-c", "status": "RUNNING", "labels": {"env": "dev"}},
  {"name": "batch-1", "zone": "europe-west1-b", "status": "TERMINATED", "labels": {"env": "dev"}},
  {"name": "o'neil-test", "zone": "europe-west1-b", "status": "RUNNING", "labels": {}}
]
EOF
```

The building blocks:

| Filter         | Meaning                                                  |
| -------------- | -------------------------------------------------------- |
| `.`            | The whole input, pretty-printed.                         |
| `.a.b`         | Field `b` of field `a`.                                  |
| `.[]`          | Every element of an array (or every value of an object). |
| `select(cond)` | Keep the input only if the condition is true.            |
| `map(f)`       | Apply `f` to every element of an array.                  |
| `group_by(.k)` | Group array elements by key.                             |
| `length`       | Count of elements.                                       |

Useful flags: `-r` prints raw strings without quotes, `-c` prints compact one-line JSON, and `-e` sets the exit status from the last output.

```bash
jq -r '.[] | select(.status=="RUNNING") | .name' instances.json
```

```text
web-1
web-2
o'neil-test
```

Count instances per zone:

```bash
jq -r 'group_by(.zone) | map({zone: .[0].zone, count: length}) | .[] | "\(.zone) \(.count)"' instances.json
```

```text
europe-west1-b 3
europe-west1-c 1
```

### --arg: pass values in, never paste them in

To filter by a value held in a shell variable, hand it to `jq` with `--arg`. It binds the value as a string variable (`$n`), so quotes and special characters in it cannot change the filter. Pasting the value into the filter text by shell concatenation breaks as soon as the value contains a quote, and it is an injection risk when the value comes from outside. `--argjson` passes a value as JSON (a number or boolean) instead of a string.

```bash
N="o'neil-test"
jq --arg n "$N" '.[] | select(.name==$n) | .zone' instances.json
```

```text
"europe-west1-b"
```

### jq -e as a gate

With `-e`, `jq` exits `0` if the last output is neither `false` nor `null`, `1` if it is `false` or `null`, and `4` if there was no output at all. That makes a one-line check you can use in CI:

```bash
jq -e '.[0].labels.owner' instances.json; echo "exit=$?"
jq -e '.[] | select(.name=="missing")' instances.json; echo "exit=$?"
```

```text
null
exit=1
exit=4
```

Either non-zero status fails a pipeline step. Without `-e`, both commands exit `0` and the pipeline carries on happily.

## yq: query and edit YAML

Kubernetes manifests, Helm values and CI files are YAML. Two different programs are named `yq`, and mixing them up wastes time.

- **mikefarah/yq** (v4) is a single Go binary with its own syntax. Examples here use this one. It is what [[learn/lab-setup|Start 01]] installs.
- **kislyuk/yq** (a Python wrapper around `jq`) is what some package managers install under the same name. Its flags differ: for example `-i` only works with `-y`.

Check which one you have with `yq --version`. On the Ubuntu 24.04 lab used to write this lesson, the `yq` found on the path was the Python wrapper (it reported `0.0.0` and refused `-i` without `-y`).

```bash
cat > deploy.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
EOF
yq '.spec.replicas' deploy.yaml
yq -i '.spec.replicas = 3' deploy.yaml
yq '.spec.replicas' deploy.yaml
yq -o=json '.' deploy.yaml | head -4
```

```text
2
3
{
  "apiVersion": "apps/v1",
```

_Illustrative: this is the mikefarah v4 behaviour from its documentation. Not run in this lab, because only the Python wrapper was installed._

> [!warning] Check before relying on this
> Flag syntax differs between `yq` versions and between the two programs: `-o=json` or `-o json`, `-i` for in-place, and `-P` for pretty-print. Run `yq --help` and `yq --version` on your machine. Not verified for your version.

Back up before `-i` edits on real files, the same habit as `sed -i.bak`, or work in a Git repository so `git diff` shows the change.

## A little Python regex

When a shell pipeline becomes hard to read, write the same match in Python. The standard `re` module has the same PCRE-style syntax, and three features make it safer: `re.fullmatch` requires the whole string to match, **named groups** `(?P<name>...)` give captures names, and `re.VERBOSE` lets you spread a pattern over lines with comments.

```python
import re

LINE = re.compile(
    r"""
    (?P<ip>\S+) \s .* \s
    "(?P<method>[A-Z]+) \s (?P<path>\S+) \s [^"]*" \s
    (?P<status>\d{3}) \s (?P<bytes>\d+)
    """,
    re.VERBOSE,
)

m = LINE.fullmatch('203.0.113.10 - - [x] "GET /a HTTP/1.1" 200 5')
print(m.groupdict())
```

```text
{'ip': '203.0.113.10', 'method': 'GET', 'path': '/a', 'status': '200', 'bytes': '5'}
```

Scripting with Python continues in [[learn/python-for-ops|Python 17]].

### Why a regex is not an IP check

The pattern `\d{1,3}(\.\d{1,3}){3}` accepts `256.1.1.1` and `999.999.999.999`, because it counts digits and not values. Writing a regex that checks each octet is at most 255 is possible but ugly and easy to get wrong. Use a library that knows what an address is:

```python
import ipaddress

for s in ["10.0.0.1", "256.1.1.1"]:
    try:
        ipaddress.IPv4Address(s)
        print(s, "valid")
    except ValueError as e:
        print(s, "invalid:", e)
```

```text
10.0.0.1 valid
256.1.1.1 invalid: Octet 256 (> 255) not permitted in '256.1.1.1'
```

Use a regex to find candidates in text and the `ipaddress` module to decide if they are valid.

## Hands-on exercises

Run these in the lab VM in `~/lab03`, with the `access.log` and `instances.json` files created above. Output is illustrative where it depends on your machine.

1. **Count errors with grep.** Run `grep -c ' 500 ' access.log` and `grep -E ' (4|5)[0-9]{2} ' access.log | wc -l`.
   Expected: `2`, then `4`.
   If you see something else: a different number usually means a typo when you created the file. Run `wc -l access.log` (expect `8`) and compare with the heredoc.

2. **Check the exit codes.** Run `grep nomatch access.log; echo $?` and `grep x /nonexistent; echo $?`.
   Expected: `1`, then an error message and `2`.
   If you see something else: if you see `0` for the first command, your pattern matched. `nomatch` is not in the file.

3. **Whole word versus substring.** Run `echo "error warning" | grep -oE 'error|warn'` and again with `-owE`.
   Expected: `error` and `warn`, then only `error`.
   If you see something else: if the second command prints nothing, check the flag order. `-w` and `-o` and `-E` can be combined as `-owE`.

4. **Top failing endpoints with awk.** Run the associative array command from the awk section.
   Expected: `/api/orders    2` then `/api/users     1`.
   If you see something else: if you get no output, the status field is not field 9 in your file. Run `awk '{print $9}' access.log` and compare with the lesson.

5. **Status code counts.** Run `awk '{print $9}' access.log | sort | uniq -c | sort -rn`.
   Expected: the code `200` with count 3 first, then the others with count 1 in any order.
   If you see something else: if counts are all `1`, you forgot the first `sort`. `uniq -c` only counts adjacent duplicates.

6. **Edit with a backup.** Run `cp access.log app.conf && sed -i.bak 's/GET/FETCH/' app.conf && diff app.conf.bak app.conf | head -4`.
   Expected: a `diff` showing changed lines, with `<` for old and `>` for new, and a file `app.conf.bak`.
   If you see something else: if `diff` prints nothing, the pattern did not match. Remember `sed` is case sensitive.

7. **Find with spaces in names.** Run the `find ... -print0 | xargs -0 -r gzip -k` example in `ft/`.
   Expected: `a b.log.gz` and `c.log.gz` next to the originals.
   If you see something else: if `gzip` complains about `a` and `b.log`, you used `xargs` without `-0`. Delete the `.gz` files and repeat with `-print0` and `-0`.

8. **Select with jq.** Run `jq -r '.[] | select(.status=="RUNNING") | .name' instances.json`.
   Expected: `web-1`, `web-2` and `o'neil-test`.
   If you see something else: `parse error` means the JSON file was damaged. Check it with `jq . instances.json`.

9. **Count per zone.** Run the `group_by` command from the jq section.
   Expected: `europe-west1-b 3` and `europe-west1-c 1`.
   If you see something else: if you get `Cannot index array with string`, you dropped the `.[]` before the string interpolation.

10. **Pass a value safely.** Run the `--arg` command with `N="o'neil-test"`.
    Expected: `"europe-west1-b"`.
    If you see something else: `null` or no output means the name does not match exactly. Echo `"$N"` to see the quote.

11. **Use jq as a gate.** Run both `jq -e` commands and print `$?`.
    Expected: `null` with `exit=1`, then no output with `exit=4`.
    If you see something else: if you see `exit=0`, you left out `-e`.

12. **Edit YAML.** Create `deploy.yaml`, then run `yq --version` first. With mikefarah v4, run `yq -i '.spec.replicas = 3' deploy.yaml && yq '.spec.replicas' deploy.yaml`.
    Expected: `3`.
    If you see something else: `yq: -i/--in-place can only be used with -y/-Y` means you have the Python wrapper. Install the mikefarah binary as described in [[learn/lab-setup|Start 01]], or use `yq -y '.spec.replicas = 3' deploy.yaml > new.yaml` with the wrapper.

13. **Validate an IP properly.** Run the `ipaddress` script from this lesson.
    Expected: `10.0.0.1 valid` and `256.1.1.1 invalid: ...`.
    If you see something else: a traceback about `python3` means it is not installed. Run `sudo apt install python3`.

## Common mistakes

- **Using `grep` or `sed` on JSON.** A change in key order or pretty-printing breaks the pattern. Use `jq` or `yq`, which parse the document.
- **`sed -i` without a backup.** A wrong pattern rewrites the file and the original is gone. Use `-i.bak`, check with `diff`, or work in a Git repository.
- **`uniq -c` without `sort`.** It counts only adjacent identical lines, so the counts are wrong without a warning. Sort first.
- **Parsing `ls`, or `find | xargs` without `-print0`.** File names with spaces split into pieces, and the command acts on the wrong files. Use `-print0 | xargs -0`, or `-exec ... {} +`.
- **Building a `jq` filter by pasting a shell variable into it.** A quote in the value breaks the filter, and untrusted values change its meaning. Use `--arg`.
- **Trusting `\d{1,3}` as an IP check.** It accepts `999.999.999.999`. Use the `ipaddress` module.
- **Assuming `yq` is `yq`.** The two programs have different syntax. Check `yq --version` before you run a script.
- **Forgetting the regex dialect.** `grep 'a+'` (BRE) matches a literal `a+`. Use `grep -E 'a+'`.

## Check your understanding

1. Why does `grep -E 'error|warn'` match the line "warning: disk almost full"?
2. Why do you pair `find -print0` with `xargs -0`?
3. What does `jq -e` return when the last output is `null` or `false`, and when there is no output?
4. Why use `jq --arg` instead of building the filter string with shell concatenation?
5. Why is `\d{1,3}(\.\d{1,3}){3}` not an IP address check, and what should you use?
6. A command pipeline starts with `sort | uniq -c`. Why does the order matter?

> [!question]- Answers
>
> 1. A pattern matches anywhere in the line unless anchored, and `warn` is the first four letters of `warning`. Use `-w`, or anchor the pattern, to match whole words.
> 2. File names can hold spaces and newlines but never a NUL byte. `-print0` separates names with NUL and `-0` splits on NUL, so no name is broken into pieces.
> 3. Exit status `1` for `null` or `false`, `0` for any other value, and `4` when there is no output.
> 4. `--arg` passes the value as data, so quotes or special characters in it cannot change the filter. Concatenation breaks on a quote and lets outside input rewrite the filter.
> 5. It counts digits, not values, so `256.1.1.1` matches. Use a library such as Python's `ipaddress` to decide validity, and a regex only to find candidates.
> 6. `uniq` only collapses adjacent duplicate lines. Without `sort` first, equal lines scattered through the input are counted separately.

## Next steps

Next lesson: [[learn/linux-processes-memory-and-disk|Linux 04: Processes, memory and disk]]. Previous lesson: [[learn/linux-users-permissions-sudo-and-ssh|Linux 02: Users, permissions, sudo and SSH access]].

To go deeper:

- [[standards/bash-scripts]] for the conventions that make a script built from these tools safe to run unattended.
- [[learn/python-for-ops|Python 17]] for when the pipeline becomes a program.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- GNU grep manual (https://www.gnu.org/software/grep/manual/), GNU sed manual (https://www.gnu.org/software/sed/manual/), GNU gawk manual (https://www.gnu.org/software/gawk/manual/) and GNU findutils manual (https://www.gnu.org/software/findutils/manual/). The grep, sed, find and awk examples were run on Ubuntu 24.04 LTS with grep 3.11 and sed 4.9; the awk on that machine was mawk 1.3.4, and the examples use only features that gawk shares.
- jq manual (https://jqlang.github.io/jq/manual/). The jq examples were run with jq 1.7 on Ubuntu 24.04 LTS.
- mikefarah/yq documentation (https://mikefarah.gitbook.io/yq). The v4 examples were not run in this lab; the Python wrapper behaviour (`-i` needing `-y`) was observed.
- Python documentation for `re` and `ipaddress` (https://docs.python.org/3/). The Python examples were run on the system `python3` of the lab.
