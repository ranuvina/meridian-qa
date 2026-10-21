import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { DbService } from '../db/db.service';
import { RedisService } from '../db/redis.service';

export type KeyScope = 'read' | 'write';

export interface ResolvedKey {
  keyId: string;
  tenantId: string;
  prefix: string;
  plan: string;
  timezone: string;
  suspended: boolean;
  rateLimitOverride: number | null;
  scopes: KeyScope[];
  /** True when the request authenticated with the pre-rotation secret inside its grace period. */
  viaPreviousSecret: boolean;
}

/** Cached per prefix in Redis (shared by every API replica) and invalidated on revoke/rotate. */
interface CachedKeyRecord {
  id: string;
  tenantId: string;
  prefix: string;
  secretHash: string;
  previousSecretHash: string | null;
  previousSecretExpiresAt: number | null; // epoch ms
  scopes: KeyScope[];
}

export const KEY_CACHE_TTL_SECONDS = 60;

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function sameHash(a: string, b: string | null): boolean {
  if (!b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly db: DbService, private readonly redis: RedisService) {}

  static cacheKey(prefix: string) {
    return `keycache:${prefix}`;
  }

  /** Must be called after any change to a key's secret, scopes or revocation (DEF-005). */
  async invalidate(prefix: string) {
    await this.redis.client.del(ApiKeyService.cacheKey(prefix));
  }

  private async loadRecord(prefix: string): Promise<CachedKeyRecord | null> {
    const cached = await this.redis.client.get(ApiKeyService.cacheKey(prefix));
    if (cached) return cached === 'null' ? null : JSON.parse(cached);

    const row = await this.db.one(
      `SELECT id, tenant_id, prefix, secret_hash, previous_secret_hash,
              previous_secret_expires_at, scopes
         FROM api_keys
        WHERE prefix = $1 AND revoked_at IS NULL`,
      [prefix],
    );
    const record: CachedKeyRecord | null = row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          prefix: row.prefix,
          secretHash: row.secret_hash,
          previousSecretHash: row.previous_secret_hash,
          previousSecretExpiresAt: row.previous_secret_expires_at
            ? new Date(row.previous_secret_expires_at).getTime()
            : null,
          scopes: row.scopes,
        }
      : null;
    // Misses are cached briefly too, but in Redis with a TTL, so unknown keys cannot
    // grow process memory without bound (DEF-027).
    await this.redis.client.set(
      ApiKeyService.cacheKey(prefix),
      JSON.stringify(record),
      'EX',
      record ? KEY_CACHE_TTL_SECONDS : 5,
    );
    return record;
  }

  async resolve(rawKey: string): Promise<ResolvedKey | null> {
    const raw = String(rawKey);
    const dot = raw.indexOf('.');
    if (dot <= 0 || dot === raw.length - 1) return null;
    const prefix = raw.slice(0, dot);
    const secret = raw.slice(dot + 1);

    const record = await this.loadRecord(prefix);
    if (!record) return null;

    const hash = hashSecret(secret);
    let viaPreviousSecret = false;
    if (!sameHash(hash, record.secretHash)) {
      const graceOk =
        record.previousSecretExpiresAt !== null && record.previousSecretExpiresAt > Date.now();
      if (!graceOk || !sameHash(hash, record.previousSecretHash)) return null;
      viaPreviousSecret = true;
    }

    // Tenant state is read live (one primary-key lookup) so plan, override and suspension
    // changes apply on the next request (A1: "takes effect on the next request").
    const tenant = await this.db.one(
      `SELECT plan, timezone, suspended, rate_limit_override FROM tenants WHERE id = $1`,
      [record.tenantId],
    );
    if (!tenant) return null;

    return {
      keyId: record.id,
      tenantId: record.tenantId,
      prefix: record.prefix,
      plan: tenant.plan,
      timezone: tenant.timezone,
      suspended: tenant.suspended,
      rateLimitOverride: tenant.rate_limit_override,
      scopes: record.scopes,
      viaPreviousSecret,
    };
  }
}
