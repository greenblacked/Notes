#!/usr/bin/env node
// Cloudflare checks for the stage Preview (Node built-ins and global fetch only).
//   preflight          fail unless an Access application covers stage.notes.szolotov.com and no
//                      Custom Domain or DNS record shadows the Preview hostname
//   ensure-access      create the stage Access application from the dev one when none covers stage
//   retire-dev-access  delete the Access application that covers only dev.notes.szolotov.com
// Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Never prints them, nor any policy
// include/exclude value (they hold emails): only ids, names, types, hosts and decisions.
import { pathToFileURL } from "node:url"

const API = "https://api.cloudflare.com/client/v4"
const STAGE_HOST = "stage.notes.szolotov.com"
const DEV_HOST = "dev.notes.szolotov.com"
const ZONE = "szolotov.com"
const WILDCARD = "*.notes.szolotov.com"
const SCOPE_HINT =
  "the token lacks Account · Access: Apps and Policies (Read for preflight, Edit for ensure-access/retire)"

const GROUPS_SCOPE_HINT =
  "the token lacks Account · Access: Organizations, Identity Providers, and Groups: Read (needed only when a stage Access policy uses group rules)"

const normHost = (h) =>
  String(h || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]

// Hosts of an Access application, lowercased, with the path removed.
export function hostsOf(app) {
  const hosts = []
  if (app?.domain) hosts.push(normHost(app.domain))
  for (const d of app?.self_hosted_domains ?? []) hosts.push(normHost(d))
  for (const d of app?.destinations ?? []) {
    if ((d.type ?? "public") === "public" && d.uri) hosts.push(normHost(d.uri))
  }
  return [...new Set(hosts.filter(Boolean))]
}

const pathOf = (value) => {
  const rest = String(value || "")
    .replace(/^https?:\/\//, "")
    .split("/")
    .slice(1)
    .join("/")
  return rest === "" ? "" : `/${rest}`
}

// Every host-with-path entry of an Access application (domain, self_hosted_domains, public
// destinations).
function entriesOf(app) {
  const entries = []
  if (app?.domain) entries.push(app.domain)
  for (const d of app?.self_hosted_domains ?? []) entries.push(d)
  for (const d of app?.destinations ?? []) {
    if ((d.type ?? "public") === "public" && d.uri) entries.push(d.uri)
  }
  return entries
}

const isStageEntry = (e) => [STAGE_HOST, WILDCARD].includes(normHost(e))
const isBroaderEntry = (e) => [`*.${ZONE}`, ZONE].includes(normHost(e))

// True when some entry is the stage host, the notes wildcard, the zone wildcard or the zone apex,
// whatever its path (conservative). Such an application can decide who reaches stage (Access
// applies the most specific one).
export function touchesStage(app) {
  return entriesOf(app).some((e) => isStageEntry(e) || isBroaderEntry(e))
}

// True when a host equals stage or the notes wildcard and the path is empty, "/" or "/*".
export function coversStage(app) {
  return entriesOf(app).some((e) => isStageEntry(e) && ["", "/", "/*"].includes(pathOf(e)))
}

// Include rule types that name identities. Anything else (everyone, email_domain, login_method,
// any_valid_service_token, geo, ip, ...) can be satisfied by people who were never named, so it
// is a problem.
const IDENTITY_RULES = new Set([
  "email",
  "email_list",
  "group", // resolved against the account's Access groups in ruleProblems
  "github-organization",
  "gsuite",
  "azureAD",
  "okta",
])

// Problems in a list of include rules (a policy's or a group's). `groups` maps a group id to the
// group object; null means groups were not loaded.
function ruleProblems(label, include, groups, inGroup) {
  const problems = []
  if (!Array.isArray(include) || include.length === 0) {
    problems.push(`${label} has no include rules`)
    return problems
  }
  for (const r of include) {
    if (!r || typeof r !== "object" || Object.keys(r).length === 0) {
      problems.push(`${label} has an invalid include rule`)
      continue
    }
    for (const type of Object.keys(r)) {
      if (type === "everyone") problems.push(`${label} includes everyone`)
      else if (type === "group" && !inGroup) {
        const id = r.group?.id
        const g = groups?.[id]
        if (!g) problems.push(`${label} references the unknown group ${id ?? "?"}`)
        else
          problems.push(
            ...ruleProblems(`group ${g.name ?? id} (in ${label})`, g.include, groups, true),
          )
      } else if (!IDENTITY_RULES.has(type) || type === "group") {
        problems.push(`${label} includes the non-identity rule type ${type}`)
      }
    }
  }
  return problems
}

const usesGroup = (policies) =>
  policies.some((p) => (p.include ?? []).some((r) => r && typeof r === "object" && "group" in r))

// Problems that make a set of policies unsafe: none at all, bypass or non_identity decisions, no
// include rules, or an include rule that does not name identities. A group rule is resolved
// through `groups` (id -> group) and its own include rules get the same check.
export function policyProblems(policies, groups = null) {
  const list = policies ?? []
  if (list.length === 0) return ["no policies"]
  const problems = []
  for (const p of list) {
    const label = `policy ${p.name ?? p.id ?? "?"}`
    if (p.decision === "bypass" || p.decision === "non_identity") {
      problems.push(`${label} has decision ${p.decision}`)
    }
    problems.push(...ruleProblems(label, p.include, groups, false))
  }
  return problems
}

// Recognises an Access application attached to the Worker `notes` (or to all Workers) for
// Previews. TODO: the API shape of Worker-level Access protection is not documented well enough
// to pin down; until it is, this returns false and the preflight fails closed (it prints the
// sanitised application list, so the shape can be fixed after the first real run).
export function workerLevelCover() {
  return false
}

// True when at least one policy is an allow with only safe identity include rules. An application
// with only deny or other decisions grants nobody access, so it must not count as coverage.
export function hasSafeAllow(policies, groups = null) {
  return (policies ?? []).some(
    (p) => p?.decision === "allow" && ruleProblems("policy", p.include, groups, false).length === 0,
  )
}

// The workers.dev Preview hostname is stage-notes.<subdomain>.workers.dev. The account subdomain
// is not read from the API, so these hosts count (conservative): any `stage-notes.<label>.workers.dev`
// host, and any workers.dev host containing `*` anywhere (`*.workers.dev`, `*.sub.workers.dev`,
// `*-notes.sub.workers.dev`, `stage-*.sub.workers.dev`), when the pattern, with every `*` read as
// `.*`, matches `stage-notes.<label>.workers.dev` (the pattern's own label, or a sample one).
const PREVIEW_HOST = /^stage-notes\.[^.]+\.workers\.dev$/
// The sample label is the pattern's own subdomain label when it has no `*` there, else "sample".
const sampleLabel = (h) => {
  const label = h.split(".").slice(-3, -2)[0]
  return label && !label.includes("*") ? label : "sample"
}
const globMatchesPreview = (h) =>
  new RegExp(
    `^${h
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(`stage-notes.${sampleLabel(h)}.workers.dev`)
const isPreviewEntry = (e) => {
  const h = normHost(e)
  if (PREVIEW_HOST.test(h)) return true
  return h.endsWith(".workers.dev") && h.includes("*") && globMatchesPreview(h)
}

// Any entry of the application that can decide who reaches the workers.dev Preview, whatever
// its path.
export function touchesPreview(app) {
  return entriesOf(app).some(isPreviewEntry)
}

// The whole workers.dev Preview host (empty path, "/" or "/*").
export function coversPreview(app) {
  return entriesOf(app).some((e) => isPreviewEntry(e) && ["", "/", "/*"].includes(pathOf(e)))
}

class ApiError extends Error {}

function makeClient(fetchFn, env) {
  const token = env.CLOUDFLARE_API_TOKEN
  const account = env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !account) {
    throw new ApiError("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required")
  }
  async function call(method, path, body) {
    let res
    try {
      res = await fetchFn(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (e) {
      throw new ApiError(`${method} ${path} failed: ${e?.message ?? "network error"}`)
    }
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    const code = json?.errors?.[0]?.code
    if (!res.ok || !json || json.success === false) {
      const hint =
        path.includes("/access/") && (res.status === 403 || code === 10000)
          ? `: ${path.includes("/access/groups") ? GROUPS_SCOPE_HINT : SCOPE_HINT}`
          : ""
      throw new ApiError(`${method} ${path.split("?")[0]} failed with HTTP ${res.status}${hint}`)
    }
    return json
  }
  async function list(path) {
    const out = []
    for (let page = 1; page < 50; page++) {
      const sep = path.includes("?") ? "&" : "?"
      const json = await call("GET", `${path}${sep}per_page=100&page=${page}`)
      out.push(...(json.result ?? []))
      const info = json.result_info
      if (!info || page >= (info.total_pages ?? 1)) break
    }
    return out
  }
  return { account, call, list }
}

const describeApp = (app) =>
  `${app.id} ${JSON.stringify(app.name ?? "")} ${app.type ?? "?"} hosts=[${hostsOf(app).join(", ")}]`

async function policiesOf(client, app) {
  if (Array.isArray(app.policies) && app.policies.every((p) => p && typeof p === "object")) {
    return app.policies
  }
  const json = await client.call(
    "GET",
    `/accounts/${client.account}/access/apps/${app.id}/policies`,
  )
  return json.result ?? []
}

// Shared by the stage and workers.dev Preview checks. Every application selected by `touches`
// counts, whatever its path: one unsafe application (an exact-host bypass, a path-scoped bypass)
// fails the check even when another one is safe. At least one application selected by `covers`
// must have a safe allow policy. `state.groups` caches the Access groups.
async function evaluate(client, apps, { touches, covers }, state, out) {
  let covered = false
  let unsafe = false
  let seen = 0
  for (const app of apps) {
    const root = covers(app)
    const relevant = root || touches(app)
    out(`  app ${describeApp(app)} covers=${root}${relevant && !root ? " (path scoped)" : ""}`)
    if (!relevant) continue
    seen++
    const policies = await policiesOf(client, app)
    for (const p of policies)
      out(`    policy ${p.id ?? "?"} ${JSON.stringify(p.name ?? "")} decision=${p.decision}`)
    if (state.groups === null && usesGroup(policies)) {
      const all = await client.list(`/accounts/${client.account}/access/groups`)
      state.groups = Object.fromEntries(all.map((g) => [g.id, g]))
    }
    const problems = policyProblems(policies, state.groups)
    for (const pr of problems) out(`    problem: ${pr}`)
    if (problems.length > 0) unsafe = true
    else if (root) {
      if (hasSafeAllow(policies, state.groups)) covered = true
      else out("    problem: no safe allow policy; this application grants nobody access")
    }
  }
  return { covered, unsafe, seen }
}

// Prints and returns whether stage is safely protected.
async function accessCheck(client, out) {
  const apps = await client.list(`/accounts/${client.account}/access/apps`)
  const state = { groups: null }
  const r = await evaluate(
    client,
    apps,
    {
      touches: touchesStage,
      covers: (a) => coversStage(a) || workerLevelCover(a),
    },
    state,
    out,
  )
  return { ok: r.covered && !r.unsafe, apps, state }
}

// The workers.dev Preview URL must be behind Access (the post-upload check also needs the
// redirect). Access applications that name the Preview host are validated like the stage ones;
// an unsafe one, or none with a safe allow policy, fails closed. When no application names the
// Preview host, Access may be enforced at Worker or account level, which the API listing cannot
// show: that case only prints a NOTE and leaves the check after the upload to decide.
async function workersDevCheck(client, apps, state, out) {
  const r = await evaluate(
    client,
    apps,
    { touches: touchesPreview, covers: coversPreview },
    state,
    out,
  )
  if (r.seen === 0) {
    const named = apps.filter((a) => hostsOf(a).some((h) => h.endsWith(".workers.dev")))
    for (const a of named)
      out(`NOTE: workers.dev Access app ${describeApp(a)} names no host that can match stage-notes`)
    out(
      "NOTE: no Access application names the workers.dev Preview host stage-notes.<subdomain>.workers.dev; Worker-level Access cannot be listed through the API, so it is not validated here. The check after the upload must see a redirect to Access, or the Preview is deleted.",
    )
    return true
  }
  return r.covered && !r.unsafe
}

async function preflight(client, out) {
  const { ok, apps, state } = await accessCheck(client, out)
  if (!ok) {
    throw new ApiError(
      `no Cloudflare Access application protects ${STAGE_HOST} with a safe policy (see the list above); running Deploy stage with retire_dev checked copies the dev Access application to stage`,
    )
  }
  out(`OK: an Access application protects ${STAGE_HOST}`)

  if (!(await workersDevCheck(client, apps, state, out))) {
    throw new ApiError(
      "no safe Cloudflare Access application protects the workers.dev Preview host stage-notes.<subdomain>.workers.dev, or an application naming it is unsafe (see the list above)",
    )
  }
  out("OK: the workers.dev Preview host is not exposed by an unsafe Access application")

  const domains = await client.call(
    "GET",
    `/accounts/${client.account}/workers/domains?hostname=${STAGE_HOST}`,
  )
  if ((domains.result ?? []).length > 0) {
    throw new ApiError(
      `a Workers Custom Domain exists for ${STAGE_HOST}; it would shadow the Preview`,
    )
  }
  out(`OK: no Custom Domain for ${STAGE_HOST}`)

  const zones = await client.call(
    "GET",
    `/zones?name=${ZONE}&account.id=${encodeURIComponent(client.account)}`,
  )
  if ((zones.result ?? []).length !== 1) {
    throw new ApiError(
      `expected exactly one zone named ${ZONE}, found ${(zones.result ?? []).length}`,
    )
  }
  const zoneId = zones.result[0].id
  const records = await client.call("GET", `/zones/${zoneId}/dns_records?name.exact=${STAGE_HOST}`)
  if ((records.result ?? []).length > 0) {
    throw new ApiError(`a DNS record exists for ${STAGE_HOST}; it would shadow the wildcard`)
  }
  out(`OK: no DNS record for ${STAGE_HOST}`)
}

const isDevOnly = (app) => {
  const hosts = hostsOf(app)
  return hosts.length === 1 && hosts[0] === DEV_HOST
}

async function ensureAccess(client, out) {
  const before = await accessCheck(client, out)
  if (before.ok) {
    out(`::notice::An Access application already protects ${STAGE_HOST}; nothing to do.`)
    return
  }
  const dev = before.apps.find((a) => a.type === "self_hosted" && isDevOnly(a))
  if (!dev) throw new ApiError("no Access app covers stage or dev; nothing to copy")
  const policies = await policiesOf(client, dev)
  const reusable = policies.length > 0 && policies.every((p) => p.reusable === true)
  const copy = (p, i) => {
    // Every field except the identifiers and timestamps, so approval and session settings stay.
    const { id, uid, created_at, updated_at, reusable: _r, app_count, ...rest } = p
    return { ...rest, precedence: p.precedence ?? i + 1 }
  }
  const body = {
    type: "self_hosted",
    name: "Notes stage",
    domain: STAGE_HOST,
    destinations: [{ type: "public", uri: STAGE_HOST }],
    session_duration: dev.session_duration ?? "24h",
    policies: reusable
      ? policies.map((p, i) => ({ id: p.id, precedence: p.precedence ?? i + 1 }))
      : policies.map(copy),
  }
  const created = await client.call("POST", `/accounts/${client.account}/access/apps`, body)
  out(`Created Access application ${created.result?.id ?? "?"} for ${STAGE_HOST}`)
  const after = await accessCheck(client, out)
  if (!after.ok) throw new ApiError("the new Access application still does not protect stage")
}

async function retireDevAccess(client, out) {
  const apps = await client.list(`/accounts/${client.account}/access/apps`)
  let deleted = 0
  for (const app of apps) {
    if (!hostsOf(app).includes(DEV_HOST)) continue
    if (!isDevOnly(app)) {
      out(`::notice::Access app ${describeApp(app)} covers more than ${DEV_HOST}; left alone.`)
      continue
    }
    await client.call("DELETE", `/accounts/${client.account}/access/apps/${app.id}`)
    out(`Deleted Access app ${describeApp(app)}`)
    deleted++
  }
  if (deleted === 0) out(`::notice::No Access app that covers only ${DEV_HOST}; nothing to delete.`)
  // The dev app may have owned the policies stage uses: stage must still be protected.
  const after = await accessCheck(client, out)
  if (!after.ok) {
    throw new ApiError(
      `after retiring the dev app, no safe Access application protects ${STAGE_HOST}`,
    )
  }
}

const COMMANDS = { preflight, "ensure-access": ensureAccess, "retire-dev-access": retireDevAccess }

export async function main(
  argv,
  { fetch: fetchFn = globalThis.fetch, env = process.env, out = console.log } = {},
) {
  const cmd = COMMANDS[argv[0]]
  if (!cmd || argv.length !== 1) {
    out("usage: cloudflare-stage.mjs <preflight|ensure-access|retire-dev-access>")
    return 2
  }
  try {
    await cmd(makeClient(fetchFn, env), out)
    return 0
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    out(`::error::${e.message}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
