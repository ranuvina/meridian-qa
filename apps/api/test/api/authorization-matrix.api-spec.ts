import { INestApplication } from '@nestjs/common';
import { http, startApp, stopApp } from '../support/app';
import { accessTokenFor, createOrg, createUser, Org, ROLES } from '../support/factories';
import { CAPABILITY_ENDPOINTS, Call, ENDPOINTS, FEATURE_CAPABILITIES, readRbacMatrix } from '../support/surface';

/**
 * Role x endpoint x tenant authorisation matrix.
 *
 *  - role:   every capability row of docs/rbac-matrix.md x 5 roles, through every endpoint
 *            that implements the capability (allowed -> 2xx, denied -> 403)
 *  - tenant: every endpoint as a non-member of the tenant named in x-tenant-id (-> 403),
 *            as a member of a different tenant (-> 403), and unauthenticated (-> 401)
 */
const matrix = readRbacMatrix();

const send = (app: INestApplication, call: Call, headers: Record<string, string>) => {
  const req = http(app)[call.method](call.path).set(headers);
  return call.body ? req.send(call.body) : req;
};

describe('Authorisation matrix', () => {
  let app: INestApplication;
  let org: Org;

  beforeAll(async () => {
    app = await startApp();
    org = await createOrg({ plan: 'GROWTH' });
  });
  afterAll(() => stopApp(app));

  it('maps every capability in the specification to at least one endpoint', () => {
    const unmapped = matrix.map((r) => r.capability).filter((c) => !CAPABILITY_ENDPOINTS[c]);
    expect(unmapped).toEqual([]);
    const mappedEndpoints = new Set(Object.values(CAPABILITY_ENDPOINTS).flat());
    expect([...mappedEndpoints].filter((e) => !ENDPOINTS[e])).toEqual([]);
  });

  const cases = [
    ...matrix.flatMap((row) =>
      (CAPABILITY_ENDPOINTS[row.capability] ?? []).flatMap((endpoint) =>
        ROLES.map((role) => ({ capability: row.capability, endpoint, role, allowed: row.allowed[role] })),
      ),
    ),
    ...Object.entries(FEATURE_CAPABILITIES).flatMap(([capability, spec]) =>
      spec.endpoints.flatMap((endpoint) =>
        ROLES.map((role) => ({ capability, endpoint, role, allowed: spec.roles.includes(role) })),
      ),
    ),
  ];

  it('covers every endpoint of the surface', () => {
    expect(new Set(cases.map((c) => c.endpoint))).toEqual(new Set(Object.keys(ENDPOINTS)));
  });

  it.each(cases)('$capability | $endpoint | $role -> allowed=$allowed', async ({ endpoint, role, allowed }) => {
    const call = await ENDPOINTS[endpoint](org);
    const res = await send(app, call, org.as(role));
    if (allowed) {
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    } else {
      expect(res.status).toBe(403);
    }
  });

  describe('tenant boundary', () => {
    let outsider: Org;
    beforeAll(async () => {
      outsider = await createOrg();
    });

    it.each(Object.keys(ENDPOINTS))('%s: an OWNER of another tenant gets 403', async (endpoint) => {
      const call = await ENDPOINTS[endpoint](org);
      const headers = { ...outsider.as('OWNER'), 'x-tenant-id': org.tenant.id };
      expect((await send(app, call, headers)).status).toBe(403);
    });

    it.each(Object.keys(ENDPOINTS))('%s: a user with no memberships gets 403', async (endpoint) => {
      const loner = await createUser();
      const call = await ENDPOINTS[endpoint](org);
      const headers = { authorization: `Bearer ${accessTokenFor(loner)}`, 'x-tenant-id': org.tenant.id };
      expect((await send(app, call, headers)).status).toBe(403);
    });

    it.each(Object.keys(ENDPOINTS))('%s: unauthenticated gets 401', async (endpoint) => {
      const call = await ENDPOINTS[endpoint](org);
      expect((await send(app, call, { 'x-tenant-id': org.tenant.id })).status).toBe(401);
    });

    it.each(Object.keys(ENDPOINTS))('%s: an expired access token gets 401', async (endpoint) => {
      const call = await ENDPOINTS[endpoint](org);
      const headers = { authorization: `Bearer ${accessTokenFor(org.users.OWNER, -10)}`, 'x-tenant-id': org.tenant.id };
      expect((await send(app, call, headers)).status).toBe(401);
    });
  });
});
