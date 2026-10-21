import { test as base, expect, Page } from '@playwright/test';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';

/**
 * E2E data is created directly in the API's database with unique identifiers, so journeys are
 * independent and parallel-safe and never depend on the shared seed.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://meridian:meridian@localhost:5432/meridian',
  max: 4,
});
const PASSWORD = 'Password123!';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const uid = (n = 5) => randomBytes(n).toString('hex');

export interface Seeded {
  tenantId: string;
  tenantName: string;
  email: string;
  password: string;
}

export async function seedTenant(opts: { plan?: string; role?: string; timezone?: string; email?: string } = {}): Promise<Seeded> {
  const slug = `e2e-${uid()}`;
  const tenantName = `E2E ${slug}`;
  const t = await pool.query(
    `INSERT INTO tenants (name, slug, plan, timezone) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantName, slug, opts.plan ?? 'GROWTH', opts.timezone ?? 'UTC'],
  );
  const email = opts.email ?? `${slug}@e2e.test`;
  const u = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [email, HASH],
  );
  await pool.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.rows[0].id,
    u.rows[0].id,
    opts.role ?? 'OWNER',
  ]);
  return { tenantId: t.rows[0].id, tenantName, email, password: PASSWORD };
}

export async function seedKeyWithUsage(tenantId: string, name: string, count: number, at: Date) {
  const prefix = `mk_${uid(4)}`;
  const k = await pool.query(
    `INSERT INTO api_keys (tenant_id, name, prefix, secret_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, name, prefix, createHash('sha256').update(uid(24)).digest('hex')],
  );
  await pool.query(
    `INSERT INTO usage_events (tenant_id, api_key_id, route, status, latency_ms, created_at)
     SELECT $1, $2, 'GET /gw/ping', 200, 25, $3 FROM generate_series(1, $4)`,
    [tenantId, k.rows[0].id, at.toISOString(), count],
  );
  return k.rows[0].id as string;
}

export async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export const test = base;
export { expect };
