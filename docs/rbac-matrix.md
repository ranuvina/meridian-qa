# Role and Permission Matrix

This document is the specification. Where behaviour differs from this table, the table is correct.

Roles are scoped per tenant. A user may hold different roles in different tenants.

| Capability | OWNER | ADMIN | BILLING | MEMBER | VIEWER |
|---|:--:|:--:|:--:|:--:|:--:|
| View tenant settings | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update tenant settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| List members | ✅ | ✅ | ✅ | ✅ | ✅ |
| Invite members | ✅ | ✅ | ❌ | ❌ | ❌ |
| Change member role | ✅ | ✅ | ❌ | ❌ | ❌ |
| Remove members | ✅ | ✅ | ❌ | ❌ | ❌ |
| List API keys | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create API key | ✅ | ✅ | ❌ | ✅ | ❌ |
| Revoke API key | ✅ | ✅ | ❌ | ❌ | ❌ |
| View usage | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export usage CSV | ✅ | ✅ | ✅ | ✅ | ✅ |
| View billing events | ✅ | ✅ | ✅ | ❌ | ❌ |
| View invoice preview | ✅ | ✅ | ✅ | ❌ | ❌ |
| Sync billing to provider | ✅ | ❌ | ✅ | ❌ | ❌ |
| Manage webhook endpoints | ✅ | ✅ | ❌ | ❌ | ❌ |
| List webhook endpoints | ✅ | ✅ | ✅ | ✅ | ✅ |
| View webhook deliveries | ✅ | ✅ | ✅ | ✅ | ✅ |

## Role escalation

A member may not be granted a role higher than the role held by the actor performing the change.
An OWNER may not remove or demote the last remaining OWNER of a tenant.

## Tenant isolation

Every request is scoped to the tenant identified by the `x-tenant-id` header. No endpoint may
return, modify or reference data belonging to any other tenant, regardless of the identifiers
supplied in the request body, query string or path.
