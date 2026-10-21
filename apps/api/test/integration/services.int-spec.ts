import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import { eventually, http, provider, startApp, stopApp } from '../support/app';
import { createBillingEvent, createOrg, createWebhookEndpoint, db, uid } from '../support/factories';

/** Service-to-service behaviour against the real mock billing provider / webhook receiver. */
describe('Service-to-service calls', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => stopApp(app));

  describe('billing provider', () => {
    it('sends each closed-period event once with the agreed payload and idempotency key', async () => {
      const org = await createOrg();
      const eventId = await createBillingEvent(org.tenant, { period: '2025-10', overageRequests: 1234, amount: 2.468 });
      const res = await http(app).post('/api/v1/billing/sync').set(org.as('BILLING'));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ synced: 1, attempted: 1 });

      const charges = await provider.charges(org.tenant.id);
      expect(charges).toEqual([
        expect.objectContaining({ tenantId: org.tenant.id, period: '2025-10', amount: 2.468, quantity: 1234 }),
      ]);
      const { rows } = await db().query(`SELECT provider_ref FROM billing_events WHERE id = $1`, [eventId]);
      expect(rows[0].provider_ref).toBe(charges[0].id);
    });

    it('a sync after a failed attempt charges exactly once', async () => {
      const org = await createOrg();
      await createBillingEvent(org.tenant, { period: '2025-09', overageRequests: 10, amount: 0.02 });
      const real = process.env.BILLING_PROVIDER_URL;
      process.env.BILLING_PROVIDER_URL = 'http://127.0.0.1:9'; // nothing listens: connection refused
      try {
        const failed = await http(app).post('/api/v1/billing/sync').set(org.as('OWNER'));
        expect(failed.status).toBe(201);
        expect(failed.body).toMatchObject({ synced: 0, attempted: 1 });
      } finally {
        process.env.BILLING_PROVIDER_URL = real;
      }
      const retried = await http(app).post('/api/v1/billing/sync').set(org.as('OWNER'));
      expect(retried.body).toMatchObject({ synced: 1 });
      await http(app).post('/api/v1/billing/sync').set(org.as('OWNER'));
      expect(await provider.charges(org.tenant.id)).toHaveLength(1);
    });
  });

  describe('webhooks', () => {
    it('signs the exact body with the endpoint secret (HMAC-SHA256)', async () => {
      const org = await createOrg();
      const channel = `sig-${uid()}`;
      const { secret } = await createWebhookEndpoint(org.tenant, provider.webhookUrl(channel));
      await http(app).post('/api/v1/webhooks/test').set(org.as('OWNER'));

      const [delivery] = await eventually(async () => {
        const r = await provider.received(channel);
        return r.length ? r : null;
      });
      expect(delivery.type).toBe('test.ping');
      const expected = createHmac('sha256', secret).update(delivery.rawBody).digest('hex');
      expect(delivery.signature).toBe(expected);
    });

    it('retries 5xx responses up to 3 attempts and records each one', async () => {
      const org = await createOrg();
      const channel = `fail-${uid()}`;
      const hook = await createWebhookEndpoint(org.tenant, `${provider.webhookUrl(channel)}?status=503`);
      await http(app).post('/api/v1/webhooks/test').set(org.as('OWNER'));

      const { rows } = await db().query(
        `SELECT attempt, status, delivered_at FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY attempt`,
        [hook.id],
      );
      expect(rows.map((r) => [r.attempt, r.status, r.delivered_at])).toEqual([
        [1, 503, null],
        [2, 503, null],
        [3, 503, null],
      ]);
    });

    it('does not retry a 4xx response', async () => {
      const org = await createOrg();
      const channel = `bad-${uid()}`;
      const hook = await createWebhookEndpoint(org.tenant, `${provider.webhookUrl(channel)}?status=410`);
      await http(app).post('/api/v1/webhooks/test').set(org.as('OWNER'));
      const { rows } = await db().query(`SELECT attempt FROM webhook_deliveries WHERE endpoint_id = $1`, [hook.id]);
      expect(rows).toHaveLength(1);
    });

    it('refuses delivery to an endpoint that points at a private address (stored before validation existed)', async () => {
      const org = await createOrg();
      const hook = await createWebhookEndpoint(org.tenant, 'http://169.254.169.254/latest/meta-data/');
      await http(app).post('/api/v1/webhooks/test').set(org.as('OWNER'));
      const { rows } = await db().query(`SELECT attempt, status FROM webhook_deliveries WHERE endpoint_id = $1`, [hook.id]);
      expect(rows).toEqual([{ attempt: 1, status: null }]);
    });
  });
});
