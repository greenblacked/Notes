import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github/scripts/repo-settings.sh",
)
const dir = mkdtempSync(join(tmpdir(), "repo-settings-"))
after(() => rmSync(dir, { recursive: true, force: true }))

// A fake `gh` that logs its arguments (and the JSON body of --input -) and answers reads from
// JSON in the environment:
//   FAKE_RULESETS   list of rulesets          FAKE_RULESET_BY_ID  {"<id>": ruleset}
//   FAKE_ENVS       {"<env>": environment}    FAKE_POLICIES       {"<env>": [policy, ...]}
//   FAKE_FORK       fork approval settings    FAKE_FAIL_PATH      path answered with HTTP 500
// Every other read answers HTTP 404. Writes are logged and answer {}.
const gh = join(dir, "gh")
writeFileSync(
  gh,
  `#!/usr/bin/env bash
echo "$*" >>"$FAKE_GH_LOG"
method=GET; path=""; input=0
shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    --input) input=1; shift 2 ;;
    --paginate) shift ;;
    *) path="\${1#repos/*/*/}"; shift ;;
  esac
done
if [[ "$input" == 1 ]]; then echo "BODY $(cat)" >>"$FAKE_GH_LOG"; fi
if [[ "$method" != GET ]]; then echo '{}'; exit 0; fi
by_id="\${FAKE_RULESET_BY_ID:-}"; [[ -n "$by_id" ]] || by_id='{}'
envs="\${FAKE_ENVS:-}"; [[ -n "$envs" ]] || envs='{}'
pols="\${FAKE_POLICIES:-}"; [[ -n "$pols" ]] || pols='{}'
fork="\${FAKE_FORK:-}"; [[ -n "$fork" ]] || fork='{"approval_policy":"first_time_contributors"}'
notfound() { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
if [[ -n "\${FAKE_FAIL_PATH:-}" && "$path" == "$FAKE_FAIL_PATH" ]]; then
  echo "gh: Server Error (HTTP 500)" >&2; exit 1
fi
case "$path" in
  rulesets\\?*) echo "\${FAKE_RULESETS:-[]}" ;;
  rulesets/*) jq -ce --arg id "\${path#rulesets/}" '.[$id] // empty' <<<"$by_id" | grep . || notfound ;;
  environments/*/deployment-branch-policies)
    name="\${path#environments/}"; name="\${name%%/*}"
    jq -ce --arg n "$name" '{total_count: (.[$n] | length), branch_policies: .[$n]}' <<<"$pols" || notfound ;;
  environments/*) jq -ce --arg n "\${path#environments/}" '.[$n] // empty' <<<"$envs" | grep . || notfound ;;
  actions/permissions/fork-pr-contributor-approval) echo "$fork" ;;
  *) notfound ;;
esac
`,
)
chmodSync(gh, 0o755)

const CI = { context: "CI OK", integration_id: 15368 }
const rules = (methods, checks = [CI]) => [
  { type: "deletion" },
  { type: "non_fast_forward" },
  {
    type: "pull_request",
    parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      allowed_merge_methods: methods,
    },
  },
  {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: checks,
    },
  },
]
const ruleset = (id, name, extra = {}) => ({
  id,
  name,
  source_type: "Repository",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: [`refs/heads/${name}`], exclude: [] } },
  rules: rules(name === "dev" ? ["merge", "squash", "rebase"] : ["merge"]),
  ...extra,
})
const goodEnv = (name) => ({
  name,
  protection_rules: [],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
})

function run({ dry = "false", fake = {} } = {}) {
  const log = join(dir, `log-${Math.random()}`)
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    GH_REPO: "owner/repo",
    GH_TOKEN: "test-token",
    DRY_RUN: dry,
    FAKE_GH_LOG: log,
  }
  delete env.GITHUB_STEP_SUMMARY
  for (const [key, value] of Object.entries(fake)) {
    env[`FAKE_${key}`] = typeof value === "string" ? value : JSON.stringify(value)
  }
  const result = spawnSync("bash", [script], { encoding: "utf8", env })
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []
  return { code: result.status, out: result.stdout + result.stderr, calls }
}

const writes = (calls) => calls.filter((c) => /-X (POST|PUT|DELETE|PATCH)/.test(c))
const bodyAfter = (calls, prefix) => {
  const i = calls.findIndex((c) => c.startsWith(prefix))
  assert.notEqual(i, -1, `no call starting with ${prefix}`)
  return JSON.parse(calls[i + 1].slice("BODY ".length))
}

test("dry run with nothing existing only prints PLAN lines", () => {
  const { code, out, calls } = run({ dry: "true" })
  assert.equal(code, 0, out)
  assert.match(out, /PLAN: POST rulesets/)
  assert.match(out, /Dry run: \d+ planned change\(s\)/)
  assert.deepEqual(writes(calls), [])
  assert.doesNotMatch(out, /test-token/)
})

test("apply with no rulesets creates dev and main", () => {
  const { code, out, calls } = run()
  assert.equal(code, 0, out)
  const posts = calls
    .map((c, i) => (c.startsWith("api -X POST repos/owner/repo/rulesets") ? i : -1))
    .filter((i) => i >= 0)
    .map((i) => JSON.parse(calls[i + 1].slice(5)))
  assert.deepEqual(
    posts.map((p) => p.name),
    ["dev", "main"],
  )
  const dev = posts[0]
  assert.deepEqual(dev.bypass_actors, [])
  assert.deepEqual(dev.conditions.ref_name.include, ["refs/heads/dev"])
  const checks = dev.rules.find((r) => r.type === "required_status_checks").parameters
  assert.deepEqual(checks.required_status_checks, [CI])
  const main = posts[1]
  assert.deepEqual(
    main.rules.find((r) => r.type === "pull_request").parameters.allowed_merge_methods,
    ["merge"],
  )
})

test("a dev ruleset that is already right is not changed", () => {
  const { code, out, calls } = run({
    fake: { RULESETS: [ruleset(1, "dev")], RULESET_BY_ID: { 1: ruleset(1, "dev") } },
  })
  assert.equal(code, 0, out)
  assert.match(out, /ruleset dev up to date/)
  assert.equal(
    writes(calls).filter((c) => c.includes("rulesets/1")).length,
    0,
    "no PUT of the dev ruleset",
  )
})

test("a dev ruleset with a bypass actor is replaced", () => {
  const bad = ruleset(1, "dev", { bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }] })
  const { code, calls } = run({ fake: { RULESETS: [bad], RULESET_BY_ID: { 1: bad } } })
  assert.equal(code, 0)
  assert.ok(calls.some((c) => c.startsWith("api -X PUT repos/owner/repo/rulesets/1")))
})

test("a dev ruleset that targets the wrong branch is replaced", () => {
  const bad = ruleset(1, "dev", {
    conditions: { ref_name: { include: ["refs/heads/other"], exclude: [] } },
  })
  const { code, calls } = run({ fake: { RULESETS: [bad], RULESET_BY_ID: { 1: bad } } })
  assert.equal(code, 0)
  assert.ok(calls.some((c) => c.startsWith("api -X PUT repos/owner/repo/rulesets/1")))
})

test("a dev ruleset with an exclude pattern is replaced", () => {
  const bad = ruleset(1, "dev", {
    conditions: { ref_name: { include: ["refs/heads/dev"], exclude: ["refs/heads/x"] } },
  })
  const { code, calls } = run({ fake: { RULESETS: [bad], RULESET_BY_ID: { 1: bad } } })
  assert.equal(code, 0)
  assert.ok(calls.some((c) => c.startsWith("api -X PUT repos/owner/repo/rulesets/1")))
})

test("a main ruleset that does not target main fails loudly", () => {
  const bad = ruleset(2, "main", {
    conditions: { ref_name: { include: ["refs/heads/other"], exclude: [] } },
  })
  const { code, out, calls } = run({ fake: { RULESETS: [bad], RULESET_BY_ID: { 2: bad } } })
  assert.notEqual(code, 0)
  assert.match(out, /may not protect the branch main/)
  assert.equal(writes(calls).filter((c) => c.includes("rulesets/2")).length, 0)
})

test("a main ruleset with any exclude pattern fails loudly without writing", () => {
  for (const ex of ["refs/heads/main", "~DEFAULT_BRANCH", "refs/heads/m*"]) {
    const bad = ruleset(2, "main", {
      conditions: { ref_name: { include: ["refs/heads/main"], exclude: [ex] } },
    })
    const { code, out, calls } = run({ fake: { RULESETS: [bad], RULESET_BY_ID: { 2: bad } } })
    assert.notEqual(code, 0)
    assert.match(out, /may not protect the branch main/)
    assert.equal(writes(calls).filter((c) => c.includes("rulesets/2")).length, 0)
  }
})

test("a main ruleset with only deletion keeps it, gains the other rules and its bypass actors", () => {
  const bypass = [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }]
  const main = ruleset(2, "main", { rules: [{ type: "deletion" }], bypass_actors: bypass })
  const { code, out, calls } = run({
    fake: { RULESETS: [main], RULESET_BY_ID: { 2: main } },
  })
  assert.equal(code, 0, out)
  const body = bodyAfter(calls, "api -X PUT repos/owner/repo/rulesets/2")
  assert.deepEqual(body.rules.map((r) => r.type).sort(), [
    "deletion",
    "non_fast_forward",
    "pull_request",
    "required_status_checks",
  ])
  assert.deepEqual(body.bypass_actors, bypass)
  assert.match(out, /WARN: ruleset main has bypass actors/)
})

test("the CI OK check is appended to an existing check list, never replacing it", () => {
  const other = { context: "other" }
  const main = ruleset(2, "main", { rules: rules(["merge"], [other]) })
  const { code, calls } = run({ fake: { RULESETS: [main], RULESET_BY_ID: { 2: main } } })
  assert.equal(code, 0)
  const body = bodyAfter(calls, "api -X PUT repos/owner/repo/rulesets/2")
  const checks = body.rules.find((r) => r.type === "required_status_checks").parameters
  assert.deepEqual(checks.required_status_checks, [other, CI])
})

test("a CI OK check without the pinned integration id is replaced, not duplicated", () => {
  for (const stale of [{ context: "CI OK" }, { context: "CI OK", integration_id: 1 }]) {
    const other = { context: "other" }
    const main = ruleset(2, "main", { rules: rules(["merge"], [stale, other]) })
    const { code, calls } = run({ fake: { RULESETS: [main], RULESET_BY_ID: { 2: main } } })
    assert.equal(code, 0)
    const body = bodyAfter(calls, "api -X PUT repos/owner/repo/rulesets/2")
    const checks = body.rules.find((r) => r.type === "required_status_checks").parameters
    assert.deepEqual(checks.required_status_checks, [other, CI])
  }
})

test("environment dev: the dev policy is added before the main policy is deleted", () => {
  const { code, out, calls } = run({
    fake: {
      ENVS: { dev: goodEnv("dev") },
      POLICIES: { dev: [{ id: 77, name: "main", type: "branch" }] },
    },
  })
  assert.equal(code, 0, out)
  const post = calls.findIndex((c) =>
    c.startsWith("api -X POST repos/owner/repo/environments/dev/deployment-branch-policies"),
  )
  const del = calls.findIndex((c) =>
    c.startsWith("api -X DELETE repos/owner/repo/environments/dev/deployment-branch-policies/77"),
  )
  assert.ok(post >= 0 && del >= 0, "both calls happen")
  assert.ok(post < del, "POST before DELETE")
  assert.deepEqual(JSON.parse(calls[post + 1].slice(5)), { name: "dev", type: "branch" })
})

test("an environment PUT keeps the existing reviewers and wait timer", () => {
  const env = {
    name: "dev",
    protection_rules: [
      { type: "wait_timer", wait_timer: 5 },
      {
        type: "required_reviewers",
        prevent_self_review: true,
        reviewers: [{ type: "User", reviewer: { id: 9, login: "someone" } }],
      },
    ],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  }
  const { code, calls } = run({ fake: { ENVS: { dev: env } } })
  assert.equal(code, 0)
  const body = bodyAfter(calls, "api -X PUT repos/owner/repo/environments/dev")
  assert.deepEqual(body, {
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    wait_timer: 5,
    prevent_self_review: true,
    reviewers: [{ type: "User", id: 9 }],
  })
})

test("production is never the target of a mutating call", () => {
  for (const dry of ["true", "false"]) {
    const { code, calls } = run({
      dry,
      fake: {
        ENVS: { production: goodEnv("production"), staging: goodEnv("staging") },
        POLICIES: { production: [{ id: 1, name: "main", type: "branch" }] },
      },
    })
    assert.equal(code, 0)
    assert.deepEqual(
      writes(calls).filter((c) => /environments\/production/.test(c)),
      [],
    )
  }
})

test("the leftover staging environment is deleted", () => {
  const { calls } = run({ fake: { ENVS: { staging: goodEnv("staging") } } })
  assert.ok(calls.some((c) => c.startsWith("api -X DELETE repos/owner/repo/environments/staging")))
})

test("an API error other than 404 exits non-zero", () => {
  const { code, out } = run({ fake: { FAIL_PATH: "environments/dev" } })
  assert.notEqual(code, 0)
  assert.match(out, /GET environments\/dev failed/)
})
