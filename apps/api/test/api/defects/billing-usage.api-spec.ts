import { INestApplication } from '@nestjs/common';
import { DbService } from '../../../src/db/db.service';
import { eventually, http, provider, startApp, stopApp } from '../../support/app';
import {
  createApiKey,
  createBillingEvent,
  createOrg,
  createWebhookEndpoint,
  db,
  insertUsage,
  Org,
  uid,
} from '../../support/factories';

const utcPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Regression tests for billing, usage reporting and webhook defects. */
describe('Billing, usage and webhook defects', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => stopApp(app));

  describe('DEF-006 concurrent or retried billing syncs charge twice', () => {
    it('two simultaneous syncs create exactly one provider charge per billing event', async () => {
      const org = await createOrg({ plan: 'FREE' });
      await createBillingEvent(org.tenant, { period: '2025-11', overageRequests: 500, amount: 1 });

      await Promise.all([
        http(app).post('/api/v1/billing/sync').set(org.as('OWNER')),
        http(app).post('/api/v1/billing/sync').set(org.as('BILLING')),
      ]);

      expect(await provider.charges(org.tenant.id)).toHaveLength(1);
    });
  });

  describe('DEF-007 the open billing period is charged, and later overage is lost', () => {
    it('sync does not push the current, still-open period', async () => {
      const org = await createOrg({ plan: 'FREE' });
      const eventId = await createBillingEvent(org.tenant, { period: utcPeriod(), overageRequests: 10, amount: 0.02 });

      const res = await http(app).post('/api/v1/billing/sync').set(org.as('OWNER'));
      expect(res.status).toBe(201);

      expect(await provider.charges(org.tenant.id)).toHaveLength(0);
      const { rows } = await db().query(`SELECT provider_ref FROM billing_events WHERE id = $1`, [eventId]);
      expect(rows[0].provider_ref).toBeNull();
    });
  });

  describe('DEF-033 / SUP-1043 overage billed while the dashboard shows the tenant under quota', () => {
    it('billing events and the invoice preview agree after a plan change', async () => {
      const org = await createOrg({ plan: 'FREE' });
      const key = await createApiKey(org.tenant);
      await insertUsage(org.tenant, key, 10_000);
      expect((await http(app).get('/api/v1/gw/ping').set('x-api-key', key.secret)).status).toBe(200);

      await db().query(`UPDATE tenants SET plan = 'GROWTH' WHERE id = $1`, [org.tenant.id]);

      const preview = await http(app).get('/api/v1/billing/invoice-preview').set(org.as('OWNER'));
      const events = await http(app).get('/api/v1/billing/events').set(org.as('OWNER'));
      const current = events.body.find((e: { period: string }) => e.period === utcPeriod());
      expect(Number(current?.overage_requests ?? 0)).toBe(preview.body.overageRequests);
    });
  });

  describe('DEF-017 money is stored and calculated as binary floating point', () => {
    it('9 overage requests on FREE cost exactly 0.018', async () => {
      const org = await createOrg({ plan: 'FREE' });
      const key = await createApiKey(org.tenant);
      await insertUsage(org.tenant, key, 10_009);
      const res = await http(app).get('/api/v1/billing/invoice-preview').set(org.as('OWNER'));
      expect(res.body.overageRequests).toBe(9);
      expect(res.body.overageAmount).toBe(0.018);
    });
  });

  describe('DEF-012 / SUP-1058 daily usage ignores the tenant timezone', () => {
    it('requests at 08:30 JST on Oct 1 are reported on Oct 1 for a Tokyo tenant', async () => {
      const org = await createOrg({ plan: 'SCALE', timezone: 'Asia/Tokyo' });
      const key = await createApiKey(org.tenant);
      await insertUsage(org.tenant, key, 5, { at: '2026-10-01T08:30:00+09:00' });

      const res = await http(app)
        .get('/api/v1/usage/daily?from=2026-09-28T00:00:00Z&to=2026-10-04T00:00:00Z')
        .set(org.as('VIEWER'));
      expect(res.status).toBe(200);
      const days = res.body.map((d: { day: string; requests: number }) => [String(d.day).slice(0, 10), d.requests]);
      expect(days).toEqual([['2026-10-01', 5]]);
    });
  });

  describe('DEF-014 / SUP-1062 usage summary does not scale with the number of keys', () => {
    it('issues the same number of queries for 1 key and for 12 keys', async () => {
      const dbService = app.get(DbService);
      const small = await createOrg({ plan: 'GROWTH' });
      const large = await createOrg({ plan: 'GROWTH' });
      await createApiKey(small.tenant);
      for (let i = 0; i < 12; i++) await createApiKey(large.tenant);

      const spy = jest.spyOn(dbService, 'query');
      const countQueries = async (org: Org) => {
        spy.mockClear();
        const res = await http(app).get('/api/v1/usage/summary').set(org.as('VIEWER'));
        expect(res.status).toBe(200);
        // The guard's membership lookup is one query; the rest belong to the report.
        return spy.mock.calls.length;
      };
      const forOne = await countQueries(small);
      const forTwelve = await countQueries(large);
      spy.mockRestore();
      expect(forTwelve).toBe(forOne);
    });

    it('usage_events is indexed for tenant/time and key/time lookups', async () => {
      const { rows } = await db().query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'usage_events'`);
      const defs = rows.map((r) => r.indexdef).join('\n');
      expect(defs).toMatch(/\(tenant_id, created_at\)/);
      expect(defs).toMatch(/\(api_key_id, created_at\)/);
    });
  });

  describe('DEF-018 CSV export does not escape values', () => {
    it('quotes commas and neutralises spreadsheet formulas', async () => {
      const org = await createOrg();
      await insertUsage(org.tenant, await createApiKey(org.tenant, { name: 'Ops, EU' }), 1);
      await insertUsage(org.tenant, await createApiKey(org.tenant, { name: '=HYPERLINK("http://x","y")' }), 1);

      const res = await http(app).get('/api/v1/usage/export').set(org.as('VIEWER'));
      expect(res.text).toContain('"Ops, EU"');
      expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
    });
  });

  describe('DEF-010 / SUP-1071 webhook retries cannot be de-duplicated', () => {
    it('every retry of one event carries the same event id', async () => {
      const org = await createOrg();
      const channel = `slow-${uid()}`;
      // The receiver takes 3.5s; Meridian gives up after 3s and retries, but the receiver still processes it.
      await createWebhookEndpoint(org.tenant, `${provider.webhookUrl(channel)}?delayMs=3500`);

      await http(app).post('/api/v1/webhooks/test').set(org.as('OWNER'));
      await eventually(async () => (await provider.received(channel)).length >= 3, 15_000);
      const received = await provider.received(channel);

      expect(received.length).toBeGreaterThanOrEqual(2);
      expect(new Set(received.map((r) => r.id)).size).toBe(1);
    }, 40_000);
  });

  describe('DEF-024 tenant settings are not validated', () => {
    it('rejects an unknown timezone', async () => {
      const org = await createOrg();
      const res = await http(app).patch('/api/v1/tenant').set(org.as('OWNER')).send({ timezone: 'Mars/Base' });
      expect(res.status).toBe(400);
    });
  });
});
