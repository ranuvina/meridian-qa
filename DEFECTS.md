# Defect reports

33 defects: 4 critical, 11 high, 14 medium, 4 low. All six support tickets are explained.

| Severity | Meaning |
|---|---|
| **Critical** | Data from one tenant reaches another, privileges can be escalated, or a security control fails open. Release blocker. |
| **High** | Wrong money, a security weakness, or wrong data a customer will see. Release blocker if it is cheap to fix or has no workaround. |
| **Medium** | Incorrect behaviour with limited impact or an easy workaround. |
| **Low** | Cosmetic, test-harness or documentation issue. |

**Status** is either *Fixed* (in commit `09e5651`) or *Open* (kept as an `it.failing` / `test.fail` regression test that turns red once the behaviour changes).

## Reproducing

Fixed defects reproduce on the **pre-fix commit** `25e59d2`, where the regression suite is committed
and failing. Branch `evidence/pre-fix-regressions` is that commit plus only the current CI files;
[its CI run](https://github.com/ranuvina/meridian-qa/actions/runs/39732899815) shows 46 API tests and 2 E2E
journeys failing on the original code. Open defects reproduce on `main`.

```bash
git checkout 25e59d2          # fixed defects only; stay on main for open ones
docker compose down -v && docker compose up -d --build --wait
npm install && DATABASE_URL=postgres://meridian:meridian@localhost:5432/meridian npm run seed
# copy the printed API keys, e.g.  ACME_KEY=mk_xxxx.yyyy  NW_KEY=...

API=http://localhost:4000/api/v1
login() { curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
            -d "{\"email\":\"$1\",\"password\":\"Password123!\"}"; }
token()  { login "$1" | jq -r .accessToken; }
tenant() { login "$1" | jq -r ".tenants[] | select(.slug==\"$2\") | .id"; }
ACME=$(tenant owner@acme.test acme); NW=$(tenant owner@northwind.test northwind)

# call <email> <tenantId> <METHOD> <path> [json-body]   -> prints the response body
call() { curl -s -X "$3" "$API$4" -H "Authorization: Bearer $(token "$1")" -H "x-tenant-id: $2" \
              -H 'Content-Type: application/json' ${5:+-d "$5"}; }
# status <same arguments>                              -> prints only the HTTP status
status() { curl -s -o /dev/null -w '%{http_code}\n' -X "$3" "$API$4" -H "Authorization: Bearer $(token "$1")" \
              -H "x-tenant-id: $2" -H 'Content-Type: application/json' ${5:+-d "$5"}; }
```

Each defect has an automated regression test. Run that test alone with
`docker compose --profile test run --rm tests bash -c "cd apps/api && npx jest -t 'DEF-0NN'"`.

## Summary

| ID | Sev | Status | Ticket | Title |
|---|---|---|---|---|
| [DEF-001](#def-001) | Critical | Fixed | | Usage CSV export returns every tenant's traffic |
| [DEF-002](#def-002) | Critical | Fixed | | Webhook URLs reach internal services (SSRF) |
| [DEF-003](#def-003) | Critical | Fixed | SUP-1067 | Concurrent requests bypass the rate limit |
| [DEF-004](#def-004) | Critical | Fixed | | Role escalation; last OWNER can be removed |
| [DEF-005](#def-005) | High | Fixed | SUP-1051 | Revoked keys keep working for up to 60 s |
| [DEF-006](#def-006) | High | Fixed | | Billing sync can charge the same overage twice |
| [DEF-007](#def-007) | High | Fixed | | Syncing the open month loses later overage |
| [DEF-008](#def-008) | High | Fixed | | VIEWER can read billing data |
| [DEF-009](#def-009) | High | Fixed | | Refresh token still works after logout |
| [DEF-010](#def-010) | High | Open | SUP-1071 | Webhook retries cannot be de-duplicated |
| [DEF-011](#def-011) | High | Fixed | SUP-1067 | Rate limit is per key, not per tenant |
| [DEF-012](#def-012) | High | Open | SUP-1058 | Usage days ignore the tenant timezone |
| [DEF-013](#def-013) | High | Open | | Dashboard shows usage dates one day early west of UTC |
| [DEF-014](#def-014) | High | Fixed | SUP-1062 | Usage page does not scale with keys/volume |
| [DEF-033](#def-033) | High | Open | SUP-1043 | Overage billed while the dashboard shows the tenant under quota |
| [DEF-015](#def-015) | Medium | Open | | Invited accounts get a password the inviter knows |
| [DEF-016](#def-016) | Medium | Open | | Failed gateway requests are not metered; bad input is a 500 |
| [DEF-017](#def-017) | Medium | Open | | Money stored and computed as binary floating point |
| [DEF-018](#def-018) | Medium | Open | | CSV export is not escaped (column shift, formula injection) |
| [DEF-019](#def-019) | Medium | Open | | Malformed ids return 500 |
| [DEF-020](#def-020) | Medium | Open | | Overage total is last-write-wins under concurrency |
| [DEF-021](#def-021) | Medium | Open | | Switching tenant keeps showing the previous tenant's data |
| [DEF-022](#def-022) | Medium | Open | | Dashboard never refreshes its 15-minute access token |
| [DEF-023](#def-023) | Medium | Open | | Privileged actions missing from the audit log |
| [DEF-024](#def-024) | Medium | Open | | Tenant settings not validated |
| [DEF-025](#def-025) | Medium | Open | | CORS reflects any origin with credentials |
| [DEF-026](#def-026) | Medium | Open | | Login has no throttling and leaks registered emails by timing |
| [DEF-027](#def-027) | Medium | Fixed | | Unbounded in-process key cache |
| [DEF-028](#def-028) | Medium | Fixed | | Suspended tenants consume rate-limit budget |
| [DEF-029](#def-029) | Low | Fixed | SUP-1067 | Fixed window allows 2x the limit across a boundary |
| [DEF-030](#def-030) | Low | Fixed | | Mock provider lists idempotent charges twice |
| [DEF-031](#def-031) | Low | Open | | Members page offers role changes to roles that cannot make them |
| [DEF-032](#def-032) | Low | Open | | Seed script comment disagrees with README volume |

---

## Critical

### DEF-001
**Usage CSV export returns every tenant's traffic** · Critical · Fixed

- **Root cause:** `apps/api/src/usage/usage.service.ts` `exportRows()` (original L67–92). Neither query filters by tenant, and the controller never passes the actor's tenant. With `keyId`, any key id is accepted.
- **Preconditions:** seeded data; any user with any role in any tenant.
- **Steps:**
  1. `call viewer@acme.test $ACME GET /usage/export | cut -d, -f2 | sort | uniq -c`
  2. `NWKEY=$(call owner@northwind.test $NW GET /keys | jq -r '.[0].id')`, then `call viewer@acme.test $ACME GET "/usage/export?keyId=$NWKEY" | head`
- **Expected:** only Acme's keys (`Production`, `Staging`) appear. A foreign `keyId` returns 404.
- **Actual:** rows for Northwind `Production` and `Analytics pipeline` and Sakura `Production` (up to 50,000 rows). The foreign `keyId` returns Northwind's full traffic.
- **Evidence:** reproduced on Postgres 16 with the original query: an Acme export returned Northwind and Sakura rows. `tenant-isolation.api-spec.ts` (GET `/usage/export` and `keyId=<B key>`) and `security.api-spec.ts` › DEF-001 fail at `25e59d2`.
- **Fix:** tenant id threaded into `exportRows`, a single query constrained by `e.tenant_id`, and `keyId` checked against the tenant (404).

### DEF-002
**Webhook URLs reach internal services (SSRF)** · Critical · Fixed

- **Root cause:** `webhooks.controller.ts` `create()` stores any string as the URL. `webhooks.service.ts` `deliver()` then `fetch`es it from inside the platform network, and `POST /webhooks/test` lets the caller trigger that on demand.
- **Preconditions:** OWNER or ADMIN of any tenant.
- **Steps:**
  1. `call owner@acme.test $ACME POST /webhooks '{"label":"x","url":"http://mock-billing:4010/_admin/reset"}'`
  2. `curl -s http://localhost:4010/charges | jq length`. Note the count; run `call billing@acme.test $ACME POST /billing/sync` first if it is 0.
  3. `call owner@acme.test $ACME POST /webhooks/test`
  4. `curl -s http://localhost:4010/charges | jq length`
- **Expected:** step 1 returns 400 (private address).
- **Actual:** 201. Step 3 makes the API POST to the billing provider's admin endpoint, and step 4 shows `0`: every charge was wiped. `http://169.254.169.254/…` (cloud metadata), `http://localhost:4000`, `file://` and `http://10.x` are all accepted too.
- **Evidence:** `security.api-spec.ts` › DEF-002 (7 URLs) fails at `25e59d2`.
- **Fix:** `webhooks/url-safety.ts` accepts only http(s) with no credentials, resolves the host and rejects private, loopback, link-local and CGNAT ranges, and is checked both at creation and at delivery (DNS rebinding). An operator allowlist (`WEBHOOK_ALLOWED_HOSTS`) keeps the local mock receiver usable.

### DEF-003
**Concurrent requests bypass the rate limit** · Critical · Fixed · SUP-1067

- **Root cause:** `gateway/rate-limit.guard.ts` (original L30–40) does `GET` the counter, compares it, then `SET counter+1`. Concurrent requests all read the same value, so the counter barely moves.
- **Preconditions:** a FREE tenant key (`ACME_KEY`, 100 rpm).
- **Steps:** `seq 300 | xargs -P 100 -I{} curl -s -o /dev/null -w '%{http_code}\n' $API/gw/ping -H "x-api-key: $ACME_KEY" | sort | uniq -c`
- **Expected:** 100 × `200`, 200 × `429`.
- **Actual:** nearly all `200`.
- **Evidence:** replaying the guard's exact GET/SET sequence against Redis 7 gave **300 of 300 allowed, with the counter ending at 1**. `gateway.api-spec.ts` › DEF-003 (250 concurrent) fails at `25e59d2`. This is the main cause of SUP-1067: "appears to work when tested by hand" because sequential manual testing never races.
- **Fix:** `gateway/rate-limiter.service.ts` is a single Lua script (ZREMRANGEBYSCORE/ZCARD/ZADD), so check-and-record is atomic.

### DEF-004
**Role escalation; last OWNER can be removed** · Critical · Fixed

- **Root cause:** `memberships.controller.ts` checks only that the actor is OWNER/ADMIN. There is no rank comparison (`rbac.ts` `atLeast()` exists but is unused) and no last-owner check, and `invite` upserts with `ON CONFLICT DO UPDATE SET role`.
- **Preconditions:** seeded Acme.
- **Steps:**
  1. `ID=$(call admin@acme.test $ACME GET /memberships | jq -r '.[] | select(.email=="admin@acme.test") .id')`
  2. `status admin@acme.test $ACME PATCH /memberships/$ID '{"role":"OWNER"}'`. Re-seed before the next steps to restore roles.
  3. `status admin@acme.test $ACME POST /memberships/invite '{"email":"owner@acme.test","role":"VIEWER"}'`
  4. Re-seed, then `OID=$(call owner@acme.test $ACME GET /memberships | jq -r '.[] | select(.email=="owner@acme.test") .id')` and `status owner@acme.test $ACME PATCH /memberships/$OID '{"role":"ADMIN"}'`
- **Expected:** 403, 403 (or 409), 409. rbac-matrix: "A member may not be granted a role higher than the role held by the actor. An OWNER may not remove or demote the last remaining OWNER."
- **Actual:** 200 (the ADMIN is now OWNER), 201 (the OWNER is silently demoted to VIEWER), 200 (the tenant has no owner).
- **Evidence:** `security.api-spec.ts` › DEF-004 (7 tests, including two owners demoting each other concurrently) fails at `25e59d2`.
- **Fix:** `canGrantRole`/`canManageMember` rank checks; last-owner checks inside a transaction that locks the tenant's OWNER rows (`ORDER BY id FOR UPDATE`, so it cannot be raced); invite returns 409 for existing members.

## High

### DEF-005
**Revoked keys keep working for up to 60 s** · High · Fixed · SUP-1051

- **Root cause:** `gateway/api-key.service.ts` caches resolved keys in an in-process `Map` for 60 s (`CACHE_TTL_MS`), and revocation never invalidates it. Each API replica has its own copy.
- **Steps:** `curl $API/gw/ping -H "x-api-key: $ACME_KEY"` (200, now cached). Revoke it: `KID=$(call owner@acme.test $ACME GET /keys | jq -r --arg p "${ACME_KEY%%.*}" '.[] | select(.prefix==$p) .id')` and `status owner@acme.test $ACME DELETE /keys/$KID`. Then run `for i in $(seq 70); do curl -s -o /dev/null -w '%{http_code} ' $API/gw/ping -H "x-api-key: $ACME_KEY"; sleep 1; done`
- **Expected:** 401 from the first request after revocation.
- **Actual:** 200 for up to 60 s, then 401. This exactly matches SUP-1051: "traffic stopped on its own".
- **Evidence:** `gateway.api-spec.ts` › DEF-005 (same replica, and across two app instances) fails at `25e59d2`.
- **Fix:** the cache lives in Redis, keyed by prefix, and is deleted on revoke and rotate. Tenant state (plan, override, suspension) is read live.

### DEF-006
**Billing sync can charge the same overage twice** · High · Fixed

- **Root cause:** `billing.service.ts` `syncToProvider()` sends no `Idempotency-Key` (the provider supports one) and takes no lock. Two concurrent syncs both read `provider_ref IS NULL`. A timeout after the provider accepted a charge leads to a second charge on retry. A network error throws mid-loop with some charges already sent.
- **Steps:** create a billing event for a closed month (e.g. `INSERT INTO billing_events (tenant_id, period, overage_requests, amount) VALUES ('<ACME>', '2025-11', 500, 1)`), then send two syncs at once: `for u in owner billing; do call $u@acme.test $ACME POST /billing/sync & done; wait`. Then `curl -s localhost:4010/charges | jq '[.[] | select(.tenantId=="'$ACME'")] | length'`
- **Expected:** 1 charge. **Actual:** 2.
- **Evidence:** `billing-usage.api-spec.ts` › DEF-006 fails at `25e59d2`.
- **Fix:** `Idempotency-Key: meridian-billing-event-<id>`, a 10 s timeout, and per-event error handling. The integration test "a sync after a failed attempt charges exactly once" covers the retry path.

### DEF-007
**Syncing the open month loses later overage** · High · Fixed

- **Root cause:** sync pushes every unsynced row, including the current month. `recordOverage()` keeps updating that row's totals afterwards, but sync skips rows that already have a `provider_ref`, so anything after the first sync is never charged.
- **Steps:** with Acme over quota this month (10k+ requests), sync, send 500 more requests, sync again. Compare `GET /billing/events` with `GET localhost:4010/charges`.
- **Expected:** a month is charged once, after it closes, for its final amount. **Actual:** the provider holds the amount from the first sync, and the later overage is lost revenue.
- **Evidence:** `billing-usage.api-spec.ts` › DEF-007 fails at `25e59d2`.
- **Fix:** sync only processes `period < currentPeriod()`.

### DEF-008
**VIEWER can read billing data** · High · Fixed

- **Root cause:** `billing.controller.ts` L14 and L26 list `VIEWER` in `@Roles`. The rbac-matrix says ❌ for both "View billing events" and "View invoice preview".
- **Steps:** `status viewer@acme.test $ACME GET /billing/invoice-preview` and `status viewer@acme.test $ACME GET /billing/events`
- **Expected:** 403. **Actual:** 200 with plan, usage and amount.
- **Evidence:** `authorization-matrix.api-spec.ts` (2 cells) and `security.api-spec.ts` › DEF-008 fail at `25e59d2`.

### DEF-009
**Refresh token still works after logout** · High · Fixed

- **Root cause:** `auth.service.ts` `refresh()` (original L52–55) does not check `revoked_at`, which `logout()` sets.
- **Steps:** `R=$(login member@acme.test | jq -r .refreshToken)`; `curl -X POST $API/auth/logout -d "{\"refreshToken\":\"$R\"}" -H 'Content-Type: application/json'`; `curl -X POST $API/auth/refresh -d "{\"refreshToken\":\"$R\"}" -H 'Content-Type: application/json'`
- **Expected:** 401. **Actual:** 201 with a new access token, for 7 days. Logout does not end the session, which matters when a stolen token or a shared machine is involved.
- **Evidence:** `security.api-spec.ts` › DEF-009 fails at `25e59d2`.

### DEF-010
**Webhook retries cannot be de-duplicated** · High · Open · SUP-1071

- **Root cause:** `webhooks.service.ts` `deliver()` calls `randomUUID()` for the event id **on every attempt** (L36), and the timeout is 3 s (L6). A slow receiver processes the request but answers after the timeout, so Meridian retries with a new id. Receivers cannot de-duplicate, which explains "more often when their endpoint is slow".
- **Steps:** create an endpoint `http://mock-billing:4010/_webhook/demo?delayMs=3500`, call `POST /webhooks/test`, then `curl localhost:4010/_webhook/received?channel=demo | jq '[.[].id] | unique | length'`
- **Expected:** 1 (one event id across attempts). **Actual:** 3.
- **Evidence:** `billing-usage.api-spec.ts` › DEF-010 (`it.failing`).
- **Why not fixed:** this is not a release blocker, since customers can work around it with a longer receiver timeout or by de-duplicating on content. A correct fix also changes the delivery model: the id should be generated once per dispatch, with a timestamp in the signature against replay and asynchronous retries rather than in the request path. Recommended for the next release.

### DEF-011
**Rate limit is per key, not per tenant** · High · Fixed · SUP-1067

- **Root cause:** bucket `rl:<prefix>:<window>` (original guard L28). The plans define limits per tenant ("per-plan rate limits"; A1 "custom requests-per-minute limit for their tenant").
- **Steps:** create 3 Acme keys and send 60 requests per key in one minute.
- **Expected:** 100 allowed in total. **Actual:** 180 allowed (300 with 5 keys).
- **Evidence:** `gateway.api-spec.ts` › DEF-011 fails at `25e59d2`. Together with DEF-003 this explains SUP-1067. The FREE tenant in that ticket very likely used several keys or concurrent workers.

### DEF-012
**Usage days ignore the tenant timezone** · High · Open · SUP-1058

- **Root cause:** `usage.service.ts` `daily()` groups by `date_trunc('day', created_at)` in the database session timezone (UTC). `tenants.timezone` is never used. The same applies to `usage_daily` (`meter.service.ts` L35), the quota month and the billing period.
- **Steps:** for Sakura (Asia/Tokyo), insert usage at `2026-10-01T08:30:00+09:00` and call `GET /usage/daily?from=2026-09-28T00:00:00Z&to=2026-10-04T00:00:00Z`.
- **Expected:** counted on 2026-10-01. **Actual:** counted on 2026-09-30.
- **Evidence:** reproduced on Postgres 16 with the original query: 5 events reported on 2026-09-30, and `AT TIME ZONE 'Asia/Tokyo'` gives 2026-10-01. Test: `billing-usage.api-spec.ts` › DEF-012 (`it.failing`). For Tokyo, everything between 00:00 and 09:00 JST falls on the previous day, which is "small but consistent" and most visible on the 1st of the month.
- **Why not fixed:** the fix touches reporting, `usage_daily`, quota and billing-period boundaries together, and needs a product decision on whether a billing month follows the tenant's timezone. It is a reporting error, not a security or money-direction error for most tenants.

### DEF-013
**Dashboard shows usage dates one day early west of UTC** · High · Open

- **Root cause:** the API serialises a `DATE` as UTC midnight (`2026-10-01T00:00:00.000Z`), and `usage/page.tsx` renders it with `new Date(d.day).toLocaleDateString()` in the browser's timezone.
- **Steps:** set the OS/browser timezone to America/New_York and open Usage.
- **Expected:** 10/1/2026. **Actual:** 9/30/2026. Every row is shifted.
- **Evidence:** verified in Node with `TZ=America/New_York`. Test: `e2e/tests/known-defects.spec.ts` › DEF-013 (`test.fail`, Playwright `timezoneId`). Northwind (New York) sees this on top of DEF-012.

### DEF-014
**Usage page does not scale with keys/volume** · High · Fixed · SUP-1062

- **Root cause:** (1) `usage.service.ts` `summary()` runs one `COUNT` per key (N+1). (2) `usage_events` has no index except its primary key, so every query is a sequential scan. (3) `meter.service.ts` `quotaRemaining()` runs a full-month `COUNT(*)` on **every gateway request**, competing for the same 20-connection pool.
- **Steps:** `npm run seed:large` (540k events, 26 Northwind keys), put load on the gateway, then open Usage as owner@northwind.
- **Expected:** loads in about 1 s. **Actual:** times out once the pipeline's traffic is running ("started after they onboarded their analytics pipeline").
- **Evidence:** `EXPLAIN ANALYZE` on 540,806 rows: each per-key query is a parallel sequential scan (29 ms, so 26 keys take about 0.8 s on an idle local database), and the per-request quota count is a sequential scan of 63 ms. With a `(api_key_id, created_at)` index the per-key query takes 13 ms. Test: `billing-usage.api-spec.ts` › DEF-014 checks the query count (1 key vs 12 keys) and the indexes. That makes it deterministic rather than timing-based, and it fails at `25e59d2`.
- **Fix:** one grouped query, plus `db/003_usage_indexes.sql`. **Still open:** the per-request quota `COUNT(*)` should come from `usage_daily` or a Redis counter. It is now an index range scan, but it still grows with monthly volume.

### DEF-033
**Overage billed while the dashboard shows the tenant under quota** · High · Open · SUP-1043

- **Root cause (three contributing causes):**
  1. `meter.service.ts` `recordOverage()` writes `billing_events` incrementally with the plan at the time of the request, and nothing recalculates it. After a plan change, `GET /billing/events` keeps showing the old overage while `invoice-preview` (which recalculates with the current plan) shows none.
  2. Before the DEF-005 fix, the plan was cached with the key for 60 s, so traffic right after an upgrade was metered against the old quota.
  3. The Overview shows "Requests (30d)" against the **monthly** quota, and the Usage page shows the last 30 days, while billing uses the calendar month (UTC). A customer comparing the two sees different numbers even when both are correct.
- **Steps (cause 1):** take a FREE tenant to 10,000 requests this month, send one more (a billing event with overage 1 is written), set the plan to GROWTH, then compare `GET /billing/events` with `GET /billing/invoice-preview`.
- **Expected:** consistent overage. **Actual:** events show 1, preview shows 0. With a closed month, sync would charge it.
- **Evidence:** `billing-usage.api-spec.ts` › DEF-033 (`it.failing`). I could not confirm which cause hit Northwind without their plan-change history: **question for Success:** did Northwind change plan in the billed month, and which period was the screenshot of?
- **Why not fixed:** the right answer for a mid-month plan change (prorate, bill the plan at month end, or the plan at the time of each request) is a billing-policy decision. Closed-period-only sync (DEF-007) already means nothing is charged before month end, which gives time to recalculate.

## Medium

### DEF-015
**Invited accounts get a password the inviter knows** · Medium · Open
`memberships.controller.ts` creates unknown emails with `ChangeMe123!` or with a password the inviter supplies. The inviter can sign in as the invitee, including in tenants the invitee joins later. **Steps:** invite `x@new.test`, then log in as them with `ChangeMe123!` → 201. **Expected:** 401 until the invitee sets their own password. **Test:** `security.api-spec.ts` › DEF-015 (`it.failing`). **Not fixed:** it needs an invite-acceptance flow (email plus a set-password token), which is product work.

### DEF-016
**Failed gateway requests are not metered; bad input is a 500** · Medium · Open
`gateway.controller.ts` records only successful requests, always with status 200, and measures latency before any work (about 0 ms). `POST /gw/transform {"text":123}` throws a `TypeError` and returns 500, and it is not metered. As a result the Usage "Errors" column is always 0 for real traffic. **Expected:** 400, and a usage event with status 400. **Test:** `gateway.api-spec.ts` › DEF-016 (`it.failing`).

### DEF-017
**Money stored and computed as binary floating point** · Medium · Open
`billing_events.amount` is `DOUBLE PRECISION` and amounts are `n * rate` in JS. 9 overage requests on FREE give `0.018000000000000002`, and the Billing page prints `$0.018000000000000002`. **Expected:** exact decimal (integer micro-units or `NUMERIC`). **Tests:** `plans.spec.ts`, and `billing-usage.api-spec.ts` › DEF-017 (`it.failing`). **Not fixed:** needs a schema migration and a currency-rounding policy.

### DEF-018
**CSV export is not escaped** · Medium · Open
`usage.service.ts` `toCsv()` joins fields with `,`. A key named `Ops, EU` shifts columns, and a key named `=HYPERLINK(...)` is executed by Excel (formula injection, and any MEMBER can name keys). **Expected:** RFC 4180 quoting, and a `'` prefix on cells starting with `= + - @`. **Tests:** `usage.service.spec.ts`, and `billing-usage.api-spec.ts` › DEF-018 (`it.failing`).

### DEF-019
**Malformed ids return 500** · Medium · Open
A non-UUID `x-tenant-id`, or `:id` on `/webhooks/:id`, reaches Postgres and fails the uuid cast, which is returned as 500 (this also fills error alerting). Keys, memberships and rotate now use `ParseUUIDPipe` (400). **Tests:** `gateway.api-spec.ts` › DEF-019 (`it.failing`).

### DEF-020
**Overage total is last-write-wins under concurrency** · Medium · Open
`MeterService.record()` reads the quota count *before* inserting the event, then `recordOverage()` overwrites `overage_requests` with that value. Concurrent requests near or over quota can write a lower total after a higher one, so the stored overage is understated. **Repro:** a FREE tenant at 9,990 events, then 50 parallel `/gw/ping` calls; compare `billing_events.overage_requests` with `COUNT(*) - 10000`. **No automated test:** the outcome depends on scheduling, so a test would be flaky, and a flaky `it.failing` is worse than none. **Mitigation:** with closed-period sync, the amount should be recomputed from `usage_events` at sync time. That is part of the DEF-033 policy work.

### DEF-021
**Switching tenant keeps showing the previous tenant's data** · Medium · Open
`dashboard/layout.tsx` calls `router.refresh()`, which does not re-run the pages' client-side `useEffect` fetches. The page keeps tenant A's keys under tenant B's name until you navigate away. **Test:** `e2e/tests/known-defects.spec.ts` › DEF-021 (`test.fail`).

### DEF-022
**Dashboard never refreshes its access token** · Medium · Open
The access token lasts 15 min (`ACCESS_TOKEN_TTL=900`) and `lib/api.ts` never calls `/auth/refresh` or redirects on 401, so after 15 idle minutes every page shows "Invalid token". **No automated test:** it needs either a 15-minute wait or a configurable TTL in the web build. Recommended next step: make the TTL configurable for tests.

### DEF-023
**Privileged actions missing from the audit log** · Medium · Open
Webhook deletion writes no audit entry, and `tenant.updated` logs the raw request body without previous values. **Tests:** `security.api-spec.ts` › DEF-023 (`it.failing`). (Role changes now record the previous role, as part of the DEF-004 fix.)

### DEF-024
**Tenant settings not validated** · Medium · Open
`PATCH /tenant` accepts `timezone: "Mars/Base"`, an empty name, and arbitrary fields, which are copied into audit metadata. An invalid timezone would break any timezone-aware fix for DEF-012. **Test:** `billing-usage.api-spec.ts` › DEF-024 (`it.failing`).

### DEF-025
**CORS reflects any origin with credentials** · Medium · Open
`main.ts` uses `enableCors({ origin: true, credentials: true })`. Tokens are bearer tokens in `localStorage`, not cookies, so this is not directly exploitable today, but it removes a layer of defence. The dashboard now calls the API through its own origin, so an allowlist costs nothing. **Test:** `security.api-spec.ts` › DEF-025 (`it.failing`).

### DEF-026
**Login has no throttling and leaks registered emails by timing** · Medium · Open
bcrypt runs only when the email exists (about 70 ms vs about 1 ms), and nothing limits attempts. **No automated test:** timing assertions are flaky on shared CI runners. Manual repro: `for e in owner@acme.test nobody@x.test; do for i in $(seq 20); do curl -o /dev/null -s -w '%{time_total}\n' -X POST $API/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$e\",\"password\":\"x\"}"; done | sort -n | sed -n 10p; done`

### DEF-027
**Unbounded in-process key cache** · Medium · Fixed
Original `ApiKeyService.cache` was a `Map` with no eviction that also stored misses, so a flood of random `x-api-key` values grew memory without limit. Fixed as part of DEF-005: entries live in Redis with a TTL (5 s for misses). **Test:** `key-cache.int-spec.ts`.

### DEF-028
**Suspended tenants consume rate-limit budget** · Medium · Fixed
The suspension check ran in each handler, after the guard had counted the request, so a suspended tenant's 101st request returned 429 instead of 403. **Test:** `gateway.api-spec.ts` › DEF-028 fails at `25e59d2`. (Nothing sets `suspended` yet, as the README notes.)

## Low

### DEF-029
**Fixed window allows 2x the limit across a boundary** · Low · Fixed · SUP-1067
100 requests at :59 and 100 at :00 are all admitted. Fixed by the sliding log. **Tests:** `gateway.api-spec.ts` › DEF-029 (real wall clock, waits for a minute boundary), and `rate-limiter.int-spec.ts` (injected clock, deterministic).

### DEF-030
**Mock provider lists idempotent charges twice** · Low · Fixed
`mock-billing/server.js` stores each charge under both its id and its Idempotency-Key, and `GET /charges` returned both entries. Any assertion that counts charges was wrong. Fixed in the harness commit (`25e59d2`) because the tests depend on it.

### DEF-031
**Members page offers role changes to roles that cannot make them** · Low · Open
Every role sees editable role dropdowns, and errors appear only after the API refuses. There is also no "remove member" action although the API supports it. Not automated: this is a UX issue with no data impact.

### DEF-032
**Seed script comment disagrees with README** · Low · Open
`scripts/seed.js` says "~250k events", while the README and the actual volume are about 540k. Documentation only.
