import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { MemberRole } from '../../src/common/rbac';
import type { PlanTier } from '../../src/common/plans';

/**
 * Test-data layer. Everything is created with random identifiers and never cleaned up by
 * truncation, so tests are independent, order-agnostic and safe to run in parallel.
 * Factories write straight to Postgres: setup should be fast and must not depend on the
 * endpoints under test.
 */

// Factories only depend on the schema, never on application modules, so the same harness runs
// against the original code (to prove regressions fail) and the fixed code.
const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');

/** INSERT that only names the optional columns actually provided (older schemas lack some). */
async function insertRow(table: string, values: Record<string, unknown>, returning: string) {
  const cols = Object.keys(values).filter((k) => values[k] !== undefined);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${returning}`;
  const { rows } = await db().query(sql, cols.map((c) => values[c]));
  return rows[0];
}

export const DEFAULT_PASSWORD = 'Password123!';
// bcrypt is deliberately slow; hash the shared password once per worker.
const DEFAULT_HASH = bcrypt.hashSync(DEFAULT_PASSWORD, 4);

let pool: Pool | null = null;
export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}
export async function closeDb() {
  if (pool) await pool.end();
  pool = null;
}

export const uid = (n = 6) => randomBytes(n).toString('hex');

export interface TenantRow {
  id: string;
  slug: string;
  plan: PlanTier;
  timezone: string;
}

export async function createTenant(
  opts: { plan?: PlanTier; timezone?: string; rateLimitOverride?: number | null; suspended?: boolean } = {},
): Promise<TenantRow> {
  const slug = `t-${uid()}`;
  return insertRow(
    'tenants',
    {
      name: `Tenant ${slug}`,
      slug,
      plan: opts.plan ?? 'FREE',
      timezone: opts.timezone ?? 'UTC',
      suspended: opts.suspended ?? false,
      rate_limit_override: opts.rateLimitOverride ?? undefined,
    },
    'id, slug, plan, timezone',
  );
}

export interface UserRow {
  id: string;
  email: string;
  password: string;
}

export async function createUser(email = `u-${uid()}@test.local`): Promise<UserRow> {
  const { rows } = await db().query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
    [email, DEFAULT_HASH],
  );
  return { ...rows[0], password: DEFAULT_PASSWORD };
}

export async function addMember(tenant: { id: string }, user: { id: string }, role: MemberRole) {
  const { rows } = await db().query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, user.id, role],
  );
  return rows[0].id as string;
}

export interface KeyRow {
  id: string;
  prefix: string;
  /** Full `prefix.secret`, as a customer would send it. */
  secret: string;
}

export async function createApiKey(
  tenant: { id: string },
  opts: { name?: string; scopes?: string[]; revoked?: boolean } = {},
): Promise<KeyRow> {
  const prefix = `mk_${uid(4)}`;
  const secret = uid(24);
  const row = await insertRow(
    'api_keys',
    {
      tenant_id: tenant.id,
      name: opts.name ?? `Key ${prefix}`,
      prefix,
      secret_hash: hashSecret(secret),
      revoked_at: opts.revoked ? new Date() : null,
      scopes: opts.scopes ?? undefined,
    },
    'id',
  );
  return { id: row.id, prefix, secret: `${prefix}.${secret}` };
}

/** Bulk-inserts `count` usage events at `at` (default now) in one statement. */
export async function insertUsage(
  tenant: { id: string },
  key: { id: string },
  count: number,
  opts: { at?: Date | string; status?: number; route?: string } = {},
) {
  await db().query(
    `INSERT INTO usage_events (tenant_id, api_key_id, route, status, latency_ms, created_at)
     SELECT $1, $2, $3, $4, 20, $5::timestamptz FROM generate_series(1, $6)`,
    [
      tenant.id,
      key.id,
      opts.route ?? 'GET /gw/ping',
      opts.status ?? 200,
      opts.at ? new Date(opts.at).toISOString() : new Date().toISOString(),
      count,
    ],
  );
}

export async function createBillingEvent(
  tenant: { id: string },
  opts: { period: string; overageRequests?: number; amount?: number; providerRef?: string | null },
) {
  const { rows } = await db().query(
    `INSERT INTO billing_events (tenant_id, period, overage_requests, amount, provider_ref)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.id, opts.period, opts.overageRequests ?? 100, opts.amount ?? 0.2, opts.providerRef ?? null],
  );
  return rows[0].id as string;
}

export async function createWebhookEndpoint(tenant: { id: string }, url: string) {
  const secret = uid(16);
  const { rows } = await db().query(
    `INSERT INTO webhook_endpoints (tenant_id, label, url, secret) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.id, `hook-${uid(3)}`, url, secret],
  );
  return { id: rows[0].id as string, secret };
}

export async function createRefreshSession(user: { id: string }) {
  const token = uid(32);
  await db().query(
    `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
    [user.id, token],
  );
  return token;
}

export function accessTokenFor(user: { id: string }, expiresIn = 900) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET!, { expiresIn });
}

export const ROLES: MemberRole[] = ['OWNER', 'ADMIN', 'BILLING', 'MEMBER', 'VIEWER'];

export interface Org {
  tenant: TenantRow;
  users: Record<MemberRole, UserRow>;
  memberships: Record<MemberRole, string>;
  /** Headers for a dashboard request acting as `role` in this tenant. */
  as(role: MemberRole): Record<string, string>;
}

/** A tenant with exactly one member per role. */
export async function createOrg(opts: Parameters<typeof createTenant>[0] = {}): Promise<Org> {
  const tenant = await createTenant(opts);
  const users = {} as Record<MemberRole, UserRow>;
  const memberships = {} as Record<MemberRole, string>;
  for (const role of ROLES) {
    users[role] = await createUser();
    memberships[role] = await addMember(tenant, users[role], role);
  }
  return {
    tenant,
    users,
    memberships,
    as: (role) => ({ authorization: `Bearer ${accessTokenFor(users[role])}`, 'x-tenant-id': tenant.id }),
  };
}

export async function auditEntries(tenantId: string, action: string) {
  const { rows } = await db().query(
    `SELECT actor_id, action, target, metadata, created_at FROM audit_log
      WHERE tenant_id = $1 AND action = $2 ORDER BY created_at`,
    [tenantId, action],
  );
  return rows;
}

export const randomId = () => randomUUID();
