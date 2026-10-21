import { INestApplication } from '@nestjs/common';
import { http, startApp, stopApp } from '../../support/app';
import {
  accessTokenFor,
  addMember,
  auditEntries,
  createApiKey,
  createOrg,
  createTenant,
  createUser,
  db,
  insertUsage,
  Org,
  uid,
} from '../../support/factories';

/**
 * Known, unfixed defects use `it.failing`: the test asserts the CORRECT behaviour and Jest
 * expects it to fail. The suite stays green while the defect exists, and the test turns red
 * as soon as the behaviour changes, so the marker must then be removed. Fixed defects use `it`.
 */
/**
 * Regression tests for security defects. Each asserts the CORRECT behaviour, so it fails
 * while the defect is present. See DEFECTS.md for the full reports.
 */
describe('Security defects', () => {
  let app: INestApplication;
  let acme: Org;

  beforeAll(async () => {
    app = await startApp();
    acme = await createOrg();
  });
  afterAll(() => stopApp(app));

  describe('DEF-001 usage export leaks other tenants\' data', () => {
    let foreignKeyName: string;
    let foreignKey: { id: string };

    beforeAll(async () => {
      const other = await createTenant({ plan: 'GROWTH' });
      foreignKeyName = `foreign-${uid()}`;
      foreignKey = await createApiKey(other, { name: foreignKeyName });
      await insertUsage(other, foreignKey, 3);
      const ownKey = await createApiKey(acme.tenant, { name: `own-${uid()}` });
      await insertUsage(acme.tenant, ownKey, 2);
    });

    it('export without keyId contains only the caller tenant\'s rows', async () => {
      const res = await http(app).get('/api/v1/usage/export').set(acme.as('VIEWER'));
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(foreignKeyName);
      expect(res.text.trim().split('\n')).toHaveLength(1 + 2); // header + own rows only
    });

    it('export with another tenant\'s keyId is refused', async () => {
      const res = await http(app)
        .get(`/api/v1/usage/export?keyId=${foreignKey.id}`)
        .set(acme.as('VIEWER'));
      expect(res.status).toBe(404);
      expect(res.text).not.toContain(foreignKeyName);
    });
  });

  describe('DEF-004 role escalation and last-owner protection', () => {
    let org: Org;
    beforeEach(async () => {
      org = await createOrg();
    });

    it('an ADMIN cannot promote themselves to OWNER', async () => {
      const res = await http(app)
        .patch(`/api/v1/memberships/${org.memberships.ADMIN}`)
        .set(org.as('ADMIN'))
        .send({ role: 'OWNER' });
      expect(res.status).toBe(403);
      const { rows } = await db().query(`SELECT role FROM memberships WHERE id = $1`, [org.memberships.ADMIN]);
      expect(rows[0].role).toBe('ADMIN');
    });

    it('an ADMIN cannot invite a new OWNER', async () => {
      const res = await http(app)
        .post('/api/v1/memberships/invite')
        .set(org.as('ADMIN'))
        .send({ email: `new-${uid()}@test.local`, role: 'OWNER' });
      expect(res.status).toBe(403);
    });

    it('an ADMIN cannot demote an OWNER', async () => {
      const res = await http(app)
        .patch(`/api/v1/memberships/${org.memberships.OWNER}`)
        .set(org.as('ADMIN'))
        .send({ role: 'VIEWER' });
      expect(res.status).toBe(403);
    });

    it('an ADMIN cannot demote an OWNER by re-inviting their email', async () => {
      const res = await http(app)
        .post('/api/v1/memberships/invite')
        .set(org.as('ADMIN'))
        .send({ email: org.users.OWNER.email, role: 'VIEWER' });
      expect(res.status).toBe(409);
      const { rows } = await db().query(`SELECT role FROM memberships WHERE id = $1`, [org.memberships.OWNER]);
      expect(rows[0].role).toBe('OWNER');
    });

    it('the last OWNER cannot demote themselves', async () => {
      const res = await http(app)
        .patch(`/api/v1/memberships/${org.memberships.OWNER}`)
        .set(org.as('OWNER'))
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(409);
    });

    it('the last OWNER cannot be removed', async () => {
      const res = await http(app)
        .delete(`/api/v1/memberships/${org.memberships.OWNER}`)
        .set(org.as('OWNER'));
      expect(res.status).toBe(409);
    });

    it('two OWNERs demoting each other concurrently cannot leave the tenant with no OWNER', async () => {
      const second = await createUser();
      const secondMembership = await addMember(org.tenant, second, 'OWNER');
      const asSecond = { authorization: `Bearer ${accessTokenFor(second)}`, 'x-tenant-id': org.tenant.id };

      await Promise.all([
        http(app).patch(`/api/v1/memberships/${secondMembership}`).set(org.as('OWNER')).send({ role: 'ADMIN' }),
        http(app).patch(`/api/v1/memberships/${org.memberships.OWNER}`).set(asSecond).send({ role: 'ADMIN' }),
      ]);

      const { rows } = await db().query(
        `SELECT count(*)::int AS owners FROM memberships WHERE tenant_id = $1 AND role = 'OWNER'`,
        [org.tenant.id],
      );
      expect(rows[0].owners).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DEF-008 VIEWER can read billing data', () => {
    it.each(['/api/v1/billing/events', '/api/v1/billing/invoice-preview'])('%s is refused for VIEWER', async (path) => {
      const res = await http(app).get(path).set(acme.as('VIEWER'));
      expect(res.status).toBe(403);
    });
  });

  describe('DEF-009 refresh token still works after logout', () => {
    it('refresh is rejected once the session is logged out', async () => {
      const login = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: acme.users.MEMBER.email, password: acme.users.MEMBER.password });
      expect(login.status).toBe(201);
      const { refreshToken } = login.body;

      const out = await http(app).post('/api/v1/auth/logout').send({ refreshToken });
      expect(out.status).toBe(201);

      const res = await http(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(401);
    });
  });

  describe('DEF-002 webhook URLs can target internal services (SSRF)', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:4000/api/v1/tenant',
      'http://127.0.0.1:6379/',
      'http://10.1.2.3/hook',
      'http://[::1]/hook',
      'file:///etc/passwd',
      'http://postgres:5432/',
    ])('rejects %s', async (url) => {
      const res = await http(app)
        .post('/api/v1/webhooks')
        .set(acme.as('OWNER'))
        .send({ label: 'ssrf', url });
      expect(res.status).toBe(400);
    });

    it('still accepts a public address', async () => {
      const res = await http(app)
        .post('/api/v1/webhooks')
        .set(acme.as('OWNER'))
        .send({ label: 'public', url: 'https://93.184.215.14/hook' });
      expect(res.status).toBe(201);
    });
  });

  describe('DEF-015 invited accounts get a password the inviter knows', () => {
    it.failing('an invited user cannot sign in with the default password', async () => {
      const email = `invitee-${uid()}@test.local`;
      const invite = await http(app)
        .post('/api/v1/memberships/invite')
        .set(acme.as('OWNER'))
        .send({ email, role: 'MEMBER' });
      expect(invite.status).toBe(201);

      const res = await http(app).post('/api/v1/auth/login').send({ email, password: 'ChangeMe123!' });
      expect(res.status).toBe(401);
    });
  });

  describe('DEF-025 CORS reflects any origin with credentials', () => {
    it.failing('does not allow an arbitrary origin', async () => {
      const res = await http(app)
        .options('/api/v1/tenant')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });
  });

  describe('DEF-023 privileged actions missing from the audit log', () => {
    it.failing('deleting a webhook endpoint is audited', async () => {
      const created = await http(app)
        .post('/api/v1/webhooks')
        .set(acme.as('OWNER'))
        .send({ label: 'to-delete', url: 'https://93.184.215.14/hook' });
      const del = await http(app).delete(`/api/v1/webhooks/${created.body.id}`).set(acme.as('OWNER'));
      expect(del.status).toBe(200);

      const entries = await auditEntries(acme.tenant.id, 'webhook.deleted');
      expect(entries.map((e) => e.target)).toContain(created.body.id);
    });

    it.failing('tenant updates record the previous values', async () => {
      await http(app).patch('/api/v1/tenant').set(acme.as('OWNER')).send({ name: `Renamed ${uid()}` });
      const entries = await auditEntries(acme.tenant.id, 'tenant.updated');
      expect(entries.at(-1).metadata).toHaveProperty('previous');
    });
  });
});
