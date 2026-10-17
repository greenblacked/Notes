---
title: Cloudflare cache strategy with Cache Rules, Cache-Control and purge
description: Decide between origin headers and Cache Rules, set cache keys and stale directives, purge by tag or URL, and avoid caching personalised responses on Cloudflare.
type: pattern
tags:
  - patterns
  - networking
  - security
  - terraform
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Caching at the edge makes a site faster and cheaper to run, and a caching mistake can leak one user's page to another. This note sets out a simple order of decisions for Cloudflare: let the **origin say what is cacheable**, use **Cache Rules** only to override, keep the cache key small, serve stale content on purpose, purge precisely, and treat anything personalised as uncacheable until proven otherwise.

> [!warning] Cloudflare behaviour and limits are not verified
> This note was written from known Cloudflare behaviour and was not tested against a live zone. These items are **not verified**: whether and when Cache Response Rules are available, plan limits (number of rules, cache key options, tag purge, custom cache keys, minimum TTLs), whether `stale-while-revalidate` is served asynchronously by default, how responses with `Set-Cookie` or `Vary` are treated, and purge rate limits. Check the Cloudflare documentation for your plan before relying on any of it. The Terraform follows the v4 provider block syntax and was not planned or applied; version 5 changed resource syntax.

## Origin Cache-Control first

The origin knows how fresh its own content is. A header that travels with the response is easier to reason about, test and review than a rule hidden in a dashboard. So start there, and add Cache Rules only for what headers cannot express.

Cloudflare does not cache everything. By default it caches static file types by extension, and it does not cache HTML or JSON unless a rule or a header says so (which content types are cached by default is **not verified** for your plan; check the documentation). A response that is not eligible shows `cf-cache-status: DYNAMIC`.

An origin header for content that can be shared between users and can be a little old:

```http
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400
```

| Directive                    | Meaning                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `public`                     | Any cache may store the response.                                                                  |
| `max-age=60`                 | The browser treats it as fresh for 60 seconds.                                                     |
| `s-maxage=300`               | Shared caches such as Cloudflare treat it as fresh for 300 seconds. It overrides `max-age` there.  |
| `stale-while-revalidate=600` | After it expires, a cache may serve the old copy for up to 600 seconds while it fetches a new one. |
| `stale-if-error=86400`       | If the origin fails, a cache may serve the old copy for up to 86400 seconds (one day).             |

The values are an example for a content page that changes rarely. Pick them from how stale you can tolerate. The browser lifetime is shorter than the edge lifetime on purpose: you can purge the edge, but you cannot purge a user's browser.

For content that must never be shared or stored:

```http
Cache-Control: private, no-store
```

Use `private` for per-user responses, and `no-store` when the response must not be written to any cache. A response with only `no-cache` may still be stored and revalidated. Whether a given directive is honoured by Cloudflare as written (`s-maxage`, `stale-*`, `private`) is **not verified** here, so confirm with the tests at the end of this note.

For fingerprinted static assets (file names with a content hash), the right header is long and immutable:

```http
Cache-Control: public, max-age=31536000, immutable
```

Only do this when the file name changes with its content. Otherwise a deployed fix is invisible for a year.

## When to override with Cache Rules

Use a Cache Rule when you cannot or should not change the origin headers:

- The origin is a third-party or legacy system that sends `no-cache` or short TTLs for assets you know are static.
- You want the edge to cache for longer than the browser, for a path pattern.
- You need to **bypass** cache for a path, host or cookie, as a safety net for personalised content.
- You want to change which parts of the URL form the cache key.

Rules of thumb:

1. **Prefer bypass overrides to cache overrides.** Telling Cloudflare _not_ to cache is safe. Telling it to cache something the origin did not mark is the dangerous direction.
2. **Scope narrowly.** Match a path prefix and a host, not the whole zone.
3. **Never override for a response that depends on a cookie, an `Authorization` header or any identity.**
4. **Keep rules in code,** reviewed like any other change, see [[terraform-module-and-state-layout]].

A Cache Rule expression for a static path, with an edge TTL override:

```text title="Cache Rule expression"
(http.host eq "www.example.com" and starts_with(http.request.uri.path, "/static/"))
```

The same rule as Terraform, in the `http_request_cache_settings` phase. The first rule caches `/static/` at the edge for a day and respects the origin's browser TTL. The second is a safety rule that bypasses cache for anything with a session cookie. The order matters: rules run top to bottom, and the bypass should come first.

```hcl title="edge/cloudflare-cache.tf"
variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID for example.com. Change to your zone."
}

resource "cloudflare_ruleset" "cache_settings" {
  zone_id     = var.zone_id
  name        = "Cache settings"
  description = "Cache Rules for www.example.com, managed in Terraform"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  # 1. Safety net: never cache requests that carry a session cookie.
  #    Change "session" to the name of your real session cookie.
  rules {
    action      = "set_cache_settings"
    description = "Bypass cache when a session cookie is present"
    enabled     = true
    expression  = "(http.host eq \"www.example.com\" and http.cookie contains \"session=\")"

    action_parameters {
      cache = false
    }
  }

  # 2. Static assets: cache at the edge for one day, let the origin set the browser TTL.
  rules {
    action      = "set_cache_settings"
    description = "Cache /static/ at the edge"
    enabled     = true
    expression  = "(http.host eq \"www.example.com\" and starts_with(http.request.uri.path, \"/static/\"))"

    action_parameters {
      cache = true

      edge_ttl {
        mode    = "override_origin"
        default = 86400 # seconds. Change to match how often /static/ content changes.
      }

      browser_ttl {
        mode = "respect_origin"
      }
    }
  }
}
```

The `edge_ttl` and `browser_ttl` mode names and attributes are **not verified** against the provider version you pin. Run `terraform plan` and read the provider documentation first. A rule with `cache = true` caches content that would otherwise be dynamic, so check that nothing under `/static/` is personalised.

Cloudflare has also introduced rules that act on the response (Cache Response Rules). Their availability and date are **not verified**; check the documentation before depending on them.

## Cache keys

The cache key decides which requests share one cached object. By default it is built from the URL (scheme, host, path and query string), so `?a=1` and `?a=2` are two objects. Keep the key as small as it can safely be.

| Situation                                              | What to do                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Marketing parameters (`utm_source`) fragment the cache | Exclude them from the key in a Cache Rule, or ignore the query string if none affects the response. |
| A query parameter changes the response (`?lang=de`)    | Keep it in the key. Never drop a parameter that changes the content.                                |
| The response differs by header (language, device)      | Put that header into the key, or send different URLs. Do not depend on `Vary`.                      |
| The response differs by cookie                         | Do not cache it. See the personalised-response checklist below.                                     |

Two warnings:

- **Too small a key serves the wrong content.** If the key leaves out something the response depends on, one user's variant is served to another.
- **Too large a key causes misses.** A key that includes a cookie or a unique header makes nearly every request a miss, and the cache does nothing.

How Cloudflare handles the `Vary` header, and which custom cache key options your plan allows, are **not verified**. Test with the commands below rather than assuming.

## stale-while-revalidate and stale-if-error

Both directives let the cache serve an old copy on purpose.

- **`stale-while-revalidate`** removes the slow request that a user would otherwise wait for when the object expires. One user, or a background fetch, refreshes it, and everyone else keeps getting fast answers. Whether Cloudflare revalidates asynchronously by default or needs a setting is **not verified**; check the documentation and observe the `UPDATING` and `STALE` statuses during a test.
- **`stale-if-error`** keeps the site up while the origin is down. A page that is a day old is usually better than a 5xx, for content that tolerates it. Do not use it for balances, stock levels or anything where old is wrong.

Choose the windows from the business rule, not from habit: how old can this be before it misleads someone? See [[timeouts-retries-load-shedding]] for how stale answers fit with overload protection, and [[slo-burn-rate-alerting]] for alerting on origin errors that the cache is hiding.

> [!tip] A cache can hide an outage
> With `stale-if-error`, users may see a healthy site while the origin has failed. Alert on origin errors and on the share of `STALE` responses, not only on what users see.

## Purge by tag or URL

Lifetimes handle most of the work. Purge is for the exceptions: a wrong price, a legal change, a leaked page.

Prefer **targeted** purge. A purge of everything sends a surge of requests to the origin at once, which is itself an incident. Options, from narrowest to widest:

| Method           | Use when                                                         | Notes                                                                             |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| By URL           | One or a few pages changed.                                      | Exact URLs, including the query string if it is part of the key.                  |
| By cache tag     | A set of related pages changed (a product and all its listings). | The origin adds a `Cache-Tag` response header. Plan availability is not verified. |
| By prefix/host   | A section changed.                                               | Plan availability is not verified.                                                |
| Purge everything | Last resort.                                                     | Plan for the origin load that follows.                                            |

Tag the response at the origin:

```http
Cache-Tag: product-1234, category-shoes
```

Purge by tag with the API. Keep the token in your secret store with the narrowest scope that allows cache purge for this zone, never in a script or the repository. The endpoint and body are written from memory of the Cloudflare API and are **not verified**:

```bash
ZONE_ID="0123456789abcdef0123456789abcdef"   # example value; use your zone ID
: "${CF_API_TOKEN:?set CF_API_TOKEN to a token that can purge cache for this zone}"

curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"tags":["product-1234"]}'
```

Purge by URL uses a body such as `{"files":["https://www.example.com/products/1234"]}`. Purge rate limits and the number of tags or URLs per call are **not verified**; for a bulk change, batch the calls and respect the limits stated in the documentation.

After a purge, check the result with the commands in the testing section. A purge removes the edge copy only. Browsers that still hold a fresh copy keep it until `max-age` ends, which is another reason to keep browser lifetimes short for content that may need a purge.

## Page Rules as legacy

Page Rules are the older way to set caching per URL pattern. Cache Rules and the other rule types replace their caching functions, with clearer expressions and better support in Terraform. Whether and when Cloudflare retires Page Rules is **not verified**.

If you inherit Page Rules:

1. List them and note what each does. They run in priority order and the first match can stop the others.
2. Re-create each caching rule as a Cache Rule, in code.
3. Check that the new rule gives the same result with the tests below, then remove the Page Rule.
4. Do not mix old and new rules for the same path. The result is hard to predict.

## Personalised-response checklist

Caching a personalised response is the costly mistake: one visitor sees another's account page, basket or token. Before any cache rule goes live, check each item.

- [ ] The response does not vary by cookie, `Authorization` header, client certificate or any user identity. If it does, it is not cacheable at the edge.
- [ ] Authenticated paths (`/account/`, `/api/`, `/admin/`) send `Cache-Control: private, no-store` from the origin.
- [ ] No Cache Rule with `cache = true` matches a path that can contain user data. Prefer path allow lists (`/static/`) to deny lists.
- [ ] A bypass rule for session cookies exists as a safety net (see above).
- [ ] The cache key includes everything the response depends on (language, currency, device variant), or those variants have separate URLs.
- [ ] Error pages and redirects that include a user identifier or a return URL are not cached with that data.
- [ ] Responses that set a cookie are not cached unless you have confirmed how your plan treats `Set-Cookie`. This behaviour is **not verified**.
- [ ] Applications behind [[cloudflare-access-service-tokens|Cloudflare Access]] do not cache authenticated responses at a shared edge without checking the effect on the Access login.
- [ ] Content with a short life (prices, stock, feature flags) has a short edge TTL or is not cached.
- [ ] You tested as two different users and saw only your own data (see below).

For an API that sits behind a Worker, remember that a Worker response is the Worker's own: it sets its own `Cache-Control` and does not inherit headers from a static `_headers` file, which applies to static assets only. See the next section.

### Workers and /api/*

When a Worker serves `/api/*`, the Worker is the origin for those paths:

- Set `Cache-Control` explicitly on every API response from the Worker: `private, no-store` for anything personal, and a short `public, s-maxage=...` only for data that is the same for everyone.
- Set `Content-Type` and `X-Content-Type-Options: nosniff` in the Worker as well, so the response does not depend on static asset rules.
- A static headers file applies to static assets and **not** to responses generated by the Worker (verify this with a request on your own deployment before you rely on it).
- If the Worker uses the Cache API, key it on the full URL and never on a value that depends on the user. Keep personal data out of cached entries.

Deployment and rollback of the Worker are in [[cloudflare-workers-deploy-and-rollback]].

## Testing with cf-cache-status

Test each path with `curl -sI` and read the headers. Repeat the request to see the status change. Use the real hostname and a path you own.

```bash
URL="https://www.example.com/static/app.css"   # change to a path you want to test

curl -sI "$URL" | grep -iE '^(HTTP|cache-control|age|cf-cache-status|content-type)'
curl -sI "$URL" | grep -iE '^(HTTP|cache-control|age|cf-cache-status)'
```

Illustrative output (not real data), first request then second:

```text
HTTP/2 200
cache-control: public, max-age=60, s-maxage=300
cf-cache-status: MISS

HTTP/2 200
cache-control: public, max-age=60, s-maxage=300
age: 12
cf-cache-status: HIT
```

Read `cf-cache-status` like this. The list is not complete, and the exact meaning of each value is **not verified** against the current documentation:

| Value         | Meaning                                                 | What to do                                                                            |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `HIT`         | Served from the edge cache.                             | Expected for cacheable content after the first request.                               |
| `MISS`        | Eligible, but not in cache; fetched from the origin.    | Repeat the request. A permanent `MISS` means the key varies or the object is evicted. |
| `EXPIRED`     | Was in cache but stale; fetched again from the origin.  | Normal at the end of a TTL.                                                           |
| `STALE`       | Served an expired copy.                                 | Expected with the stale directives. Check the origin if it persists.                  |
| `UPDATING`    | Served a stale copy while a new one is being fetched.   | Expected with stale-while-revalidate.                                                 |
| `REVALIDATED` | Stale copy checked with the origin and confirmed fresh. | Normal for objects with validators.                                                   |
| `BYPASS`      | Cache was skipped by a rule or a directive.             | Expected for personalised paths. Unexpected on `/static/`.                            |
| `DYNAMIC`     | Not eligible for cache under the current settings.      | Add headers or a Cache Rule if it should be cached. Expected for API responses.       |

Tests to run before and after each change:

1. **Cacheable path.** Request twice, confirm `MISS` then `HIT`, and confirm `age` increases.
2. **Query string.** Request with a marketing parameter and confirm it shares the same object (or not), as your key design says.
3. **Session cookie.** Add `-H 'Cookie: session=test'` and confirm `BYPASS` or `DYNAMIC`, never `HIT`.
4. **Two users.** Fetch a personal page as two different test accounts and confirm each sees only their own data, and that neither response is a `HIT`.
5. **Purge.** After a purge, confirm the next request is a `MISS`.
6. **Origin down.** In a test environment, stop the origin and confirm stale content is served as intended for `stale-if-error`.

Put tests 1 to 3 into the deploy pipeline for the zone, so a rule change that breaks caching, or starts caching what it should not, fails before it reaches users.

## Related

- [[cloudflare-workers-deploy-and-rollback]] for releasing and rolling back the Worker that serves `/api/*`.
- [[edge-waf-rate-limiting]] for the WAF and rate limits that run on the same zone.
- [[cloudflare-access-service-tokens]] for protecting internal applications, which must not be cached as public content.
- [[terraform-module-and-state-layout]] for keeping edge rules in code.
- [[timeouts-retries-load-shedding]] for protecting the origin when the cache cannot.
