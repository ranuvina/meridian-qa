import { INestApplication } from '@nestjs/common';
import { http, startApp, stopApp } from '../support/app';
import { auditEntries, createApiKey, createOrg, db, Org } from '../support/factories';

/** A1 - tenant rate-limit override, bounded by the plan ceiling. Spec: docs/feature-specs/A1-*.md */
describe('A1 tenant rate-limit override', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => stopApp(app));

  const setLimit = (org: Org, body: unknown, role: Parameters<Org['as']>[0] = 'OWNER') =>
    http(app).patch('/api/v1/tenant/rate-limit').set(org.as(role)).send(body as object);
  const clearLimit = (org: Org, role: Parameters<Org['as']>[0] = 'OWNER') =>
    http(app).delete('/api/v1/tenant/rate-limit').set(org.as(role));
  const tenantView = async (org: Org) => (await http(app).get('/api/v1/tenant').set(org.as('VIEWER'))).body;
  const pings = (secret: string, n: number) =>
    Promise.all(Array.from({ length: n }, () => http(app).get('/api/v1/gw/ping').set('x-api-key', secret)));
  const ok = (rs: Array<{ status: number }>) => rs.filter((r) => r.status === 200).length;

  it('an OWNER sets an override and GET /tenant shows the effective limit', async () => {
    const org = await createOrg({ plan: 'GROWTH' });
    const res = await setLimit(org, { rateLimitPerMinute: 2500 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ effective: 2500, planDefault: 1000, ceiling: 5000, override: 2500 });

    const tenant = await tenantView(org);
    expect(tenant.limits.rateLimitPerMinute).toBe(2500);
    expect(tenant.rateLimit).toEqual({ effective: 2500, planDefault: 1000, ceiling: 5000, override: 2500 });
  });

  it('without an override GET /tenant shows the plan default', async () => {
    const org = await createOrg({ plan: 'SCALE' });
    expect((await tenantView(org)).rateLimit).toEqual({ effective: 5000, planDefault: 5000, ceiling: 25000, override: null });
  });

  it.each([
    [100, 200],
    [499, 200],
    [500, 200],
    [501, 400],
    [99, 400], // below plan default: rejected until Product decides (see SUBMISSION.md)
  ])('FREE: %d -> %d (ceiling 500 is inclusive)', async (value, status) => {
    const org = await createOrg({ plan: 'FREE' });
    expect((await setLimit(org, { rateLimitPerMinute: value })).status).toBe(status);
  });

  it.each([[{ rateLimitPerMinute: 0 }], [{ rateLimitPerMinute: -1 }], [{ rateLimitPerMinute: 2.5 }],
    [{ rateLimitPerMinute: 'abc' }], [{ rateLimitPerMinute: '2500' }], [{ rateLimitPerMinute: null }], [{}],
    [{ rateLimitPerMinute: 1e12 }]])('rejects %p with 400 and changes nothing', async (body) => {
    const org = await createOrg({ plan: 'GROWTH' });
    const res = await setLimit(org, body);
    expect(res.status).toBe(400);
    expect((await tenantView(org)).rateLimit.override).toBeNull();
    expect(await auditEntries(org.tenant.id, 'tenant.rate_limit_override.set')).toHaveLength(0);
  });

  it.each(['ADMIN', 'BILLING', 'MEMBER', 'VIEWER'] as const)('%s cannot set or remove the override', async (role) => {
    const org = await createOrg({ plan: 'GROWTH' });
    expect((await setLimit(org, { rateLimitPerMinute: 2000 }, role)).status).toBe(403);
    expect((await clearLimit(org, role)).status).toBe(403);
    expect((await tenantView(org)).rateLimit.override).toBeNull();
  });

  it('takes effect on the next gateway request, even for a key resolved moments earlier', async () => {
    const org = await createOrg({ plan: 'FREE' });
    const key = await createApiKey(org.tenant);
    expect((await pings(key.secret, 1))[0].headers['x-ratelimit-limit']).toBe('100');

    await setLimit(org, { rateLimitPerMinute: 150 });
    const results = await pings(key.secret, 220);
    expect(ok(results)).toBe(150 - 1); // one request was spent before the change
    expect(results.find((r) => r.status === 200).headers['x-ratelimit-limit']).toBe('150');
  });

  it('applies to the tenant as a whole, across all its keys', async () => {
    const org = await createOrg({ plan: 'FREE' });
    await setLimit(org, { rateLimitPerMinute: 120 });
    const keys = await Promise.all([createApiKey(org.tenant), createApiKey(org.tenant), createApiKey(org.tenant)]);
    const results = (await Promise.all(keys.map((k) => pings(k.secret, 60)))).flat();
    expect(ok(results)).toBe(120);
  });

  it('DELETE returns the tenant to the plan default on the next request', async () => {
    const org = await createOrg({ plan: 'FREE' });
    const key = await createApiKey(org.tenant);
    await setLimit(org, { rateLimitPerMinute: 400 });
    const res = await clearLimit(org);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ effective: 100, override: null });
    expect((await pings(key.secret, 1))[0].headers['x-ratelimit-limit']).toBe('100');
  });

  it('DELETE without an override is a no-op: 200 and no audit entry', async () => {
    const org = await createOrg({ plan: 'FREE' });
    expect((await clearLimit(org)).status).toBe(200);
    expect(await auditEntries(org.tenant.id, 'tenant.rate_limit_override.removed')).toHaveLength(0);
  });

  it('records set, change and removal in the audit log with previous and new values', async () => {
    const org = await createOrg({ plan: 'GROWTH' });
    await setLimit(org, { rateLimitPerMinute: 1500 });
    await setLimit(org, { rateLimitPerMinute: 3000 });
    await setLimit(org, { rateLimitPerMinute: 3000 }); // unchanged: not audited
    await clearLimit(org);

    const set = await auditEntries(org.tenant.id, 'tenant.rate_limit_override.set');
    const removed = await auditEntries(org.tenant.id, 'tenant.rate_limit_override.removed');
    expect(set.map((e) => e.metadata)).toEqual([{ previous: null, new: 1500 }, { previous: 1500, new: 3000 }]);
    expect(removed.map((e) => e.metadata)).toEqual([{ previous: 3000, new: null }]);
    expect([...set, ...removed].every((e) => e.actor_id === org.users.OWNER.id)).toBe(true);

    const log = await http(app).get('/api/v1/tenant/audit-log').set(org.as('ADMIN'));
    expect(log.body.map((e: { action: string }) => e.action)).toContain('tenant.rate_limit_override.removed');
  });

  it('survives plan changes, clamped to the current plan ceiling', async () => {
    const org = await createOrg({ plan: 'GROWTH' });
    await setLimit(org, { rateLimitPerMinute: 4000 });
    const setPlan = (plan: string) => db().query(`UPDATE tenants SET plan = $2 WHERE id = $1`, [org.tenant.id, plan]);

    await setPlan('SCALE');
    expect((await tenantView(org)).rateLimit).toMatchObject({ effective: 4000, override: 4000 });
    await setPlan('FREE');
    expect((await tenantView(org)).rateLimit).toMatchObject({ effective: 500, override: 4000, ceiling: 500 });
    await setPlan('GROWTH');
    expect((await tenantView(org)).rateLimit).toMatchObject({ effective: 4000, override: 4000 });
  });

  it('only changes the tenant named in x-tenant-id', async () => {
    const mine = await createOrg({ plan: 'GROWTH' });
    const other = await createOrg({ plan: 'GROWTH' });
    await setLimit(mine, { rateLimitPerMinute: 2222 });
    expect((await tenantView(other)).rateLimit.override).toBeNull();
  });
});
