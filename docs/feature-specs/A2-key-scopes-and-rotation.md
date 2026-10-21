# A2 — API key scopes and rotation

## Background

API keys currently grant full access to every gateway route. Customers on SCALE have asked for
read-only keys for their analytics tooling, and for a way to rotate a key without downtime.

## Scopes

A key carries one or more scopes. Supported values: `read`, `write`.

- `read` permits `GET` routes under `/api/v1/gw`.
- `write` permits `POST` routes under `/api/v1/gw`.
- Scopes are set at creation time and returned on `GET /api/v1/keys`.
- A request outside the key's scope returns 403.
- Existing keys must continue to work.

```
POST /api/v1/keys
{ "name": "Analytics", "scopes": ["read"] }
```

## Rotation

```
POST /api/v1/keys/:id/rotate
{ "gracePeriodSeconds": 3600 }
```

Issues a new secret for the key and returns it. The previous secret continues to authenticate
until the grace period expires, after which it is rejected.

- Default grace period: 3600 seconds. Maximum: 86400.
- A grace period of 0 invalidates the old secret immediately.
- Usage recorded during the grace period is attributed to the same key.
- Rotation is recorded in the audit log.

## Rules

- Rotation requires OWNER or ADMIN.
- A revoked key cannot be rotated.
- Rate limit and quota accounting must not reset on rotation.
