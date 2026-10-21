import { INestApplication } from '@nestjs/common';
import { http, provider, startApp, stopApp } from '../support/app';
import {
  addMember,
  createApiKey,
  createBillingEvent,
  createOrg,
  createUser,
  createWebhookEndpoint,
  db,
  insertUsage,
  Org,
  uid,
} from '../support/factories';

/**
 * Systematic tenant-isolation proof (rbac-matrix "Tenant isolation"): no endpoint may return,
 * modify or reference another tenant's data, whatever identifiers are supplied.
 *
 * Tenant B is filled with uniquely marked data. Every read endpoint is called as tenant A and
 * must not contain B's id or any marker; every endpoint that takes an id is called as tenant A
 * with B's ids and must answer 404 while leaving B's data untouched.
 */
describe('Tenant isolation', () => {
  let app: INestApplication;
  let a: Org;
  let b: Org;
  const marker = `victim-${uid()}`;
  let bKey: { id: string };
  let bWebhook: { id: string };
  let bExtraMember: string;

  beforeAll(async () => {
    app = await startApp();
    a = await createOrg({ plan: 'GROWTH' });
    b = await createOrg({ plan: 'GROWTH' });

    bKey = await createApiKey(b.tenant, { name: `${marker}-key` });
    await insertUsage(b.tenant, bKey, 5);
    bWebhook = await createWebhookEndpoint(b.tenant, provider.webhookUrl(marker));
    bExtraMember = await addMember(b.tenant, await createUser(`${marker}@test.local`), 'VIEWER');
    await createBillingEvent(b.tenant, { period: '2025-12', overageRequests: 777 });
    await db().query(
      `INSERT INTO audit_log (tenant_id, action, target, metadata) VALUES ($1, 'key.created', $2, $3)`,
      [b.tenant.id, bKey.id, JSON.stringify({ name: `${marker}-audit` })],
    );
    await http(app).post('/api/v1/webhooks/test').set(b.as('OWNER')); // creates B deliveries

    // A needs some data of its own so empty responses do not pass trivially.
    await insertUsage(a.tenant, await createApiKey(a.tenant), 3);
  });
  afterAll(() => stopApp(app));

  const reads = [
    '/api/v1/tenant',
    '/api/v1/tenant/audit-log',
    '/api/v1/memberships',
    '/api/v1/keys',
    '/api/v1/usage/summary',
    '/api/v1/usage/daily',
    '/api/v1/usage/export',
    '/api/v1/billing/events',
    '/api/v1/billing/invoice-preview',
    '/api/v1/webhooks',
    '/api/v1/webhooks/deliveries',
  ];

  it.each(reads)('GET %s returns nothing belonging to another tenant', async (path) => {
    const res = await http(app).get(path).set(a.as('OWNER'));
    expect(res.status).toBe(200);
    const text = res.text;
    expect(text).not.toContain(b.tenant.id);
    expect(text).not.toContain(marker);
    expect(text).not.toContain(bKey.id);
  });

  it('GET /usage/export?keyId=<B key> is 404 and leaks nothing', async () => {
    const res = await http(app).get(`/api/v1/usage/export?keyId=${bKey.id}`).set(a.as('OWNER'));
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(marker);
  });

  it('DELETE /keys/<B key> is 404 and the key stays active', async () => {
    expect((await http(app).delete(`/api/v1/keys/${bKey.id}`).set(a.as('OWNER'))).status).toBe(404);
    const { rows } = await db().query(`SELECT revoked_at FROM api_keys WHERE id = $1`, [bKey.id]);
    expect(rows[0].revoked_at).toBeNull();
  });

  it('PATCH /memberships/<B member> is 404 and the role is unchanged', async () => {
    const res = await http(app).patch(`/api/v1/memberships/${bExtraMember}`).set(a.as('OWNER')).send({ role: 'OWNER' });
    expect(res.status).toBe(404);
    const { rows } = await db().query(`SELECT role FROM memberships WHERE id = $1`, [bExtraMember]);
    expect(rows[0].role).toBe('VIEWER');
  });

  it('DELETE /memberships/<B member> is 404 and the membership remains', async () => {
    expect((await http(app).delete(`/api/v1/memberships/${bExtraMember}`).set(a.as('OWNER'))).status).toBe(404);
    const { rows } = await db().query(`SELECT 1 FROM memberships WHERE id = $1`, [bExtraMember]);
    expect(rows).toHaveLength(1);
  });

  it('DELETE /webhooks/<B endpoint> is 404 and the endpoint remains', async () => {
    expect((await http(app).delete(`/api/v1/webhooks/${bWebhook.id}`).set(a.as('OWNER'))).status).toBe(404);
    const { rows } = await db().query(`SELECT 1 FROM webhook_endpoints WHERE id = $1`, [bWebhook.id]);
    expect(rows).toHaveLength(1);
  });

  it('POST /keys/<B key>/rotate is 404 and the key keeps its secret', async () => {
    const victimKey = await createApiKey(b.tenant);
    const res = await http(app).post(`/api/v1/keys/${victimKey.id}/rotate`).set(a.as('OWNER')).send({});
    expect(res.status).toBe(404);
    expect((await http(app).get('/api/v1/gw/ping').set('x-api-key', victimKey.secret)).status).toBe(200);
  });

  it('PATCH /tenant/rate-limit as A never changes B', async () => {
    await http(app).patch('/api/v1/tenant/rate-limit').set(a.as('OWNER')).send({ rateLimitPerMinute: 4321 });
    const { rows } = await db().query(`SELECT rate_limit_override FROM tenants WHERE id = $1`, [b.tenant.id]);
    expect(rows[0].rate_limit_override).toBeNull();
  });

  it('POST /billing/sync as A never charges B', async () => {
    await http(app).post('/api/v1/billing/sync').set(a.as('OWNER'));
    expect(await provider.charges(b.tenant.id)).toHaveLength(0);
  });

  it('a key of tenant B is attributed to B at the gateway, never to A', async () => {
    const key = await createApiKey(b.tenant);
    const res = await http(app).get('/api/v1/gw/ping').set('x-api-key', key.secret);
    expect(res.body.tenant).toBe(b.tenant.id);
  });
});
