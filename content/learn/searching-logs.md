---
title: "Observability 02: Searching logs under pressure: kubectl, jq, Loki and Cloud Logging"
description: A method for finding the cause in a mass of logs, with kubectl logs, jq on JSON lines, LogQL for Loki, the Cloud Logging query language, and the pitfalls that mislead.
type: guide
tags:
  - learning
  - observability
  - kubernetes
  - gcp
  - on-call
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 4 h | You need: [[learn/observability-signals-and-dashboards|Observability 01: Metrics, logs and traces, and reading a Grafana dashboard]], [[learn/text-and-data-tools|Linux 03: Text and data tools]] and [[learn/kubernetes-probes-resources-and-debugging|Kubernetes 05: Probes, resources and a pod debugging playbook]] | Lab: Lab B (the local kind cluster) for exercise 1, Lab A (a Linux shell with `python3` and `jq`) for exercises 2 and 5, from [[learn/lab-setup|Start 01: Set up your lab]]

At two in the morning you will not have time to read logs. You will have a symptom, a time and thousands or millions of lines. The skill is not knowing a clever command, it is having a method that shrinks the haystack in a few steps, and knowing the traps that make you look at the wrong lines. This lesson gives you that method, then the tools for four places logs live: your terminal (`kubectl logs`), a JSON file (`jq`), Loki (LogQL) and Google Cloud Logging.

> [!note] What was run
> On Ubuntu 24.04 with Python 3.13 and `jq` 1.7: the log generator `gen-logs.py` and every `jq`, `grep`, `sort` and `uniq` command in exercises 2 and 5 and in the `jq` section were run, and the output shown is what they printed. **Not run, so not verified:** every `kubectl` command (there was no cluster), every LogQL query (no Loki), and every Cloud Logging query and `gcloud` command (no GCP project). Their output is illustrative. Check the LogQL parser syntax against the Loki version you use, and the Cloud Logging field names against your own log entries.

## What you will learn

- A five-step method: scope, filter, shape, count, find the first error.
- How to use `kubectl logs` well: selectors, time windows, previous containers and multi-container Pods.
- How to filter and summarise JSON log lines with `jq`, including files with some non-JSON lines.
- The basics of LogQL (Loki) and of the Cloud Logging query language, including log-based metrics.
- Why `grep error` misleads, why a restart hides the crash, and what to do when the result is huge.

## The method

When there are too many lines, do not scroll. Shrink the problem in a fixed order:

1. **Scope.** Which service, which environment, which time window? Write the window down, in UTC, with a start and an end ("10:00 to 10:15 UTC"). Without a window you search everything and find the wrong event.
2. **Filter.** Keep only lines that can matter: this service, the error levels, the status codes. Use fields (`level="ERROR"`), not words, where you can.
3. **Shape.** Look at the form of what is left. Show a few lines, pick the fields you need (time, path, request ID, message), and drop the rest.
4. **Count.** Group and count: by message, by path, by minute, by Pod. Counts turn a wall of text into a short table and show _when_ it started and _what_ dominates.
5. **Find the first error.** The first failure usually points at the cause, and later errors are often consequences. Sort by time, find the earliest one in the window, and read the lines around it.

Then follow the request: take a request ID or trace ID from that first error and read every line for it (Observability 01 explains why you want the ID in the log).

## `kubectl logs`

`kubectl logs` shows what a container wrote to standard output and standard error. These are the options you will use every day:

```bash
kubectl logs POD                                 # one Pod, current container
kubectl logs POD -c CONTAINER                    # a Pod with several containers
kubectl logs deploy/checkout                     # one Pod of the Deployment (see below)
kubectl logs -l app=checkout --all-containers    # every Pod with the label
kubectl logs POD --since=15m                     # only the last 15 minutes
kubectl logs POD --since-time=2026-10-17T10:00:00Z   # from an exact time (RFC 3339)
kubectl logs POD --tail=100                      # only the last 100 lines
kubectl logs POD --timestamps                    # prefix every line with its time
kubectl logs POD --previous                      # the container that crashed, not the new one
kubectl logs -f POD                              # follow (stream) new lines
```

Some details that matter:

- **`-l` (a label selector) reads all matching Pods**, but by default it limits how many lines per Pod it shows, and how many Pods it reads at once. When you use a selector, add `--tail=-1` for all lines and check `kubectl logs --help` for the current defaults and the `--max-log-requests` limit (verify for your version).
- **`deploy/NAME` shows only one Pod** of the Deployment, not all. If the error happens on the other replica, you will not see it. Use the label selector for the whole set.
- **`--previous` is how you read a crash.** When a container crashes and Kubernetes restarts it, `kubectl logs` shows the _new_ container. The reason the old one died is in the previous one. You will see this in exercise 1.
- **`--prefix`** (with `-l`) adds the Pod and container name in front of each line, so you can tell which replica wrote it.
- **Logs on the node are limited and temporary.** `kubectl logs` reads from the node's rotating log files. If the Pod was deleted or the node replaced, or the log rotated, they are gone. That is why a central log system (Loki, Cloud Logging) exists.

Combine with `grep` and `jq` for a quick look:

```bash
kubectl logs -l app=checkout --since=15m --timestamps --prefix | grep -i timeout | head
```

## `jq` on JSON lines

When logs are JSON, one object per line, `jq` is the quickest way to filter and count them, on a file or on `kubectl logs` output. In the exercises you will use a generated file. Each line looks like this (generated by the script in exercise 2):

```json
{
  "time": "2026-10-17T10:06:00.000Z",
  "level": "ERROR",
  "msg": "payment backend timeout",
  "path": "/checkout",
  "status": 500,
  "duration_ms": 2480,
  "retry_on_error": false,
  "request_id": "req-00600"
}
```

The pieces to know:

```bash
jq -r '.level' app.log                                    # one field from every line (-r: raw, no quotes)
jq -c 'select(.level == "ERROR")' app.log                 # keep lines where a condition holds (-c: one line each)
jq -r 'select(.status >= 500) | [.time, .path, .request_id, .duration_ms] | @tsv' app.log   # pick columns as tab-separated text
jq -r '.time[0:16]' app.log                               # slice a string: "2026-10-17T10:06" (minute resolution)
jq -s 'map(select(.status == 500)) | length' app.log      # -s (slurp): read all lines as one array, then count
```

`jq` sees input as JSON. A real log often contains a few lines that are **not** JSON (a startup banner, a stack trace). Plain `jq` stops with a parse error on the first one. Read the input as raw text and parse each line yourself, skipping the failures with `fromjson?`:

```bash
printf 'plain startup line\n{"level":"ERROR","msg":"x","status":500}\n' | jq -R -c 'fromjson? | select(.level == "ERROR")'
```

```text
{"level":"ERROR","msg":"x","status":500}
```

Without `-R` and `fromjson?`, the same input fails. On `jq` 1.7 the message was `jq: parse error: Invalid numeric literal at line 1, column 6` and the exit status was 5 (other versions may differ). The `?` after `fromjson` means "if this fails, produce nothing".

To **count** with `jq`, print one value per line, then let the shell do the counting:

```bash
jq -r 'select(.level == "ERROR") | .time[0:16]' app.log | sort | uniq -c
```

`sort` is needed because `uniq -c` only counts neighbouring identical lines.

## LogQL (Loki)

**Loki** stores logs indexed by a small set of **labels** (like Prometheus: namespace, app, pod) and searches the text of the lines at query time. **LogQL** is its query language. It has two parts: a **stream selector** that picks which streams of logs to read, and a **pipeline** of filters and parsers.

```text
{namespace="shop", app="checkout"}                         # stream selector: which logs
{namespace="shop", app="checkout"} |= "timeout"            # line contains "timeout"
{namespace="shop", app="checkout"} != "healthcheck"        # line does not contain it
{namespace="shop", app="checkout"} |~ "timeout|refused"    # line matches a regular expression
```

Always start with a narrow stream selector (labels). It is what makes the query fast; the filters after it run on the text of the matched streams.

To filter on fields, add a **parser**. `| json` turns the keys of a JSON line into labels for the rest of the query; `| logfmt` does the same for `key=value` lines. After a parser you can use **label filters**, including numeric comparison:

```text
{namespace="shop", app="checkout"} | json | status >= 500
{namespace="shop", app="checkout"} | json | level="ERROR" | path="/checkout"
```

`line_format` changes how each line is shown, so you see only what you need:

```text
{namespace="shop", app="checkout"} | json | status >= 500
  | line_format "{{.path}} {{.duration_ms}}ms {{.request_id}}"
```

And metric queries turn logs into numbers, which you can graph:

```text
sum by (path) (count_over_time({namespace="shop", app="checkout"} | json | status >= 500 [5m]))
```

This reads "for each path, how many 5xx lines in each 5-minute window". It is the log-world equivalent of `rate` from Observability 01.

> [!warning] Check before relying on this
> LogQL syntax, the parser stages and the label-filter rules (for example how numeric comparison on parsed fields works, and a different `unwrap` syntax for numeric values) can differ between Loki versions. Check the LogQL documentation for the Loki version you run.

## The Cloud Logging query language

On Google Cloud, GKE sends container logs to **Cloud Logging**. You query them in the Logs Explorer in the console, or with `gcloud logging read`. The query language is a set of conditions, one per line, with an implied `AND` between lines.

```text
resource.type="k8s_container"
resource.labels.cluster_name="lab-cluster"
resource.labels.namespace_name="shop"
resource.labels.container_name="checkout"
severity>=ERROR
timestamp>="2026-10-17T10:00:00Z"
timestamp<"2026-10-17T10:15:00Z"
jsonPayload.status>=500
```

What each line does:

- `resource.type="k8s_container"` and the `resource.labels.*` lines select the cluster, namespace and container. Use the narrowest labels you can.
- `severity>=ERROR` compares severity levels in order (`DEFAULT`, `DEBUG`, `INFO`, `NOTICE`, `WARNING`, `ERROR`, `CRITICAL`, `ALERT`, `EMERGENCY`), so it catches everything from `ERROR` up.
- `timestamp>=` and `timestamp<` bound the window, in RFC 3339 form. Always set both.
- `jsonPayload.status>=500` filters on a field of a structured (JSON) log line. A line that is not JSON ends up in `textPayload`, and you search it with the text (`textPayload:"timeout"`, where `:` means "contains").

From a terminal, the same filter works with `gcloud`:

```bash
gcloud logging read '
  resource.type="k8s_container"
  resource.labels.namespace_name="shop"
  severity>=ERROR
  timestamp>="2026-10-17T10:00:00Z"' \
  --project "$PROJECT_ID" --limit 20 --format json
```

> [!warning] Check before relying on this
> For container logs on GKE, the **`severity`** key of a JSON line is what Cloud Logging maps to the entry's severity. A line that uses a different key, such as the `level` field in this lesson's generated file, may arrive with severity `DEFAULT` or `INFO`, and `severity>=ERROR` would miss it. Check how your logs arrive on a real entry, and the team convention in [[standards/structured-logging-conventions]]. Field names such as `jsonPayload.status` come from your own JSON keys. Not verified here.

### Saved queries and log-based metrics

Save the queries you reuse (Logs Explorer has a save option; names and menus change, so check yours) and share them in the runbook for the service. A **log-based metric** counts log entries that match a filter and exposes the count as a metric in Cloud Monitoring, which you can graph and alert on. This is the bridge between logs and alerts: "page me when `severity>=ERROR` lines for the checkout container exceed N per 5 minutes". The `gcloud logging metrics create` command and the console both create one. Compare the monitoring options in [[tools/prometheus-vs-cloud-monitoring]].

## Time discipline

Wrong time is a classic way to waste an hour.

- **State the window** every time: "10:00 to 10:15 UTC on 17 October". Put it in the incident channel.
- **Use UTC** in queries and notes. The console may show your local time zone; `kubectl logs --timestamps` shows UTC. Convert once, and write the zone.
- **Allow for the delay.** Logs from a Pod can arrive in a central system a few seconds late. Look a bit past the end of the window.
- **Look before the first symptom.** The cause often comes minutes before the alert. Start the window earlier than you think.
- **Compare with something known.** Line up the first error with a deploy time, a restart or a change event.

## Pitfalls that mislead

- **`grep error` finds the wrong lines.** It matches any line containing the word: a field named `retry_on_error`, a message such as `no error found`, a URL. In the generated file of this lesson it matches **every** line (1000 of 1000) because each line has a `retry_on_error` field, while only 25 are real errors. It also misses `ERROR` in capitals unless you use `-i`, and errors that use other words (`failed`, `refused`, `panic`). Filter on a field (`level`, `status`) where there is one.
- **Millions of lines.** If the result is huge, you filtered too little. Narrow the window and the scope first, then count and group before you read lines.
- **Regex over free text.** Slow, brittle, and it breaks when someone rewords a message. Prefer structured fields.
- **Sampling.** Some systems keep only a fraction of lines. Absence of a line proves nothing if logs are sampled or rate-limited.
- **Misleading levels.** An application may log a real failure as `INFO` or a harmless retry as `ERROR`. Check the message, not only the level.
- **A restart hides the crash.** The new container's log starts fresh. Use `kubectl logs --previous`, and `kubectl describe pod` for the exit code and reason.
- **Clocks and ordering.** Lines from different Pods are merged by timestamp. Small clock differences can reorder events within a second.
- **Reading one Pod.** `kubectl logs deploy/NAME` shows one replica. Use the selector.
- **Secrets in logs.** If you find a token or personal data in a log, do not paste it into chat or a ticket. Tell the owner and treat it as a leak ([[learn/security-basics-for-devops]]).

## Hands-on exercises

### Exercise 1: A crashing Pod, and `--previous`

You need a kind cluster ([[learn/lab-setup|Start 01]], Lab B).

1. Start a Pod whose container prints a line and then fails. It is restarted again and again:

   ```bash
   kubectl run crasher --image=busybox:1.36 --restart=Always -- sh -c 'echo "starting"; echo boom; exit 1'
   ```

   (`busybox:1.36` is an example tag. Change it to a tag you have checked on the registry.)

2. Wait about 30 seconds, then look at the Pod:

   ```bash
   kubectl get pod crasher
   ```

   Expected (illustrative):

   ```text
   NAME      READY   STATUS             RESTARTS      AGE
   crasher   0/1     CrashLoopBackOff   3 (20s ago)   60s
   ```

3. Read the logs of the crashed container, and why it ended:

   ```bash
   kubectl logs crasher --previous
   kubectl describe pod crasher | grep -A6 'Last State'
   ```

   Expected (illustrative):

   ```text
   starting
   boom
   ```

   ```text
       Last State:     Terminated
         Reason:       Error
         Exit Code:    1
   ```

4. Compare with `kubectl logs crasher` (without `--previous`). Expected: depending on the moment, you see the new container's output (the same two lines, from a later attempt) or an error saying the container is waiting to start. Either way you cannot tell from this alone that it has crashed several times, which is the point.

5. Clean up: `kubectl delete pod crasher`.

If you see something else: `Error from server (BadRequest): previous terminated container "crasher" ... not found` means it has not crashed yet; wait and retry. If the Pod is `Completed`, the command exited with status 0. If the image cannot be pulled (`ErrImagePull`), the tag does not exist or the cluster has no network.

### Exercise 2: Errors per minute with `jq | sort | uniq -c`

1. Create the generator. It is deterministic (no random numbers), so your output matches the output below:

   ```python title="gen-logs.py"
   #!/usr/bin/env python3
   """Write N JSON log lines (default 1000) to app.log. Deterministic: no random numbers.

   Usage: python3 gen-logs.py [N]
   """
   import json
   import sys
   from datetime import datetime, timedelta, timezone

   N = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
   START = datetime(2026, 10, 17, 10, 0, 0, tzinfo=timezone.utc)  # Change: any start time you like.
   PATHS = ["/checkout", "/cart", "/search", "/health"]
   BURST_FROM, BURST_TO = N * 6 // 10, N * 7 // 10  # a burst of failures on /checkout

   with open("app.log", "w", encoding="utf-8") as out:
       for i in range(N):
           ts = START + timedelta(milliseconds=i * 600)
           path = PATHS[i % 4]
           status, level, msg = 200, "INFO", "request handled"
           if i % 50 == 0:
               status, level, msg = 404, "WARN", "route not found"
           if BURST_FROM <= i < BURST_TO and path == "/checkout":
               status, level, msg = 500, "ERROR", "payment backend timeout"
           line = {
               "time": ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z",
               "level": level,
               "msg": msg,
               "path": path,
               "status": status,
               "duration_ms": 20 + (i * 7) % 90 + (2400 if status == 500 else 0),
               "retry_on_error": False,
               "request_id": f"req-{i:05d}",
           }
           out.write(json.dumps(line) + "\n")
   ```

2. Generate the file and check it:

   ```bash
   python3 gen-logs.py
   wc -l app.log
   ```

   Expected: `1000 app.log`.

3. Count the lines by level, then the errors per minute:

   ```bash
   jq -r '.level' app.log | sort | uniq -c
   jq -r 'select(.level == "ERROR") | .time[0:16]' app.log | sort | uniq -c
   ```

   Expected:

   ```text
        25 ERROR
       956 INFO
        19 WARN
        25 2026-10-17T10:06
   ```

   All 25 errors are in one minute, 10:06 UTC. The 1000 lines cover 10 minutes, so that minute is where to look.

4. See what `grep` would have told you:

   ```bash
   grep -ci error app.log
   ```

   Expected: `1000`. Every line contains `retry_on_error`. This is the "grep error misleads" trap.

5. Pick columns of the first three failures:

   ```bash
   jq -r 'select(.status >= 500) | [.time, .path, .request_id, .duration_ms] | @tsv' app.log | head -3
   ```

   Expected:

   ```text
   2026-10-17T10:06:00.000Z	/checkout	req-00600	2480
   2026-10-17T10:06:02.400Z	/checkout	req-00604	2508
   2026-10-17T10:06:04.800Z	/checkout	req-00608	2446
   ```

If you see something else: `jq: command not found` means install `jq`. If the counts differ, the generator was edited (the numbers `i % 50`, the burst range and the `% 4` path cycle decide them). If the minute is different, the start time was changed.

### Exercise 3: A LogQL query for 5xx, with path and duration

You need Loki with the log file or a service's logs loaded (optional; if you do not have one, read the query and do the `jq` comparison in step 3).

1. In Grafana's Explore with a Loki data source, run (change the labels to match your streams):

   ```text
   {namespace="shop", app="checkout"} | json | status >= 500
     | line_format "{{.path}} {{.duration_ms}}ms {{.request_id}}"
   ```

   Expected (illustrative): lines such as `/checkout 2480ms req-00600`, newest first.

2. Count 5xx by path over 5-minute windows:

   ```text
   sum by (path) (count_over_time({namespace="shop", app="checkout"} | json | status >= 500 [5m]))
   ```

   Expected (illustrative): a single series, `{path="/checkout"}`, which rises in the burst window and is empty or zero otherwise.

3. The same question on the generated file with `jq` (this was run):

   ```bash
   jq -r 'select(.status >= 500) | "\(.path) \(.duration_ms)ms \(.request_id)"' app.log | head -2
   ```

   Expected:

   ```text
   /checkout 2480ms req-00600
   /checkout 2508ms req-00604
   ```

If you see something else: `parse error` in Loki points at a syntax problem; check the quotes and the `[5m]`. If the result is empty, the labels do not match your streams, or the lines are not JSON (try `| logfmt`, or `|= "status"` to see raw lines first).

### Exercise 4: The same question in Cloud Logging

1. Write the Cloud Logging filter that is equivalent to exercise 3, for your own cluster and namespace, on the window 10:00 to 10:15 UTC. Use the lines from the section above and replace `jsonPayload.status>=500` so that it also shows only the `/checkout` path (`jsonPayload.path="/checkout"`).
2. Run it in the Logs Explorer, or:

   ```bash
   gcloud logging read '
     resource.type="k8s_container"
     resource.labels.namespace_name="shop"
     resource.labels.container_name="checkout"
     jsonPayload.status>=500
     jsonPayload.path="/checkout"
     timestamp>="2026-10-17T10:00:00Z"
     timestamp<"2026-10-17T10:15:00Z"' \
     --project "$PROJECT_ID" --limit 5 --format 'value(timestamp, jsonPayload.request_id)'
   ```

   Expected (illustrative): up to five rows of a timestamp and a request ID.

3. Note down whether the `severity` of those entries is `ERROR`. If it is `DEFAULT` or `INFO`, the JSON key that carries the level is not `severity`; see the warning above.

If you see something else: no results usually means the window, the namespace or the field names are wrong; remove conditions one at a time (the broadest condition first) until entries appear, then add them back. A permission error means your identity lacks the Logs Viewer role on the project.

### Exercise 5: Narrow 40,000 lines to one answer in three steps

1. Generate a bigger file, and look at how big the problem is:

   ```bash
   python3 gen-logs.py 40000
   wc -l app.log
   ```

   Expected: `40000 app.log`.

2. **Step 1, filter by level and count by field.**

   ```bash
   jq -r '.level' app.log | sort | uniq -c
   jq -r 'select(.level == "ERROR") | .path' app.log | sort | uniq -c
   ```

   Expected:

   ```text
      1000 ERROR
     38240 INFO
       760 WARN
      1000 /checkout
   ```

   40,000 lines became 1,000 errors, and they are all on one path.

3. **Step 2, find when.**

   ```bash
   jq -r 'select(.level == "ERROR") | .time' app.log | sed -n '1p;$p'
   ```

   Expected:

   ```text
   2026-10-17T14:00:00.000Z
   2026-10-17T14:39:57.600Z
   ```

   The errors start at 14:00:00 and end at 14:39:57 UTC.

4. **Step 3, read the first error and its neighbours.**

   ```bash
   jq -c 'select(.level == "ERROR")' app.log | head -1
   ```

   Expected: the first error line, a `payment backend timeout` on `/checkout` with `status` 500 and a `duration_ms` of about 2,400 or more. That message is the first lead for the next question: what changed in the payment backend at 14:00?

5. Reset the file for later use: `python3 gen-logs.py`.

If you see something else: if the counts differ, the generator argument was not `40000`. If the first command is slow, your machine is; `jq` reads the file once per command.

## Common mistakes

- **Searching without a time window.** Why it bites: you find an old, unrelated error and chase it. Fix: write the window (in UTC) before you query.
- **Filtering by the word `error`.** Why it bites: it matches field names, URLs and messages, and misses failures that use other words. Fix: filter on structured fields (`level`, `status`), then confirm by reading.
- **Reading `kubectl logs deploy/NAME` and concluding "no errors".** Why it bites: it shows one Pod. Fix: use `-l` with the label, or the central log system.
- **Forgetting `--previous`.** Why it bites: the new container's log looks healthy, and the crash reason is in the old one. Fix: use `--previous` and `kubectl describe pod`.
- **Printing a huge result to the terminal.** Why it bites: you cannot read it, and the useful part scrolls away. Fix: count and group first, then show a few lines.
- **Using `jq` on mixed input without `-R`.** Why it bites: the first non-JSON line stops the command. Fix: `jq -R 'fromjson? | ...'`.
- **Using `uniq -c` without `sort`.** Why it bites: it counts only neighbouring identical lines, so the numbers are wrong. Fix: `sort | uniq -c`.
- **Trusting the log level.** Why it bites: severities are set by developers and can be wrong. Fix: look at the message and at status codes and metrics.
- **Trusting a log that may be sampled or cut.** Why it bites: absence of a line is not evidence. Fix: check the sampling and the retention of the system.
- **Pasting a log with secrets or personal data into a chat or a ticket.** Why it bites: it spreads the leak. Fix: redact first and report the leak.

## Check your understanding

1. Why does `grep error` mislead, and what is better?
2. A container keeps restarting. Which command shows why the last attempt died, and what else do you read?
3. A query returns 40,000 lines. What do you do next, before reading any of them?
4. Why `sort` before `uniq -c`?
5. What is the difference between the stream selector and the filters in a LogQL query, and why does it matter for speed?
6. Why is the first error in the window more useful than the last?

> [!question]- Answers
>
> 1. It matches the word anywhere: field names such as `retry_on_error`, URLs, messages like "no error", and it misses failures that use other words or other capitalisation. Filter on a structured field (`level="ERROR"` or `status >= 500`), and confirm by reading some lines.
> 2. `kubectl logs POD --previous` shows the output of the container that crashed. `kubectl describe pod POD` shows the last state, the reason and the exit code. For a container with an out-of-memory kill, the exit code and reason point to memory rather than to a log line.
> 3. Narrow the scope and the window, then count and group (by level, path, message, minute) to see what dominates and when it started. Read lines only once you have a small set, starting with the earliest error.
> 4. `uniq -c` counts only adjacent identical lines. Without sorting, the same value spread through the file is counted in many small pieces. `sort` puts identical values together first.
> 5. The stream selector (the labels in braces) chooses which log streams to read, using an index. The filters and parsers run on the text of those streams. A narrow selector reads much less data, so the query is fast; a broad one reads a lot and is slow and costly.
> 6. Later errors are often consequences of the first (a retry storm, a full queue). The earliest failure in the window, compared with deploy and change times, points closest to the cause.

## Next steps

Next lesson: [[learn/first-prometheus-alert|Observability 03: Your first Prometheus alert]]. Previous lesson: [[learn/observability-signals-and-dashboards|Observability 01: Metrics, logs and traces, and reading a Grafana dashboard]].

To go deeper:

- [[tools/prometheus-vs-cloud-monitoring]] compares the two metrics and alerting stacks, including log-based metrics.
- [[runbooks/kubernetes-pod-troubleshooting]] is the full playbook when a Pod will not start or keeps restarting.
- [[standards/structured-logging-conventions]] defines the JSON fields that make this lesson's queries work in every service.
- [[patterns/gcp-audit-logs-siem]] covers audit logs for security questions.
- For using an AI assistant to explain an unfamiliar error: the owner's AI skills catalogue is at <https://ai.szolotov.com>. Redact secrets and customer data before you paste any log.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

The `jq`, `grep`, `sort` and `uniq` commands and the generator were run (see the note near the top). The `kubectl`, LogQL and Cloud Logging parts follow the sources below and were **not** run; pages change, so check them for the versions you use.

- Kubernetes documentation, `kubectl logs` reference (https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) and "Debug Running Pods" (https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/). Not verified: the default `--tail` and `--max-log-requests` behaviour for your `kubectl` version.
- The `jq` manual (https://jqlang.github.io/jq/manual/), checked against `jq` 1.7 for the commands in this lesson.
- Grafana Loki documentation, "LogQL" (https://grafana.com/docs/loki/latest/query/). Not verified: parser syntax for your deployed Loki.
- Google Cloud, "Logging query language" and "Log-based metrics" (https://cloud.google.com/logging/docs/view/logging-query-language, https://cloud.google.com/logging/docs/logs-based-metrics). Not verified: the field names of your own log entries, and how the `severity` key is mapped.
