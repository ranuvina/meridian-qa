import { readFileSync } from 'fs';
import { join } from 'path';
import { createApiKey, createUser, addMember, createWebhookEndpoint, Org, uid } from './factories';
import type { MemberRole } from '../../src/common/rbac';

/**
 * The dashboard API surface, one entry per endpoint. Each builder creates whatever fresh
 * resources its call needs inside the given org, so every call can succeed for an
 * authorised role and no two test cases share mutable state.
 */
export interface Call {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  body?: Record<string, unknown>;
}
export type CallBuilder = (org: Org) => Promise<Call>;

// The mock receiver answers immediately, so POST /webhooks/test stays fast however many
// endpoints accumulate in a shared org.
const receiverUrl = () => `${process.env.BILLING_PROVIDER_URL}/_webhook/matrix-${uid(3)}`;

export const ENDPOINTS: Record<string, CallBuilder> = {
  'GET /tenant': async () => ({ method: 'get', path: '/api/v1/tenant' }),
  'PATCH /tenant': async () => ({ method: 'patch', path: '/api/v1/tenant', body: { name: `Renamed ${uid(3)}` } }),
  'GET /tenant/audit-log': async () => ({ method: 'get', path: '/api/v1/tenant/audit-log' }),
  'GET /memberships': async () => ({ method: 'get', path: '/api/v1/memberships' }),
  'POST /memberships/invite': async () => ({
    method: 'post',
    path: '/api/v1/memberships/invite',
    body: { email: `inv-${uid()}@test.local`, role: 'VIEWER' },
  }),
  'PATCH /memberships/:id': async (org) => {
    const id = await addMember(org.tenant, await createUser(), 'VIEWER');
    return { method: 'patch', path: `/api/v1/memberships/${id}`, body: { role: 'MEMBER' } };
  },
  'DELETE /memberships/:id': async (org) => {
    const id = await addMember(org.tenant, await createUser(), 'VIEWER');
    return { method: 'delete', path: `/api/v1/memberships/${id}` };
  },
  'GET /keys': async () => ({ method: 'get', path: '/api/v1/keys' }),
  'POST /keys': async () => ({ method: 'post', path: '/api/v1/keys', body: { name: `k-${uid(3)}` } }),
  'DELETE /keys/:id': async (org) => {
    const key = await createApiKey(org.tenant);
    return { method: 'delete', path: `/api/v1/keys/${key.id}` };
  },
  'GET /usage/summary': async () => ({ method: 'get', path: '/api/v1/usage/summary' }),
  'GET /usage/daily': async () => ({ method: 'get', path: '/api/v1/usage/daily' }),
  'GET /usage/export': async () => ({ method: 'get', path: '/api/v1/usage/export' }),
  'GET /billing/events': async () => ({ method: 'get', path: '/api/v1/billing/events' }),
  'GET /billing/invoice-preview': async () => ({ method: 'get', path: '/api/v1/billing/invoice-preview' }),
  'POST /billing/sync': async () => ({ method: 'post', path: '/api/v1/billing/sync' }),
  'GET /webhooks': async () => ({ method: 'get', path: '/api/v1/webhooks' }),
  'POST /webhooks': async () => ({ method: 'post', path: '/api/v1/webhooks', body: { label: 'w', url: receiverUrl() } }),
  'POST /webhooks/test': async () => ({ method: 'post', path: '/api/v1/webhooks/test' }),
  'DELETE /webhooks/:id': async (org) => {
    const hook = await createWebhookEndpoint(org.tenant, receiverUrl());
    return { method: 'delete', path: `/api/v1/webhooks/${hook.id}` };
  },
  'GET /webhooks/deliveries': async () => ({ method: 'get', path: '/api/v1/webhooks/deliveries' }),
};

/** Which endpoints exercise each capability row of docs/rbac-matrix.md. */
export const CAPABILITY_ENDPOINTS: Record<string, string[]> = {
  'View tenant settings': ['GET /tenant'],
  'Update tenant settings': ['PATCH /tenant'],
  'View audit log': ['GET /tenant/audit-log'],
  'List members': ['GET /memberships'],
  'Invite members': ['POST /memberships/invite'],
  'Change member role': ['PATCH /memberships/:id'],
  'Remove members': ['DELETE /memberships/:id'],
  'List API keys': ['GET /keys'],
  'Create API key': ['POST /keys'],
  'Revoke API key': ['DELETE /keys/:id'],
  'View usage': ['GET /usage/summary', 'GET /usage/daily'],
  'Export usage CSV': ['GET /usage/export'],
  'View billing events': ['GET /billing/events'],
  'View invoice preview': ['GET /billing/invoice-preview'],
  'Sync billing to provider': ['POST /billing/sync'],
  'Manage webhook endpoints': ['POST /webhooks', 'DELETE /webhooks/:id', 'POST /webhooks/test'],
  'List webhook endpoints': ['GET /webhooks'],
  'View webhook deliveries': ['GET /webhooks/deliveries'],
};

export interface MatrixRow {
  capability: string;
  allowed: Record<MemberRole, boolean>;
}

/** Parses the specification table, so the tests follow the document rather than a copy of it. */
export function readRbacMatrix(): MatrixRow[] {
  const md = readFileSync(join(__dirname, '../../../../docs/rbac-matrix.md'), 'utf8');
  const lines = md.split('\n').filter((l) => l.startsWith('|'));
  const header = lines[0].split('|').map((c) => c.trim()).filter(Boolean);
  const roles = header.slice(1) as MemberRole[];
  return lines.slice(2).map((line) => {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    const allowed = {} as Record<MemberRole, boolean>;
    roles.forEach((role, i) => {
      const cell = cells[i + 1];
      if (cell !== '✅' && cell !== '❌') throw new Error(`Unreadable matrix cell "${cell}" in: ${line}`);
      allowed[role] = cell === '✅';
    });
    return { capability: cells[0], allowed };
  });
}
