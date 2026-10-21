import { INestApplication } from '@nestjs/common';
import { http, startApp, stopApp } from '../support/app';
import { auditEntries, createApiKey, createOrg, createTenant, db, Org } from '../support/factories';

/** A2 - API key scopes and rotation with a grace period. Spec: docs/feature-specs/A2-*.md */
describe('A2 key scopes and rotation', () => {
  let app: INestApplication;
  let org: Org;
  beforeAll(async () => {
    app = await startApp();
    org = await createOrg({ plan: 'GROWTH' });
  });
  afterAll(() => stopApp(app));

  const createKey = (body: Record<string, unknown>, who: Org = org) =>
    http(app).post('/api/v1/keys').set(who.as('OWNER')).send(body);
  const rotate = (id: string, body: Record<string, unknown> = {}, role: Parameters<Org['as']>[0] = 'OWNER', who: Org = org) =>
    http(app).post(`/api/v1/keys/${id}/rotate`).set(who.as(role)).send(body);
  const gw = (secret: string) => ({
    ping: () => http(app).get('/api/v1/gw/ping').set('x-api-key', secret),
    echo: () => http(app).post('/api/v1/gw/echo').set('x-api-key', secret).send({ a: 1 }),
    transform: () => http(app).post('/api/v1/gw/transform').set('x-api-key', secret).send({ text: 'x' }),
  });
  const statusOf = async (secret: string) => (await gw(secret).ping()).status;

  describe('scopes', () => {
    it('a read-only key may GET but not POST', async () => {
      const res = await createKey({ name: 'Analytics', scopes: ['read'] });
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(['read']);
      const g = gw(res.body.secret);
      expect((await g.ping()).status).toBe(200);
      expect((await g.echo()).status).toBe(403);
      expect((await g.transform()).status).toBe(403);
    });

    it('a write-only key may POST but not GET', async () => {
      const res = await createKey({ name: 'Writer', scopes: ['write'] });
      const g = gw(res.body.secret);
      expect((await g.echo()).status).toBe(200);
      expect((await g.transform()).status).toBe(200);
      expect((await g.ping()).status).toBe(403);
    });

    it('scopes are returned by GET /keys', async () => {
      const res = await createKey({ name: 'Listed', scopes: ['write', 'read', 'read'] });
      const list = await http(app).get('/api/v1/keys').set(org.as('VIEWER'));
      expect(list.body.find((k: { id: string }) => k.id === res.body.id).scopes).toEqual(['read', 'write']);
    });

    it('omitting scopes creates a full-access key', async () => {
      const res = await createKey({ name: 'Default' });
      expect(res.body.scopes).toEqual(['read', 'write']);
    });

    it('keys that existed before scopes were introduced keep full access', async () => {
      const legacy = await createApiKey(org.tenant); // inserted without a scopes value: column default
      const g = gw(legacy.secret);
      expect([(await g.ping()).status, (await g.echo()).status, (await g.transform()).status]).toEqual([200, 200, 200]);
    });

    it.each([[[]], [['admin']], [['READ']], ['read'], [[null]]])('rejects scopes %p with 400', async (scopes) => {
      expect((await createKey({ name: 'Bad', scopes })).status).toBe(400);
    });

    it('out-of-scope requests consume no rate limit and are not metered', async () => {
      const free = await createOrg({ plan: 'FREE' });
      const key = (await createKey({ name: 'RO', scopes: ['read'] }, free)).body;
      const denied = await Promise.all(Array.from({ length: 120 }, () => gw(key.secret).echo()));
      expect(denied.every((r) => r.status === 403)).toBe(true);

      const allowed = await Promise.all(Array.from({ length: 100 }, () => gw(key.secret).ping()));
      expect(allowed.every((r) => r.status === 200)).toBe(true);
      const { rows } = await db().query(`SELECT count(*)::int AS n FROM usage_events WHERE api_key_id = $1`, [key.id]);
      expect(rows[0].n).toBe(100);
    });
  });

  describe('rotation', () => {
    it('issues a new secret on the same key; old and new both work during the default grace period', async () => {
      const key = await createApiKey(org.tenant);
      const before = Date.now();
      const res = await rotate(key.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: key.id, prefix: key.prefix, gracePeriodSeconds: 3600 });
      expect(res.body.secret).toMatch(new RegExp(`^${key.prefix}\\.[0-9a-f]+$`));
      expect(res.body.secret).not.toBe(key.secret);
      const expires = new Date(res.body.previous_secret_expires_at).getTime();
      expect(expires).toBeGreaterThan(before + 3_590_000);
      expect(expires).toBeLessThan(before + 3_610_000);

      expect(await statusOf(key.secret)).toBe(200);
      expect(await statusOf(res.body.secret)).toBe(200);
      const { rows } = await db().query(`SELECT count(*)::int AS n FROM usage_events WHERE api_key_id = $1`, [key.id]);
      expect(rows[0].n).toBe(2); // usage from both secrets is attributed to the same key
    });

    it('a grace period of 0 invalidates the old secret on the very next request', async () => {
      const key = await createApiKey(org.tenant);
      expect(await statusOf(key.secret)).toBe(200); // warm the cache
      const res = await rotate(key.id, { gracePeriodSeconds: 0 });
      expect(res.body.previous_secret_expires_at).toBeNull();
      expect(await statusOf(key.secret)).toBe(401);
      expect(await statusOf(res.body.secret)).toBe(200);
    });

    it('the old secret stops working when the grace period ends', async () => {
      const key = await createApiKey(org.tenant);
      const res = await rotate(key.id, { gracePeriodSeconds: 2 });
      expect(await statusOf(key.secret)).toBe(200);
      await new Promise((r) => setTimeout(r, 2_500));
      expect(await statusOf(key.secret)).toBe(401);
      expect(await statusOf(res.body.secret)).toBe(200);
    });

    it.each([
      [86_400, 201],
      [86_401, 400],
      [-1, 400],
      [1.5, 400],
      ['60', 400],
    ])('gracePeriodSeconds %p -> %d', async (grace, status) => {
      const key = await createApiKey(org.tenant);
      expect((await rotate(key.id, { gracePeriodSeconds: grace })).status).toBe(status);
    });

    it('rotating again ends the earlier grace period immediately (one previous secret at a time)', async () => {
      const key = await createApiKey(org.tenant);
      const first = await rotate(key.id, { gracePeriodSeconds: 600 });
      const second = await rotate(key.id, { gracePeriodSeconds: 600 });
      expect(await statusOf(key.secret)).toBe(401);
      expect(await statusOf(first.body.secret)).toBe(200);
      expect(await statusOf(second.body.secret)).toBe(200);
    });

    it('a revoked key cannot be rotated', async () => {
      const key = await createApiKey(org.tenant, { revoked: true });
      expect((await rotate(key.id)).status).toBe(409);
    });

    it('revoking during a grace period kills both secrets', async () => {
      const key = await createApiKey(org.tenant);
      const res = await rotate(key.id, { gracePeriodSeconds: 600 });
      await http(app).delete(`/api/v1/keys/${key.id}`).set(org.as('ADMIN'));
      expect(await statusOf(key.secret)).toBe(401);
      expect(await statusOf(res.body.secret)).toBe(401);
    });

    it.each(['OWNER', 'ADMIN'] as const)('%s may rotate', async (role) => {
      const key = await createApiKey(org.tenant);
      expect((await rotate(key.id, {}, role)).status).toBe(201);
    });

    it.each(['BILLING', 'MEMBER', 'VIEWER'] as const)('%s may not rotate', async (role) => {
      const key = await createApiKey(org.tenant);
      expect((await rotate(key.id, {}, role)).status).toBe(403);
      expect(await statusOf(key.secret)).toBe(200);
    });

    it("another tenant's key is 404 and is not rotated", async () => {
      const foreign = await createApiKey(await createTenant());
      expect((await rotate(foreign.id)).status).toBe(404);
      expect(await statusOf(foreign.secret)).toBe(200);
    });

    it('a malformed id is 400', async () => {
      expect((await rotate('not-a-uuid')).status).toBe(400);
    });

    it('rate-limit accounting continues across rotation', async () => {
      const free = await createOrg({ plan: 'FREE' });
      const key = await createApiKey(free.tenant);
      const spend = await Promise.all(Array.from({ length: 90 }, () => statusOf(key.secret)));
      expect(spend.every((s) => s === 200)).toBe(true);

      const res = await rotate(key.id, {}, 'OWNER', free);
      const after = await Promise.all(Array.from({ length: 20 }, () => statusOf(res.body.secret)));
      expect(after.filter((s) => s === 200)).toHaveLength(10);
    });

    it('quota accounting continues across rotation (usage stays on one key)', async () => {
      const key = await createApiKey(org.tenant);
      await statusOf(key.secret);
      const res = await rotate(key.id);
      await statusOf(res.body.secret);
      await statusOf(key.secret); // old secret, still in grace
      const summary = await http(app).get('/api/v1/usage/summary').set(org.as('VIEWER'));
      expect(summary.body.keys.find((k: { keyId: string }) => k.keyId === key.id).requests).toBe(3);
    });

    it('is audited without exposing any secret', async () => {
      const key = await createApiKey(org.tenant);
      const res = await rotate(key.id, { gracePeriodSeconds: 120 }, 'ADMIN');
      const entries = (await auditEntries(org.tenant.id, 'key.rotated')).filter((e) => e.target === key.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].actor_id).toBe(org.users.ADMIN.id);
      expect(entries[0].metadata).toEqual({ prefix: key.prefix, gracePeriodSeconds: 120 });
      const secretPart = res.body.secret.split('.')[1];
      expect(JSON.stringify(entries)).not.toContain(secretPart);
    });
  });
});
