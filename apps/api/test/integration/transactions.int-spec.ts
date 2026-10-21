import { INestApplication } from '@nestjs/common';
import { http, startApp, stopApp } from '../support/app';
import { auditEntries, createApiKey, createOrg, db } from '../support/factories';

/** Transaction behaviour: changes and their audit entries commit together or not at all. */
describe('Transactions', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => stopApp(app));

  /** Makes audit inserts fail for one tenant only, so parallel tests are unaffected. */
  async function breakAuditFor(tenantId: string) {
    const fn = `fail_audit_${tenantId.replace(/-/g, '')}`;
    await db().query(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log
        FOR EACH ROW WHEN (NEW.tenant_id = '${tenantId}') EXECUTE FUNCTION ${fn}();`);
    return async () => {
      await db().query(`DROP TRIGGER IF EXISTS ${fn} ON audit_log; DROP FUNCTION IF EXISTS ${fn}();`);
    };
  }

  it('A1: if the audit entry cannot be written, the rate-limit override is not changed', async () => {
    const org = await createOrg({ plan: 'GROWTH' });
    const restore = await breakAuditFor(org.tenant.id);
    try {
      const res = await http(app).patch('/api/v1/tenant/rate-limit').set(org.as('OWNER')).send({ rateLimitPerMinute: 2500 });
      expect(res.status).toBe(500);
    } finally {
      await restore();
    }
    const { rows } = await db().query(`SELECT rate_limit_override FROM tenants WHERE id = $1`, [org.tenant.id]);
    expect(rows[0].rate_limit_override).toBeNull();
  });

  it('A2: if the audit entry cannot be written, the key is not rotated', async () => {
    const org = await createOrg();
    const key = await createApiKey(org.tenant);
    const restore = await breakAuditFor(org.tenant.id);
    try {
      const res = await http(app).post(`/api/v1/keys/${key.id}/rotate`).set(org.as('OWNER')).send({});
      expect(res.status).toBe(500);
    } finally {
      await restore();
    }
    expect((await http(app).get('/api/v1/gw/ping').set('x-api-key', key.secret)).status).toBe(200);
    const { rows } = await db().query(`SELECT rotated_at FROM api_keys WHERE id = $1`, [key.id]);
    expect(rows[0].rotated_at).toBeNull();
  });

  it('A2: concurrent rotations leave exactly one current secret and a consistent audit trail', async () => {
    const org = await createOrg();
    const key = await createApiKey(org.tenant);
    const [r1, r2] = await Promise.all([
      http(app).post(`/api/v1/keys/${key.id}/rotate`).set(org.as('OWNER')).send({ gracePeriodSeconds: 60 }),
      http(app).post(`/api/v1/keys/${key.id}/rotate`).set(org.as('ADMIN')).send({ gracePeriodSeconds: 60 }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);

    const ping = async (secret: string) => (await http(app).get('/api/v1/gw/ping').set('x-api-key', secret)).status;
    const results = [await ping(r1.body.secret), await ping(r2.body.secret), await ping(key.secret)];
    // Rotations are serialised by the row lock: the later one is current, the earlier one is in
    // grace, and the original secret (superseded twice) no longer works.
    expect(results.filter((s) => s === 200)).toHaveLength(2);
    expect(results[2]).toBe(401);
    expect(await auditEntries(org.tenant.id, 'key.rotated')).toHaveLength(2);
  });

  it('A1: concurrent override changes record an exact previous -> new chain', async () => {
    const org = await createOrg({ plan: 'SCALE' });
    const values = [6000, 7000, 8000, 9000, 10000];
    await Promise.all(
      values.map((v) => http(app).patch('/api/v1/tenant/rate-limit').set(org.as('OWNER')).send({ rateLimitPerMinute: v })),
    );
    const entries = await auditEntries(org.tenant.id, 'tenant.rate_limit_override.set');
    expect(entries).toHaveLength(values.length);
    // created_at is the transaction START time, so it does not show commit order. Instead,
    // follow the links: starting from "no override", each entry's `new` must be exactly one
    // other entry's `previous`, forming a single unbroken chain that ends at the stored value.
    const byPrevious = new Map(entries.map((e) => [e.metadata.previous, e.metadata.new]));
    expect(byPrevious.size).toBe(values.length);
    const chain: Array<number | null> = [null];
    while (byPrevious.has(chain.at(-1))) chain.push(byPrevious.get(chain.at(-1)));
    expect(chain).toHaveLength(values.length + 1);
    const { rows } = await db().query(`SELECT rate_limit_override FROM tenants WHERE id = $1`, [org.tenant.id]);
    expect(rows[0].rate_limit_override).toBe(chain.at(-1));
  });
});
