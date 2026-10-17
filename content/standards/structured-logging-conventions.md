---
title: Structured logging conventions
description: One JSON log schema for services on GKE, with required fields, severity mapping, trace correlation, data that must never be logged, and a CI check.
type: standard
tags:
  - standards
  - observability
  - gcp
  - security
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This standard defines one JSON log line format for services running on GKE and shipping logs to Cloud Logging, so logs can be searched, correlated with traces and turned into metrics the same way for every team. It is written for senior DevOps engineers and the engineers they support. Pipeline design and retention live in [[architecture/observability-pipeline-opentelemetry]]; the data-protection detail is in [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Scope and sources
> Written against Cloud Logging's structured logging behaviour for containers on GKE (stdout JSON parsed into `jsonPayload`) and the OpenTelemetry logs data model, as described in the official documentation on cloud.google.com and opentelemetry.io.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the exact Cloud Logging special JSON field names, the Terraform logging exclusion and metric resource arguments, how OpenTelemetry log fields map to Cloud Logging fields, and whether excluded logs still count in log-based metrics. Check them before relying on them.

## Rules

- Log one JSON object per line to stdout. No multi-line pretty printing, no stack traces split over lines (put the trace in one field).
- Every line carries the required fields below. Missing a required field fails the CI check.
- Use the severity names Cloud Logging understands, in upper case.
- Put the trace and span IDs on every line written inside a request, so logs join to traces.
- Log events, not prose: a stable `message` plus fields, rather than values formatted into the sentence.
- Never log secrets, tokens, full card numbers or personal data you do not need (see Never log).
- Log at the edge of failures once. Do not log and rethrow at every layer.
- Fields have one type forever. A field that is a number in one release and a string in the next breaks indexing and queries.

## Required fields

| Field      | Type   | Example                              | Why                                             |
| ---------- | ------ | ------------------------------------ | ----------------------------------------------- |
| `severity` | string | `ERROR`                              | Filtering, alerting, log-based metrics          |
| `message`  | string | `payment authorisation failed`       | Human-readable, stable text                     |
| `time`     | string | `2026-10-17T09:30:00.123Z`           | RFC 3339 UTC timestamp from the application     |
| `service`  | string | `checkout`                           | Which workload wrote it                         |
| `version`  | string | `1.14.2`                             | Which release; links an error to a deploy       |
| `env`      | string | `production`                         | Separates environments when logs are aggregated |
| trace      | string | `projects/my-project/traces/4bf9...` | Joins the line to a trace (special field below) |
| span       | string | `00f067aa0ba902b7`                   | Joins the line to a span (special field below)  |

Optional but common: `event` (a stable machine name such as `payment.declined`), `request_id`, `duration_ms`, `path` (the request path or route), `http.status`, `error.type`.

```json title="sample-log-line.json"
{
  "severity": "ERROR",
  "message": "payment authorisation failed",
  "time": "2026-10-17T09:30:00.123Z",
  "service": "checkout",
  "version": "1.14.2",
  "env": "production",
  "event": "payment.declined",
  "duration_ms": 412,
  "logging.googleapis.com/trace": "projects/my-project/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "00f067aa0ba902b7"
}
```

## Severity levels

| Level      | Use it for                                                        |
| ---------- | ----------------------------------------------------------------- |
| `DEBUG`    | Developer detail. Off in production by default                    |
| `INFO`     | Normal business events and lifecycle                              |
| `NOTICE`   | Significant normal events (config reloaded, feature flag changed) |
| `WARNING`  | Unexpected but handled; the request succeeded                     |
| `ERROR`    | The request or job failed; someone may need to look               |
| `CRITICAL` | The service cannot continue to function correctly                 |

Map your logging library's levels to these names explicitly (for example Python `WARNING` to `WARNING`, `FATAL` to `CRITICAL`). Reserve `ERROR` for failures that count against an SLO, so error-rate metrics stay meaningful (see [[patterns/slo-burn-rate-alerting]]).

## Trace correlation

Set the trace and span special fields from the active OpenTelemetry span context. Cloud Logging uses them to link a log entry to a trace in the console. The trace value has the form `projects/PROJECT_ID/traces/TRACE_ID`. The Python example below shows the field names; take the IDs from your tracing library's current span.

```python title="app/jsonlog.py"
import contextvars
import json
import logging
import os
import sys
from datetime import datetime, timezone

# Set these per request from the active span (middleware or OpenTelemetry API).
trace_id_var = contextvars.ContextVar("trace_id", default=None)
span_id_var = contextvars.ContextVar("span_id", default=None)

SERVICE = os.environ.get("SERVICE_NAME", "unknown")
VERSION = os.environ.get("SERVICE_VERSION", "unknown")
ENV = os.environ.get("DEPLOY_ENV", "unknown")
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "my-project")  # change: your project ID

SEVERITY = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARNING",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRITICAL",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "severity": SEVERITY.get(record.levelno, "INFO"),  # unknown custom levels map to INFO
            "message": record.getMessage(),
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "service": SERVICE,
            "version": VERSION,
            "env": ENV,
        }
        trace_id = trace_id_var.get()
        span_id = span_id_var.get()
        if trace_id:
            entry["logging.googleapis.com/trace"] = f"projects/{PROJECT_ID}/traces/{trace_id}"
        if span_id:
            entry["logging.googleapis.com/spanId"] = span_id
        # Structured extras: logger.info("...", extra={"fields": {"event": "x"}})
        entry.update(getattr(record, "fields", {}))
        if record.exc_info:
            entry["error.stack"] = self.formatException(record.exc_info)
        return json.dumps(entry, separators=(",", ":"), ensure_ascii=False)


def setup() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
```

## Never log

- Passwords, API keys, bearer tokens, session cookies, private keys and anything from a secret store.
- Full payment card numbers (PANs), card security codes and full track data.
- Personal data that the log's purpose does not need: government IDs, health data, full names with contact details, precise location, and request or response bodies by default.
- Authorization headers and full URLs that carry tokens in the query string.
- Internal-only details that help an attacker when they leak: full SQL with parameters, internal hostnames in error messages returned to clients.

Where an identifier is needed for debugging, log a pseudonymous ID or a truncated or hashed value, and keep the lookup in a system with proper access control. The legal and framework details (PCI DSS, GDPR, retention) are in [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]. A leaked credential in logs is an incident: follow [[runbooks/leaked-credential-rotation]].

## Log-based metrics and exclusions

Log-based metrics turn log lines into time series without code changes. Exclusions drop noisy lines before they are stored, which is the most direct cost control. Both are shown in Terraform.

```hcl title="logging.tf"
resource "google_logging_metric" "app_errors" {
  name        = "app_error_count"
  description = "Count of ERROR and above log lines per service"
  filter      = "resource.type=\"k8s_container\" AND severity>=ERROR"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"

    labels {
      key         = "service"
      value_type  = "STRING"
      description = "Service name from the log line"
    }
  }

  label_extractors = {
    service = "EXTRACT(jsonPayload.service)"
  }
}

# Drop health-check noise before storage. Excluded entries cannot be recovered.
resource "google_logging_project_exclusion" "health_checks" {
  name        = "exclude-health-checks"
  description = "Drop INFO-level health check request logs"
  filter      = "resource.type=\"k8s_container\" AND jsonPayload.path=\"/healthz\" AND severity<=INFO"
}
```

Exclude by narrow filter and review what each exclusion removes. Never exclude `WARNING` and above, or security and audit logs, to save money. Keep metric label values bounded: a label taken from a free-text field creates unbounded series.

## Checking it in CI

Run the service's tests or a short smoke run with logging on, capture stdout to a file, and validate every line. This catches a missing field before it reaches production.

```bash
set -euo pipefail

LOG_FILE="sample.log"  # change: file with captured JSON log lines from a test run

# An empty capture would pass the jq check below, so fail it first.
[ -s "$LOG_FILE" ] || { echo "no log lines captured" >&2; exit 1; }

REQUIRED='["severity","message","time","service","version","env"]'
LEVELS='["DEBUG","INFO","NOTICE","WARNING","ERROR","CRITICAL","ALERT","EMERGENCY"]'

# -s reads all lines into one array; fails if any line is not JSON, misses a
# required key, or uses an unknown severity.
jq -s -e --argjson req "$REQUIRED" --argjson levels "$LEVELS" '
  all(.[];
    (($req - keys) | length == 0)
    and (.severity as $s | $levels | index($s) != null)
  )
' "$LOG_FILE" > /dev/null

echo "log schema check passed"
```

In GitLab CI, run this as a job after the test job, using the test log artifact. Add a grep for known secret patterns on the same file, and see [[standards/code-review]] for reviewing log statements in code review.

## Checklist

- [ ] Logs are one JSON object per line on stdout.
- [ ] `severity`, `message`, `time`, `service`, `version` and `env` are on every line.
- [ ] Trace and span IDs are set inside requests.
- [ ] Severity names match the table; `ERROR` means an SLO-relevant failure.
- [ ] No secrets, PANs, tokens or unneeded personal data are logged.
- [ ] Field types are stable across releases.
- [ ] Log-based metrics use bounded labels.
- [ ] Exclusions are narrow, reviewed and recorded.
- [ ] The CI schema check runs on a captured sample.
- [ ] On-call can find a request's logs from its trace ID (see [[management/on-call-health]]).

## Related

- [[architecture/observability-pipeline-opentelemetry]]: how logs, metrics and traces flow and how long they are kept.
- [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]: what the frameworks mean for log content and retention.
- [[patterns/slo-burn-rate-alerting]]: alerting on metrics derived from logs.
- [[management/on-call-health]]: why findable, low-noise logs matter for the people on call.
- [[standards/code-review]]: reviewing log statements like any other code.
