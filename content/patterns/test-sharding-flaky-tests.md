---
title: Test sharding and flaky-test management in CI
description: Split test suites by timing history on GitLab CI and Jenkins, retry only infrastructure failures, and run a quarantine process with owners and deadlines.
type: pattern
tags:
  - patterns
  - ci-cd
  - gitlab-ci
  - jenkins
  - delivery
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Two problems grow together in a large test suite. The pipeline gets slow, so people stop waiting for it. And a few tests fail at random, so people stop trusting it. A "green CI before merge" rule only works when green means something. This note covers deterministic sharding to keep the pipeline short, and a quarantine process with owners and deadlines to keep the suite trustworthy. The examples use pytest, GitLab CI and Jenkins; the ideas apply to other runners.

> [!info] Scope and what is not verified
> The `retry:when` values accepted by your GitLab version, and any published figures about how common flaky tests are at large companies, were not checked when this was written. No such figures are quoted here. Check the GitLab `.gitlab-ci.yml` reference for your version before relying on the retry values below.

## Shard by timing history

Splitting tests evenly by count gives uneven shards, because tests differ in duration by orders of magnitude. The slowest shard sets the pipeline time. Split by recorded duration instead, so each shard gets about the same total time. The split must be deterministic: the same test list and the same durations file always produce the same shards, so a failing shard can be re-run locally.

`pytest-split` does this. It reads a durations file, and for tests it has no timing for it assumes the average, so new tests still land somewhere.

```bash
# Record durations once (and refresh them regularly, see below).
pytest --store-durations --durations-path=.test_durations

# Run shard 3 of 8.
pytest --splits 8 --group 3 --durations-path=.test_durations --splitting-algorithm=least_duration
```

Commit `.test_durations` to the repository, or publish it as an artifact of a scheduled job on the default branch. Refresh it weekly with a scheduled pipeline, because tests change and a stale file gives lopsided shards. A lopsided shard is slow, not wrong, so stale timings are a performance bug rather than a correctness bug.

Rules that keep shards honest:

- Tests must not depend on each other or on order. If shard 3 passes alone but fails when shard 2 runs first on the same machine, that is a test isolation bug to fix, not a reason to pin shards.
- Each shard needs its own database, port range and temp directory. Shared state between parallel jobs is the most common source of flakes created by sharding itself.
- Merge coverage and JUnit reports from all shards. A shard that crashes before writing a report must fail the pipeline, not be skipped.

## GitLab parallel and Jenkins parallel stages

GitLab runs `parallel: N` copies of one job and sets `CI_NODE_INDEX` (starting at 1) and `CI_NODE_TOTAL` in each. Map those straight onto `pytest-split`. See [[gitlab-ci-pipeline-structure]] for stages, `needs` and rules.

```yaml title=".gitlab-ci.yml"
stages: [test]

variables:
  PIP_CACHE_DIR: $CI_PROJECT_DIR/.cache/pip
  # pin to a tested release and digest
  PYTHON_IMAGE: python:<tested-version>@sha256:<digest>

unit-test:
  stage: test
  image: $PYTHON_IMAGE
  parallel: 8 # change: shard count; more shards cost more runner minutes and per-job startup
  cache:
    key:
      files: [requirements.lock]
    paths: [.cache/pip]
  retry:
    max: 1 # one retry, only for infrastructure failures (see Retry policy)
    when: runner_system_failure
  script:
    - pip install --require-hashes -r requirements.lock
    - >
      pytest -m "not quarantine"
      --splits "$CI_NODE_TOTAL" --group "$CI_NODE_INDEX"
      --durations-path=.test_durations
      --junitxml="report-${CI_NODE_INDEX}.xml"
  artifacts:
    when: always
    expire_in: 14 days
    reports:
      junit: report-*.xml
    paths:
      - report-*.xml
```

The Jenkins equivalent builds the parallel branches in a loop and runs each on a pod agent from the shared library setup in [[jenkins-shared-libraries]]. Declarative `parallel` needs literal stages, so generate them in a `script` block.

```groovy title="Jenkinsfile"
def shards = 8 // change: shard count

pipeline {
  agent none
  options {
    timeout(time: 45, unit: 'MINUTES')
  }
  stages {
    stage('Unit tests') {
      steps {
        script {
          def branches = [:]
          for (int i = 1; i <= shards; i++) {
            def group = i
            branches["shard-${group}"] = {
              node('python-test') { // change: label of your pod agent template
                checkout scm
                sh '''
                  pip install --require-hashes -r requirements.lock
                '''
                sh """
                  pytest -m 'not quarantine' \
                    --splits ${shards} --group ${group} \
                    --durations-path=.test_durations \
                    --junitxml=report-${group}.xml
                """
                junit "report-${group}.xml"
              }
            }
          }
          branches.failFast = false // let every shard finish so you see all failures at once
          parallel branches
        }
      }
    }
  }
}
```

Choosing the shard count: add shards until the slowest shard stops getting faster, then stop. Each shard pays for job startup, image pull and dependency install. If setup takes two minutes and the tests take three, eight shards are wasteful. Measure pipeline time and runner minutes before and after.

## Retry policy (infrastructure failures only)

Retrying a failed test hides flakes: the pipeline goes green, the dashboard shows nothing, and the test gets worse. Retry only when the failure has nothing to do with the code under test.

- GitLab: `retry: max: 1` with `when: runner_system_failure` (the runner crashed or lost contact). Other values such as `stuck_or_timeout_failure` or `scheduler_failure` exist for specific infrastructure causes; do not add `script_failure`, which is exactly the case you must not retry.
- Jenkins: retry the agent acquisition or the checkout step, not the test step. Wrap `node` allocation in `retry(2)` only for provisioning errors.
- Never use a blanket "retry the whole job three times" setting. It makes a 5% flake rate look like a 0.01% one, and the real rate comes back the day you remove it.

> [!warning] Retry values are not verified
> The list of `retry:when` values changes between GitLab versions. Confirm `runner_system_failure` and any other value in the reference for your version.

If a team insists on test-level retries (for example `pytest-rerunfailures`), require that every rerun is recorded as a flake event, as described next, so the retry is visible instead of silent.

## Detecting flakes

A flake is a test that gives different results for the same code. You find them by looking at results, not by hunting.

1. **Same commit, different result.** If a test fails in a pipeline and passes on a retry of the same commit, it is a flake candidate. This is the strongest signal.
2. **Failure on the default branch.** A test that fails on `main` with no related change is likely flaky or environment dependent.
3. **Failure rate over time.** A test that fails in a few percent of runs across unrelated merge requests is flaky.

Store every test result from the JUnit reports in a table, with columns for test id, result, commit, pipeline, branch, job and timestamp. BigQuery works well and costs little at this volume. Then ask for the failure rate per test over seven days.

```sql title="flake-rate.sql"
-- Illustrative schema: ci.test_results(test_id STRING, result STRING, commit_sha STRING,
-- pipeline_id INT64, ref STRING, finished_at TIMESTAMP). Adjust names to your table.
WITH runs AS (
  SELECT test_id, result, commit_sha
  FROM `example-project.ci.test_results`
  WHERE finished_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    AND ref = 'main'
),
mixed AS (
  -- Passed and failed on the same commit: the strongest flake signal.
  SELECT test_id, COUNT(*) AS mixed_result_commits
  FROM (
    SELECT test_id, commit_sha
    FROM runs
    GROUP BY test_id, commit_sha
    HAVING COUNT(DISTINCT result) > 1
  )
  GROUP BY test_id
)
SELECT
  r.test_id,
  COUNTIF(r.result = 'failed') AS failures,
  COUNT(*) AS runs,
  ROUND(SAFE_DIVIDE(COUNTIF(r.result = 'failed'), COUNT(*)), 4) AS failure_rate,
  IFNULL(ANY_VALUE(m.mixed_result_commits), 0) AS mixed_result_commits
FROM runs AS r
LEFT JOIN mixed AS m USING (test_id)
GROUP BY r.test_id
HAVING failures > 0
ORDER BY mixed_result_commits DESC, failure_rate DESC
LIMIT 50;
```

Run it weekly and review the top of the list in the team meeting. Filtering on `ref = 'main'` removes failures caused by broken branches; drop the filter to see how flakes cost merge request authors.

## Quarantine lane

Quarantine moves a known flaky test out of the blocking path so it stops blocking everyone, while keeping it running and visible so it cannot be forgotten. Quarantine is a short, tracked loan, not a trash can.

Every quarantined test carries three facts in code: an owner (a team, not a person), an expiry date, and a tracking issue.

```python title="tests/test_payments.py"
import pytest


@pytest.mark.quarantine(owner="team-payments", until="2026-11-14", issue="PAY-1234")
def test_refund_is_idempotent():
    ...
```

```ini title="pytest.ini"
[pytest]
markers =
    quarantine(owner, until, issue): known flaky test; excluded from the blocking job, run in the quarantine job
```

Enforce the metadata and the deadline with a small hook, so a quarantine without an owner or past its date fails the build instead of lingering.

```python title="conftest.py"
import datetime

import pytest

MAX_QUARANTINE_DAYS = 30


def pytest_collection_modifyitems(config, items):
    today = datetime.date.today()
    problems = []
    for item in items:
        marker = item.get_closest_marker("quarantine")
        if marker is None:
            continue
        owner = marker.kwargs.get("owner")
        issue = marker.kwargs.get("issue")
        until = marker.kwargs.get("until")
        if not (owner and issue and until):
            problems.append(f"{item.nodeid}: quarantine needs owner, issue and until")
            continue
        try:
            deadline = datetime.date.fromisoformat(until)
        except ValueError:
            problems.append(f"{item.nodeid}: until must be YYYY-MM-DD, got {until!r}")
            continue
        if deadline < today:
            problems.append(f"{item.nodeid}: quarantine expired on {until} ({issue}); fix or delete the test")
        elif (deadline - today).days > MAX_QUARANTINE_DAYS:
            problems.append(f"{item.nodeid}: quarantine longer than {MAX_QUARANTINE_DAYS} days")
    if problems:
        raise pytest.UsageError("\n".join(problems))
```

The blocking job excludes the marker (`-m "not quarantine"`, as above). A separate job runs only quarantined tests, may fail without blocking, and still publishes its report so you can see whether each test has become stable.

```yaml title=".gitlab-ci.yml"
quarantine-test:
  stage: test
  image: $PYTHON_IMAGE
  allow_failure: true # does not block the merge, but a failure still shows as a warning on the pipeline
  script:
    - pip install --require-hashes -r requirements.lock
    - pytest -m quarantine --junitxml=report-quarantine.xml
  artifacts:
    when: always
    expire_in: 14 days
    reports:
      junit: report-quarantine.xml
```

The expiry check must also fail the blocking job, otherwise an expired quarantine goes unnoticed because the quarantine job is allowed to fail. The hook above runs for every collected test, including the quarantined ones, but `-m "not quarantine"` and `pytest-split` also change the item list in their own hooks.

> [!warning] Hook order with pytest-split is not verified
> The relative order of this hook, the `-m` deselection and `pytest-split` was not tested. Run the expired-quarantine case once on a throwaway branch and confirm that the blocking job fails. If it does not, run the check as its own small job instead.

## Retirement rule

A quarantined test older than 30 days is **fixed or deleted**. There is no third option, and extending the date needs the same approval as a new quarantine.

- Fixed means the root cause is found and the test passes at least 200 consecutive runs in the quarantine lane (pick the number with your team; the point is to have one).
- Deleted means the behaviour is covered elsewhere, or is not worth the cost. A test nobody will fix is worth less than no test, because it teaches people to ignore red.
- The owning team's manager sees the list of tests nearing expiry. This is a delivery cost like any other and belongs in planning, see [[planning-and-prioritization]].
- Fixing a flake is a normal change and goes through [[code-review]]. Reviewers should reject "added a sleep" and "increased the timeout" as fixes unless the cause of the race is explained.

Common root causes to look for first: shared state between tests, time and timezone assumptions, unordered collections, real network calls, port clashes in parallel runs, and resource limits on runners that make timing-sensitive tests slow.

## Metrics

Track a few numbers and review them monthly.

| Metric                                                        | Why it matters                                                                    | Target direction |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------- |
| Pipeline time (p50 and p90) from push to green                | The cost of every change; sharding exists to cut this                             | Down             |
| Slowest shard time divided by mean shard time                 | Shows lopsided shards and stale durations                                         | Close to 1       |
| Flake rate: pipelines with a mixed result for the same commit | The trust measure behind the green-CI rule                                        | Down             |
| Quarantined tests (count) and age of the oldest               | A growing or ageing list means the process is failing                             | Small and young  |
| Rerun count caused by infrastructure failures                 | Runner health, separate from test quality                                         | Down             |
| Runner minutes per merged change                              | The price of sharding; stop adding shards when this climbs faster than time saved | Stable           |

Set your own targets from your baseline; do not copy someone else's number. Pair these with [[dora-metrics]]: lead time for changes is directly affected by pipeline time and by flaky reruns.

## Related notes

- [[gitlab-ci-pipeline-structure]]: stages, `needs`, rules and artifacts.
- [[jenkins-shared-libraries]]: reusable pipeline steps and pod agents.
- [[code-review]]: reviewing test fixes.
- [[dora-metrics]]: lead time and change failure rate.
