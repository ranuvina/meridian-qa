# Meridian

Multi-tenant API usage platform. Tenants issue API keys, traffic flows through a metered
gateway with per-plan rate limiting, and usage rolls up into reports and overage billing.

## Stack

- **API** — NestJS, PostgreSQL, Redis (`apps/api`)
- **Dashboard** — Next.js (`apps/web`)
- **Billing provider** — mock third-party service (`apps/mock-billing`)

## Running

```bash
cp .env.example .env
docker compose up --build
```

Wait for the API to report healthy, then seed:

```bash
npm install
DATABASE_URL=postgres://meridian:meridian@localhost:5432/meridian npm run seed
```

`npm run seed:large` instead seeds production-scale volume against the Northwind tenant
(~540k usage events across 26 keys). Use it when testing report performance.

- Dashboard: http://localhost:3000
- API: http://localhost:4000/api/v1
- Health: http://localhost:4000/health
- Mock billing provider: http://localhost:4010

The seed script prints API key secrets. They are not recoverable afterwards.
All seeded users share the password `Password123!`.

## Seeded data

| Tenant | Plan | Timezone | Users |
|---|---|---|---|
| Acme Corp | FREE | UTC | owner@, admin@, member@, viewer@, billing@acme.test |
| Northwind Traders | GROWTH | America/New_York | owner@, admin@northwind.test |
| Sakura KK | SCALE | Asia/Tokyo | owner@sakura.test |

`member@acme.test` also holds a VIEWER role in Northwind.

## Authentication

Dashboard requests use a bearer access token plus an `x-tenant-id` header identifying the
active tenant. Gateway requests authenticate with `x-api-key` in the form `prefix.secret`.

```bash
curl -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@acme.test","password":"Password123!"}'

curl localhost:4000/api/v1/gw/ping -H "x-api-key: mk_xxxx.yyyy"
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | |
| POST | `/auth/refresh` | |
| POST | `/auth/logout` | |
| GET | `/auth/me` | |
| GET | `/tenant` | Current tenant and effective limits (`limits`, `rateLimit`) |
| PATCH | `/tenant` | |
| PATCH | `/tenant/rate-limit` | A1: set rate-limit override (OWNER) |
| DELETE | `/tenant/rate-limit` | A1: remove override (OWNER) |
| GET | `/tenant/audit-log` | |
| GET | `/memberships` | |
| POST | `/memberships/invite` | |
| PATCH | `/memberships/:id` | |
| DELETE | `/memberships/:id` | |
| GET | `/keys` | |
| POST | `/keys` | A2: optional `scopes: ["read"|"write"]` |
| POST | `/keys/:id/rotate` | A2: `{ gracePeriodSeconds }` (OWNER, ADMIN) |
| DELETE | `/keys/:id` | Revoke |
| GET | `/usage/summary` | |
| GET | `/usage/daily` | |
| GET | `/usage/export` | CSV |
| GET | `/billing/events` | |
| GET | `/billing/invoice-preview` | |
| POST | `/billing/sync` | Pushes charges to the provider |
| GET | `/webhooks` | |
| POST | `/webhooks` | |
| POST | `/webhooks/test` | |
| GET | `/webhooks/deliveries` | |
| DELETE | `/webhooks/:id` | |
| GET/POST | `/gw/ping`, `/gw/echo`, `/gw/transform` | Metered, rate limited |

## Mock billing provider

Supports `Idempotency-Key` on `POST /charges`. Failure and latency injection via the
`FAILURE_RATE` and `LATENCY_MS` environment variables in `docker-compose.yml`.
`POST /_admin/reset` clears its state.

## Docs

- `docs/rbac-matrix.md` — role and permission specification
- `docs/reported-issues.md` — open support tickets
- `docs/feature-specs/` — specifications for work in progress

## Notes

- `usage_daily` is written on every metered request but no read path currently uses it;
  the reporting endpoints aggregate `usage_events` directly.
- The gateway checks `tenants.suspended`, but nothing currently sets it.

## Tests

Everything runs in Docker. From a clean clone:

```bash
docker compose up -d --build --wait
docker compose --profile test run --rm tests
```

The second command builds a runner image (Node, Playwright and all test dependencies), then runs
typecheck, unit, integration, API and E2E tests and writes every report to `./reports`. It exits
non-zero if anything fails. CI (`.github/workflows/ci.yml`) runs exactly these two commands.

> Upgrading an existing checkout: migrations in `db/` run only when Postgres initialises,
> so run `docker compose down -v` once to pick up `db/002` and `db/003`.

### Layers

| Layer | Where | What it covers | Run on its own |
|---|---|---|---|
| Unit | `apps/api/src/**/*.spec.ts` | Plans and limits, RBAC rank rules, scope and grace parsing, URL safety, usage aggregation, billing arithmetic | `docker compose --profile test run --rm tests bash -c "cd apps/api && npm run test:unit"` |
| Integration | `apps/api/test/integration` | Real Postgres + Redis + mock provider: limiter windows (injected clock), key-cache boundaries, transaction rollback, concurrent rotations, provider and webhook calls | `... npm run test:integration` |
| API | `apps/api/test/api` | Role x endpoint x tenant matrix generated from `docs/rbac-matrix.md`, tenant-isolation sweep, A1, A2, defect regressions | `... npm run test:api` |
| E2E | `e2e/tests` | Dashboard journeys through web -> API -> DB (Playwright, Chromium) | `docker compose --profile test run --rm tests bash -c "cd e2e && npx playwright test"` |

One test by name: `... bash -c "cd apps/api && npx jest -t 'DEF-005'"`.

Running the Jest layers on the host instead (Node 22): start `postgres`, `redis` and `mock-billing`, then
`cd apps/api && npm install && BILLING_PROVIDER_URL=http://localhost:4010 npm test`. Tests use a
separate `meridian_test` database that is recreated on every run.

### Reports (`./reports`)

| Output | Format |
|---|---|
| `junit/api.xml`, `junit/e2e.xml` | JUnit XML (machine-readable) |
| `summary.json`, `summary.md` | Totals per suite plus coverage |
| `coverage/` | lcov, cobertura, `coverage-summary.json`; thresholds enforced in `apps/api/jest.config.js` |
| `playwright-report/` | HTML report (`npx playwright show-report reports/playwright-report`) |
| `playwright-results/` | Traces, screenshots and video for failed E2E tests |

### Conventions

- **Test data** comes from `apps/api/test/support/factories.ts` (and `e2e/tests/fixtures.ts`). Every test
  creates its own tenant, users and keys with random identifiers. Nothing is truncated, so files run in
  parallel and in any order.
- **Nothing is mocked** below the HTTP boundary: Jest boots the real Nest app in-process against real
  Postgres and Redis and the mock billing provider. The mock receiver supports per-test channels
  (`/_webhook/<channel>`) and per-request `?delayMs=` / `?status=`.
- **Known defects** are kept as regression tests marked `it.failing` / `test.fail`. They assert the
  correct behaviour and turn red as soon as the behaviour changes. Remove the marker in the fix.
  See `DEFECTS.md`.
