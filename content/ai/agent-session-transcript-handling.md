---
title: Agent session transcript handling
description: Treat coding-agent transcripts as sensitive data, with rules for secrets in tool output, retention, redaction before sharing and a separate audit record.
type: pattern
tags:
  - ai
  - security
  - audit
  - team-process
created: 2026-10-27
modified: 2026-10-27
draft: false
---

A coding-agent session leaves a transcript: prompts, file contents, shell output, tool results and often environment details. This note is for engineers and platform teams who run agents on workstations and runners and need to decide where those transcripts live, how long they stay, who may read them and how to share one safely. It does not cover redaction of prompts sent to a model API ([[redacting-sensitive-data-before-llm-calls]]), tracing of production LLM calls ([[llm-tracing-with-sensitive-data-controls]]) or what an agent remembers across sessions ([[agent-memory-retention-and-deletion]]).

> [!note] Not verified
> The sources were found through search on 2026-10-27, but the pages could not be fetched, so no quoted wording was checked against the primary document. Check before relying on this note: the current OWASP Logging Cheat Sheet and the current revision of NIST SP 800-92, where each tool stores its transcripts and for how long, whether a bug-report flow uploads a transcript, and the flags of your secret scanner. Retention periods are left to the compliance owner.

## Classify the transcript by what it touched

A transcript is a copy of everything the agent saw. If the agent read `.env`, ran `env`, printed a kubeconfig or hit an error that echoed a token, the transcript holds that value. Classify it at the level of the most sensitive file or command output the session touched, using the existing [[data-classification-and-handling-standard]]. In practice that means "restricted by default", because you cannot know in advance what a session will print.

Secrets reach transcripts through tool output far more often than through the prompt. Controls that only filter what the user types miss the main path. Prevent the exposure at the source where you can: run the agent with a short-lived, least-privilege credential ([[just-in-time-agent-credentials]]), keep real secrets out of the working directory, and block commands that dump the environment ([[deterministic-hooks-for-coding-agents]]).

## Decide the lifecycle in policy, not in tool defaults

Where a tool writes transcripts, in what format and for how long are vendor-specific and change between versions. Check the current docs for each tool you allow, then write the answer into your own standard so the rule does not depend on a default.

A workable split:

| Class                 | Content                                         | Location             | Retention                          |
| --------------------- | ----------------------------------------------- | -------------------- | ---------------------------------- |
| Full local transcript | Everything the agent saw                        | Owner-only directory | Short window, set by policy        |
| CI job transcript     | Job log plus agent output                       | CI artifact store    | Same as job logs, expiring         |
| Audit record          | One structured line per tool call               | Central log store    | Period set by the compliance owner |
| Shared excerpt        | Redacted extract attached to a ticket or report | Ticket system        | Life of the ticket                 |

Put the numbers in the standard and review them with [[data-retention-and-deletion-in-llm-systems]]. Do not hard-code a retention number in a note like this one; it depends on jurisdiction and sector.

## Keep transcripts out of the places data leaks from

Three leak paths come up repeatedly:

- Git. A transcript directory inside a repository, or an export dropped into the working tree, gets committed. Add the directories to `.gitignore` and to a global ignore file.
- Home-directory sync. Cloud sync or backup of a home directory copies the agent's log directory to a place with different access rules. Exclude it.
- Shared runners. A job that uploads its whole workspace as an artifact publishes whatever the agent wrote there. Set `artifacts:expire_in` and list paths explicitly.

```yaml title=".gitlab-ci.yml"
agent-task:
  stage: test
  script:
    - ./scripts/run-agent-task.sh
  artifacts:
    when: always
    expire_in: 3 days
    paths:
      - reports/agent-audit.jsonl
    # Do not add the agent log directory here.
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

The audit file is a structured summary. Do not treat the job log as a safe home for the full transcript either: job logs are readable by everyone who can see the pipeline and often outlive artifacts unless an expiry is configured. Keep verbose agent output out of the log where the tool allows it, and mask CI variables.

## Keep an audit record apart from the transcript

The full transcript is the best evidence of what an agent did, but you want to delete it early because it is sensitive. Resolve the conflict with a second, minimal record that survives the transcript. One line per tool call is enough: timestamp, session id, user, tool, command or target, decision (allowed, denied, approved by a human), exit code. Follow [[structured-logging-conventions]] for the field names.

A hook that runs after each tool call can write this line. The hook must record a redacted or hashed form of the command, never the raw tool input, otherwise it re-creates the problem in a second file. See [[deterministic-hooks-for-coding-agents]] for how to attach it, and [[ai-agent-security-incident-evidence]] for what responders need afterwards.

```bash title="scripts/audit-line.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

# Reads one JSON event on stdin and appends a minimal audit line.
# Stores a hash of the command, not the command text.
event="$(cat)"
tool="$(jq -r '.tool_name // "unknown"' <<<"$event")"
cmd_hash="$(jq -r '.tool_input.command // ""' <<<"$event" | sha256sum | cut -d' ' -f1)"

jq -nc \
  --arg ts "$(date -u +%FT%TZ)" \
  --arg user "${USER:-unknown}" \
  --arg session "${AGENT_SESSION_ID:-unknown}" \
  --arg tool "$tool" \
  --arg cmd_sha256 "$cmd_hash" \
  '{ts:$ts,user:$user,session:$session,tool:$tool,cmd_sha256:$cmd_sha256}' \
  >>"${AUDIT_FILE:-reports/agent-audit.jsonl}"
```

The event field names above are an assumption for illustration. Check the payload your tool actually sends. A hash lets you prove that a known command ran without storing it; keep the plain command only where policy allows. A plain SHA-256 of a short or predictable command can be reversed by guessing, so if commands may embed secrets, use a keyed hash (HMAC) with a key held outside the log store.

## Sharing a transcript is an external disclosure

Attaching a transcript to a vendor support request, a public issue or a chat thread sends your data to someone else. Treat it as a data transfer:

1. Ask whether an excerpt will do. Most bug reports need ten lines, not a session.
2. Run a secret scanner over the file before sharing, for example gitleaks against the file path. Quote flags only from the current `--help` output, because they change between major versions ([[secret-scanning-pre-commit-and-ci]]).
3. Remove customer data, internal hostnames and file contents you do not need to show. Do not ask a model to do the redaction.
4. Check the recipient's data-use and retention terms ([[model-data-use-contract-review]]).
5. Record what was shared, with whom and when.

Scanners miss custom internal token formats, base64-wrapped values and personal data. Keep allowlists small and write down what was removed.

## If a secret was in a transcript that left the machine

Deleting the file does not revoke the credential. Rotate it ([[leaked-credential-rotation]]), then delete the copies. Rotation is the control; deletion is housekeeping.

## Failure modes

- The agent's log directory sits under a synced home directory and the transcript is copied to personal cloud storage.
- A hook logs the raw tool input and the audit file now contains the secrets the transcript was supposed to be the only home for.
- A bug report is filed with a whole session attached because no one asked whether an excerpt would do.
- The transcript is deleted after a week and the incident review a month later has no record of which commands ran.
- Redaction runs on user prompts only; tokens printed by a failing command pass through untouched.
- A secret is deleted from a transcript but never rotated.
- A tool update changes the transcript location or format and the ignore rules and sync exclusions stop matching.

## Review checklist

- [ ] The transcript class is defined in the data-classification standard, with an owner.
- [ ] For each allowed tool, the transcript location, format and retention were checked against its current docs.
- [ ] Transcript directories are in `.gitignore`, backup exclusions and sync exclusions.
- [ ] CI jobs that run agents list artifact paths explicitly and set an expiry.
- [ ] A separate audit record exists and does not contain raw tool input.
- [ ] Retention for full transcripts and for audit records is set by policy, not by tool defaults.
- [ ] Sharing a transcript requires a secret scan, a manual review and a check of the recipient's terms.
- [ ] The incident process says to rotate any credential that appeared in a shared or leaked transcript.
- [ ] Access to stored transcripts is owner-only, with a documented route for incident responders.

## Sources

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) - what not to log (passwords, tokens, session identifiers, personal data); not fetched, check before relying on it.
- [NIST SP 800-92, Guide to Computer Security Log Management](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-92.pdf) - log retention and protection of logs; the URL is the legacy edition, check which revision is current.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
