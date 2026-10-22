# Submission: QA Developer technical assessment

**Run it:** `docker compose up -d --build --wait && docker compose --profile test run --rm tests`
**CI:** [![CI](https://github.com/ranuvina/meridian-qa/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ranuvina/meridian-qa/actions/workflows/ci.yml?query=branch%3Amain) · green run on the fixed code: [run 39732895757](https://github.com/ranuvina/meridian-qa/actions/runs/39732895757) · the same suite failing on the original code: [run 39732899815](https://github.com/ranuvina/meridian-qa/actions/runs/39732899815)
**Defect reports:** [`DEFECTS.md`](DEFECTS.md) · **How to run each layer:** [`README.md#tests`](README.md#tests)

Commit history is part of the evidence:

| Commit | What it shows |
|---|---|
| `de0be40` | Repository as provided |
| `25e59d2` | Test harness, CI and regression tests, **with no fixes**. The defect tests fail here, which proves each reported defect is real. |
| `09e5651` | Release-blocking fixes, A1 and A2. The same tests now pass. |
| `2b5e462` | Documentation |
| later | Fixes found by the first CI runs (see section 7) and CI reporting improvements |

Branch [`evidence/pre-fix-regressions`](https://github.com/ranuvina/meridian-qa/tree/evidence/pre-fix-regressions) is `25e59d2` plus only the current CI files. Its run ([39732899815](https://github.com/ranuvina/meridian-qa/actions/runs/39732899815)) shows **46 API tests and 2 E2E journeys failing** on the original code, among them the tests for fixed defects DEF-001, 002, 003, 004, 005, 006, 007, 008, 009, 011 and 029. The failing tests are listed in the run's annotations.

---

## 1. Test strategy and the risks it covers

Meridian's risk is concentrated in four places, and the suite is weighted the same way:

| Risk | Why it matters | Where it is tested |
|---|---|---|
| **Tenant isolation and authorisation** | One leak ends trust in a multi-tenant product | API layer: a matrix generated from `docs/rbac-matrix.md` (18 capabilities plus 2 from the specs, x 5 roles, every endpoint), and a sweep of every endpoint as an outsider, an unauthenticated caller and with an expired token. The isolation sweep fills tenant B with marked data and proves that no read endpoint returns it and no id-taking endpoint touches it. |
| **Rate limiting and metering under concurrency** | It fails silently in production but looks fine when tested by hand (SUP-1067) | Integration tests against real Redis with an **injected clock**: exact admission under 600-way bursts, repeated 20 times; window boundaries; sustained rate; Retry-After. HTTP-level burst tests through the gateway. One real-wall-clock boundary test. |
| **Money** | Over-charging and under-charging both cost money and trust | Unit tests of the overage arithmetic; integration tests of provider calls (payload, Idempotency-Key, retry after failure charges once); concurrent sync; open-period handling. |
| **Key and session lifecycle** | Revocation, rotation and logout must take effect immediately | Cache-boundary integration tests (what is cached, for how long, what invalidates it), a cross-replica revocation test using two app instances, the grace-period expiry boundary, and refresh after logout. |

**Design choices**

- **Real dependencies, in-process app.** Jest boots the actual Nest `AppModule` (same `configureApp()` as production) against real Postgres 16, Redis 7 and the mock provider. Nothing below HTTP is mocked, so guards, SQL, transactions and Lua scripts are what is tested. In-process rather than against the API container means coverage is measured, and services can be reached directly for white-box checks (query counting, the injected clock).
- **Independent, parallel-safe data.** Factories create every tenant, user and key with random ids, straight into Postgres, so setup never depends on the endpoints under test. Nothing is truncated or reset, files run in parallel and in any order, and the mock receiver has per-test channels. Global state is never changed mid-run. The one test that changes a process env var restores it, and it is in a file of its own.
- **Deterministic over timing-based.** Where a timing assertion would be flaky I test the mechanism instead. Examples: SUP-1062 is tested by counting queries for 1 key vs 12 keys plus checking the indexes, not by measuring latency. Window boundaries use an injected clock. Audit ordering under concurrency follows previous->new links, because `created_at` is the transaction *start* time and does not show commit order.
- **The spec is the oracle.** The authorisation matrix parses `docs/rbac-matrix.md` at runtime. If the document or the code changes, the tests follow the document, which the matrix itself says is correct.
- **One command, same as CI.** `tests.Dockerfile` contains Node, Playwright and all dependencies. CI runs exactly the documented two commands, so "works on my machine" and "works in CI" are the same claim.
- **Known defects are tests too.** Open defects are `it.failing` / `test.fail`: each asserts the correct behaviour, the suite stays green, and the test turns red when someone changes the behaviour. That prompts removing the marker in the fix PR.

**Layers**

| Layer | Count | Notes |
|---|---|---|
| Unit | 116 | Pure logic: plan limits and ceilings, RBAC rank rules, scope and grace parsing, URL safety (IPv4/IPv6/mapped), usage aggregation, CSV, billing arithmetic |
| Integration | 30 | Limiter, key cache, transactions (rollback forced with a per-tenant failing trigger, so parallel tests are unaffected), provider and webhooks |
| API | 339 | Authorisation matrix, tenant isolation, A1, A2, defect regressions |
| E2E | 8 | Sign-in, key lifecycle UI -> gateway -> revoke, invite, usage plus CSV download, billing view, two known UI defects |
| Coverage (API) | 98.5 % lines | Statements 96.5 %, branches 72.8 %, functions 94.7 %, lines 98.5 %. Thresholds enforced in `jest.config.js`: 85 / 70 / 85 / 85. The pre-fix run also fails the branch threshold (64.8 %) |

## 2. What I prioritised, what I dropped, and why

**Prioritised:**

1. **Defect discovery first.** Reading every source file against the specs found the critical defects (tenant leak, SSRF, escalation, a limiter that fails open) before any test was written, and the suite was then aimed at them.
2. **Proving each defect before fixing it.** The regression tests were committed against unmodified code (`25e59d2`), so the failing CI run *is* the evidence and each fix has a test that turns green.
3. **Optional depth: rate limiter under concurrency and at window boundaries** (chosen over breadth, as the brief advises). It is where the most dangerous defect lived, and it is the core of A1.
4. **Fixing only release blockers** (Critical, plus High defects that are cheap and unambiguous to fix). Not fixed: anything that needs a product decision (DEF-033 proration, DEF-012 billing timezone) or a new flow (DEF-015 invite acceptance).

**Dropped:**

- Other optional areas (accessibility, browser matrix, mutation testing, contract testing, k6 load thresholds). Depth in one beats presence in six. The tenant-isolation sweep is part of the required API layer anyway.
- Dashboard UI for A1/A2 (an override form, scope checkboxes, a rotate button). The specs define API behaviour. The UI already shows the effective limit.
- Lockfiles. My build environment could not reach npm, so the first install happened in CI. Committing `package-lock.json` from a green CI run is the first follow-up.

## 3. What I chose not to automate, and why

| Item | Reason | Instead |
|---|---|---|
| DEF-020 overage race | The outcome depends on scheduling, and a flaky `it.failing` is worse than none | Manual repro in DEFECTS.md. Recommended fix: recompute at sync |
| DEF-022 token expiry in the UI | Needs a 15-minute wait, or a configurable TTL in the web build | Make the TTL configurable, then automate |
| DEF-026 login timing | Timing assertions on shared CI runners are noise | Manual repro script in DEFECTS.md |
| DEF-031 UI role dropdowns, DEF-032 docs | No behavioural impact worth a test | Report only |
| Performance thresholds | Not chosen as an optional area. SUP-1062 is covered structurally (query count, indexes) | k6 against `seed:large` is the next step |
| Seed script, mock provider internals | Test infrastructure | Exercised indirectly |

## 4. Part A: decisions I made where the specs were silent

| # | Question | Decision | Why |
|---|---|---|---|
| A1-1 | Override below the plan default (undecided by Product) | **Rejected (400)**, behind one flag: `ALLOW_OVERRIDE_BELOW_PLAN_DEFAULT` in `plans.ts` | It is easier to relax a rule later than to take one back. An abusive tenant would not lower its own limit through an OWNER-only endpoint, so the stated use case needs an operator tool anyway. |
| A1-2 | Downgrade leaves the override above the new ceiling | **Keep the stored value, enforce `min(override, ceiling)`** | Meets both "survives a plan change" and "may not exceed the ceiling". An upgrade back restores it without anyone re-entering it. GET /tenant shows `override`, `ceiling` and `effective`. |
| A1-3 | Ceiling inclusive? | Yes (FREE 500 is allowed) | "May not exceed" |
| A1-4 | ADMIN? | No, OWNER only (403) | Spec says "An OWNER". Listed in the matrix test as a feature capability |
| A1-5 | Per tenant or per key? | Per tenant, across all keys | Spec says "for their tenant". Required fixing DEF-011 |
| A1-6 | DELETE with no override / unchanged PATCH | 200, idempotent, **no audit entry** when nothing changed | The audit log records changes |
| A1-7 | "Takes effect on the next request" | Tenant state is read live per request (one primary-key lookup), not cached | A cache would break the requirement. Required fixing DEF-005 |
| A1-8 | Audit atomicity | Update and audit entry in one transaction with `FOR UPDATE` | "previous" is exact under concurrency. Tested with a forced audit failure |
| A2-1 | Existing keys | Column default `{read,write}` | "Existing keys must continue to work" |
| A2-2 | `scopes` omitted on create | Full access | Backwards compatible for current API clients and the UI |
| A2-3 | Invalid scopes | `[]`, unknown or wrong-case values, non-array -> 400. Duplicates are de-duplicated | Strict input |
| A2-4 | Who may create which scopes | Unchanged: OWNER/ADMIN/MEMBER may create any scope | The matrix grants MEMBER key creation without limits. Flagged as a question |
| A2-5 | Methods other than GET/POST | Need both scopes | Fail closed if routes are added |
| A2-6 | Out-of-scope request: rate limit / metering | Checked **before** the rate limit; **does not** consume budget and **is not** metered | A misconfigured key should not exhaust the tenant's limit |
| A2-7 | Same prefix after rotation? | Yes: same id and prefix, new secret | Usage, rate limit and quota continue ("must not reset") |
| A2-8 | Rotating again during a grace period | One previous secret at a time; the earlier one stops immediately | Bounded, predictable. Two concurrent rotations are serialised by a row lock |
| A2-9 | Grace input | Integer 0..86400, else 400 (not clamped) | Explicit errors beat silent clamping |
| A2-10 | Revoked key / revoke during grace | 409 / both secrets stop | "A revoked key cannot be rotated" |
| A2-11 | Response code | 201 with the new secret (shown once) | Matches key creation |

Questions I would send to Product: A1-1, A2-4, and whether rotation should be possible from the dashboard.

## 5. Defect summary

Full reports: [`DEFECTS.md`](DEFECTS.md).

| ID | Severity | Status | Ticket | Title |
|---|---|---|---|---|
| DEF-001 | Critical | Fixed | | Usage CSV export returns every tenant's traffic |
| DEF-002 | Critical | Fixed | | Webhook URLs reach internal services (SSRF) |
| DEF-003 | Critical | Fixed | SUP-1067 | Concurrent requests bypass the rate limit |
| DEF-004 | Critical | Fixed | | Role escalation; last OWNER can be removed |
| DEF-005 | High | Fixed | SUP-1051 | Revoked keys keep working for up to 60 s |
| DEF-006 | High | Fixed | | Billing sync can charge twice |
| DEF-007 | High | Fixed | | Syncing the open month loses later overage |
| DEF-008 | High | Fixed | | VIEWER can read billing data |
| DEF-009 | High | Fixed | | Refresh token works after logout |
| DEF-010 | High | Open | SUP-1071 | Webhook retries cannot be de-duplicated |
| DEF-011 | High | Fixed | SUP-1067 | Rate limit per key, not per tenant |
| DEF-012 | High | Open | SUP-1058 | Usage days ignore the tenant timezone |
| DEF-013 | High | Open | | Dashboard dates one day early west of UTC |
| DEF-014 | High | Fixed | SUP-1062 | Usage page does not scale |
| DEF-033 | High | Open | SUP-1043 | Overage billed while the dashboard shows under quota |
| DEF-015 | Medium | Open | | Invited accounts get a known password |
| DEF-016 | Medium | Open | | Failed gateway requests not metered; bad input is a 500 |
| DEF-017 | Medium | Open | | Money as binary floating point |
| DEF-018 | Medium | Open | | CSV not escaped (formula injection) |
| DEF-019 | Medium | Open | | Malformed ids return 500 |
| DEF-020 | Medium | Open | | Overage last-write-wins under concurrency |
| DEF-021 | Medium | Open | | Tenant switch keeps the previous tenant's data |
| DEF-022 | Medium | Open | | Dashboard never refreshes its access token |
| DEF-023 | Medium | Open | | Actions missing from the audit log |
| DEF-024 | Medium | Open | | Tenant settings not validated |
| DEF-025 | Medium | Open | | CORS reflects any origin |
| DEF-026 | Medium | Open | | Login unthrottled; email enumeration by timing |
| DEF-027 | Medium | Fixed | | Unbounded in-process key cache |
| DEF-028 | Medium | Fixed | | Suspended tenants consume rate limit |
| DEF-029 | Low | Fixed | SUP-1067 | Fixed window allows 2x at a boundary |
| DEF-030 | Low | Fixed | | Mock provider lists charges twice |
| DEF-031 | Low | Open | | Role dropdowns shown to every role |
| DEF-032 | Low | Open | | Seed comment vs README |

**33 defects:** 4 Critical, 11 High, 14 Medium, 4 Low. **15 fixed** (all Critical; the High ones that were cheap and unambiguous), 18 open with regression tests or documented manual repros.

## 6. Release recommendation

**The build as provided: do not release.** It leaks every tenant's usage to any user (DEF-001), lets an ADMIN take over a tenant (DEF-004), lets any OWNER/ADMIN make the platform call internal services (DEF-002), and its rate limiter does not limit under concurrent load (DEF-003).

**This branch: release, with conditions.**

Conditions:
1. CI green from a clean clone (linked above), including the full authorisation and isolation sweeps.
2. Deploy `db/002` and `db/003` before the new API version. Both are additive; `003` builds indexes on `usage_events`, so on production volume use `CREATE INDEX CONCURRENTLY`.
3. Set `WEBHOOK_ALLOWED_HOSTS` deliberately per environment (empty in production).
4. Existing webhook endpoints pointing at private addresses stop receiving deliveries. Notify affected tenants.
5. Support briefed on the open customer-facing items (DEF-012/013 dates, DEF-033 billing after plan changes, DEF-010 webhook duplicates), with workarounds.

**Accepted risks (open, with owners and tests):**

| Risk | Why acceptable for now | Mitigation |
|---|---|---|
| DEF-033 / DEF-020 overage accuracy | No charge leaves before month end (DEF-007 fix) | Billing policy decision plus recompute-at-close before the next month closes |
| DEF-012 / DEF-013 day boundaries | Reporting only; totals are correct | Fix together with the billing-timezone decision |
| DEF-010 webhook duplicates | Customers can de-duplicate on content | Next release: stable event id, async retries |
| DEF-015 invite password | Requires inviter intent; no self-signup exists | Invite-acceptance flow |
| DEF-017 float money | Errors below a cent per event | `NUMERIC` / integer micro-units migration |
| Per-request quota `COUNT(*)` | Now an index range scan | Move to `usage_daily` or a Redis counter |

## 7. AI usage disclosure

**Tool:** Claude (Anthropic), used as an agent with file, shell and Git access, in a sandbox that had Docker, Postgres and Redis but **no access to the npm registry**. Nothing could be installed locally, so GitHub Actions was the first place the suite ran. GitHub's log download was also unreachable from the sandbox, so CI writes its results as run annotations ("Result digest" step), which also makes them readable for a reviewer without opening logs.

**Used for:**

- Reading the codebase against the specs and drafting the defect list.
- Proving defects outside the app: running the original SQL on Postgres 16 (timezone bucketing, export leak, `EXPLAIN ANALYZE` at 540k rows), and replaying the limiter's GET/SET against Redis 7 (300/300 allowed).
- Writing the harness, tests, fixes, A1/A2, CI and these documents.

**Where the output needed correcting** (found in review, before CI):

- The DEF-028 regression test originally sent requests concurrently, so DEF-003 hid the bug and the test would have *passed* on broken code. Changed to sequential.
- The factories first imported application modules and new columns, so the harness could not run against the pre-fix commit. Rewritten to depend on the schema only, and to insert optional columns only when given.
- The audit-chain concurrency test ordered entries by `created_at`. That is transaction start time, so the test would have been flaky. Changed to follow previous->new links.
- The authorisation matrix used a public webhook URL, so `POST /webhooks/test` in a shared org would have run 3 s timeouts x 3 retries x every accumulated endpoint. Switched to the mock receiver.
- An E2E selector picked the wrong `<select>` on the Members page.
- The curl helper in the first draft of DEFECTS.md used `eval` quoting that broke the headers. Replaced with `call`/`status` functions.
- **Found by the first CI runs** (each fixed in its own commit on `main`):
  - The API image did not build: `tenants.controller.ts` relied on discriminated-union narrowing (`!check.ok`), which does not work with this project's `strictNullChecks: false` (TS2339).
  - The A1 audit insert reused `$1` for a uuid column and a text column. Postgres rejects that ("inconsistent types deduced for parameter"), so **every override change failed**. The A1 tests caught it on the first run.
  - Two A2 tests expected `200` from the gateway's POST routes. Nest answers POST with `201`, so the tests were wrong, not the API.
  - `npx tsc` resolved to an unrelated npm package called `tsc`, because the repository root declares npm workspaces. The runner now calls each tool from its package's `node_modules/.bin`.

**My own review and changes:** _<candidate: what you checked, changed, or rejected>_

## 8. Time log

_<candidate to complete>_

| Date | Activity | Hours |
|---|---|---|
| | Reading the brief, codebase and specs | |
| | Defect investigation and reports | |
| | Test architecture, factories, CI | |
| | A1 / A2 implementation and tests | |
| | Fixes for release blockers | |
| | Review, CI iterations, write-up | |
| | **Total** | |
