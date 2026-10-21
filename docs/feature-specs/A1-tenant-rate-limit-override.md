# A1 — Tenant rate limit override

## Background

Rate limits are currently derived from the tenant's plan tier. Sales has asked for the ability to
raise a specific tenant's limit without moving them to a different plan.

## Requirement

An OWNER can set a custom requests-per-minute limit for their tenant.

```
PATCH /api/v1/tenant/rate-limit
{ "rateLimitPerMinute": 2500 }
```

```
DELETE /api/v1/tenant/rate-limit
```
Removes the override and returns the tenant to their plan default.

The current effective limit must be visible on `GET /api/v1/tenant`.

## Rules

- The override may not exceed the ceiling for the tenant's plan.
- Plan ceilings: FREE 500, GROWTH 5,000, SCALE 25,000.
- The change takes effect on the next request through the gateway.
- The override survives a plan change.
- Changes are recorded in the audit log with the previous and new values.

## Notes

Sales have asked whether an override below the plan default should be permitted for tenants
who are abusing the service. Product has not decided.
