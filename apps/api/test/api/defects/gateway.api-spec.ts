import { INestApplication } from '@nestjs/common';
import { http, startApp, stopApp } from '../../support/app';
import { createApiKey, createOrg, createTenant, db, Org } from '../../support/factories';

/** Regression tests for gateway defects (rate limiting, key lifecycle, metering). */
describe('Gateway defects', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => stopApp(app));

  const ping = (key: string) => http(app).get('/api/v1/gw/ping').set('x-api-key', key);
  const statuses = (responses: Array<{ status: number }>) =>
    responses.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  describe('DEF-003 / SUP-1067 concurrent requests bypass the rate limit', () => {
    it('allows exactly the FREE limit (100) out of 250 simultaneous requests', async () => {
      const tenant = await createTenant({ plan: 'FREE' });
      const key = await createApiKey(tenant);
      const results = await Promise.all(Array.from({ length: 250 }, () => ping(key.secret)));
      expect(statuses(results)).toEqual({ 200: 100, 429: 150 });
    });
  });

  describe('DEF-011 / SUP-1067 the limit is per key, not per tenant', () => {
    it('three keys of one FREE tenant share a single 100/min budget', async () => {
      const tenant = await createTenant({ plan: 'FREE' });
      const keys = await Promise.all([createApiKey(tenant), createApiKey(tenant), createApiKey(tenant)]);
      const results = [];
      for (let round = 0; round < 6; round++) {
        // 6 rounds x 3 keys x 10 = 180 requests, sent in modest batches
        results.push(...(await Promise.all(keys.flatMap((k) => Array.from({ length: 10 }, () => ping(k.secret))))));
      }
      expect(statuses(results)).toEqual({ 200: 100, 429: 80 });
    });
  });

  describe('DEF-029 fixed window allows a double burst across the minute boundary', () => {
    it('does not allow 2x the limit within 60 seconds', async () => {
      const tenant = await createTenant({ plan: 'FREE' });
      const key = await createApiKey(tenant);

      // Wait until ~58.5s into the current wall-clock minute (the original window boundary).
      const msToBoundary = 60_000 - (Date.now() % 60_000);
      await new Promise((r) => setTimeout(r, Math.max(0, msToBoundary - 1_500)));
      const before = await Promise.all(Array.from({ length: 100 }, () => ping(key.secret)));

      // Cross the boundary, then spend another 100.
      await new Promise((r) => setTimeout(r, 60_000 - (Date.now() % 60_000) + 500));
      const after = await Promise.all(Array.from({ length: 100 }, () => ping(key.secret)));

      const allowed = [...before, ...after].filter((r) => r.status === 200).length;
      expect(allowed).toBeLessThanOrEqual(100);
    }, 120_000);
  });

  describe('DEF-005 / SUP-1051 revoked keys keep working', () => {
    it('a revoked key is rejected on the very next request', async () => {
      const org = await createOrg();
      const key = await createApiKey(org.tenant);
      expect((await ping(key.secret)).status).toBe(200); // warms any cache

      const revoke = await http(app).delete(`/api/v1/keys/${key.id}`).set(org.as('ADMIN'));
      expect(revoke.status).toBe(200);

      expect((await ping(key.secret)).status).toBe(401);
    });

    it('revocation applies across API replicas', async () => {
      const replica = await startApp();
      try {
        const org = await createOrg();
        const key = await createApiKey(org.tenant);
        expect((await http(replica).get('/api/v1/gw/ping').set('x-api-key', key.secret)).status).toBe(200);

        await http(app).delete(`/api/v1/keys/${key.id}`).set(org.as('OWNER'));
        expect((await http(replica).get('/api/v1/gw/ping').set('x-api-key', key.secret)).status).toBe(401);
      } finally {
        await replica.close();
      }
    });
  });

  describe('DEF-028 suspended tenants consume rate-limit budget', () => {
    it('every request from a suspended tenant gets 403, never 429', async () => {
      const tenant = await createTenant({ plan: 'FREE', suspended: true });
      const key = await createApiKey(tenant);
      // Sequential on purpose: concurrency would hide the bug behind DEF-003.
      const results = [];
      for (let i = 0; i < 110; i++) results.push(await ping(key.secret));
      expect(statuses(results)).toEqual({ 403: 110 });
    });
  });

  describe('DEF-016 failed gateway requests are not metered', () => {
    it('a bad /gw/transform request returns 400 and is recorded with its status', async () => {
      const tenant = await createTenant({ plan: 'GROWTH' });
      const key = await createApiKey(tenant);
      const res = await http(app).post('/api/v1/gw/transform').set('x-api-key', key.secret).send({ text: 123 });
      expect(res.status).toBe(400);

      const { rows } = await db().query(`SELECT status FROM usage_events WHERE api_key_id = $1`, [key.id]);
      expect(rows.map((r) => r.status)).toEqual([400]);
    });
  });

  describe('DEF-019 malformed identifiers cause 500s', () => {
    let org: Org;
    beforeAll(async () => {
      org = await createOrg();
    });

    it('a non-UUID x-tenant-id is a client error, not a 500', async () => {
      const res = await http(app)
        .get('/api/v1/tenant')
        .set({ ...org.as('OWNER'), 'x-tenant-id': 'not-a-uuid' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('a non-UUID webhook id is a client error, not a 500', async () => {
      const res = await http(app).delete('/api/v1/webhooks/not-a-uuid').set(org.as('OWNER'));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
