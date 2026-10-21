import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { ApiKeyService, hashSecret, KeyScope } from '../gateway/api-key.service';

export { hashSecret };

export const VALID_SCOPES: KeyScope[] = ['read', 'write'];
export const DEFAULT_GRACE_SECONDS = 3600;
export const MAX_GRACE_SECONDS = 86_400;

/** A2: omitted -> full access (keeps existing clients working); otherwise a non-empty subset. */
export function parseScopes(raw: unknown): KeyScope[] {
  if (raw === undefined) return [...VALID_SCOPES];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException('scopes must be a non-empty array of "read" and/or "write"');
  }
  const invalid = raw.filter((s) => !(VALID_SCOPES as unknown[]).includes(s));
  if (invalid.length) throw new BadRequestException(`unknown scope(s): ${invalid.join(', ')}`);
  return VALID_SCOPES.filter((s) => raw.includes(s)); // de-duplicated, canonical order
}

export function parseGracePeriod(raw: unknown): number {
  if (raw === undefined) return DEFAULT_GRACE_SECONDS;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_GRACE_SECONDS) {
    throw new BadRequestException(`gracePeriodSeconds must be an integer between 0 and ${MAX_GRACE_SECONDS}`);
  }
  return raw;
}

const newSecret = () => randomBytes(24).toString('hex');

@Controller('keys')
@UseGuards(JwtGuard, RolesGuard)
export class KeysController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly keyCache: ApiKeyService,
  ) {}

  @Get()
  list(@Actor() actor: RequestActor) {
    return this.db.query(
      `SELECT id, name, prefix, scopes, revoked_at, last_used_at, rotated_at,
              previous_secret_expires_at, created_at
         FROM api_keys
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [actor.tenantId],
    );
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  async create(@Actor() actor: RequestActor, @Body() body: { name?: string; scopes?: unknown }) {
    if (!body?.name || typeof body.name !== 'string') throw new BadRequestException('name required');
    const scopes = parseScopes(body.scopes);

    const prefix = 'mk_' + randomBytes(4).toString('hex');
    const secret = newSecret();

    const key = await this.db.one(
      `INSERT INTO api_keys (tenant_id, name, prefix, secret_hash, scopes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, prefix, scopes, created_at`,
      [actor.tenantId, body.name, prefix, hashSecret(secret), scopes],
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'key.created',
      target: key.id,
      metadata: { name: body.name, scopes },
    });

    return { ...key, secret: `${prefix}.${secret}` };
  }

  /**
   * A2 rotation. The key keeps its id and prefix, so usage, rate limit and quota accounting
   * continue unchanged. The old secret becomes `previous_secret_hash` until the grace period
   * ends. Only one previous secret is kept: rotating again ends the earlier grace immediately.
   */
  @Post(':id/rotate')
  @Roles('OWNER', 'ADMIN')
  async rotate(
    @Actor() actor: RequestActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { gracePeriodSeconds?: unknown },
  ) {
    const grace = parseGracePeriod(body?.gracePeriodSeconds);
    const secret = newSecret();

    const result = await this.db.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, prefix, revoked_at FROM api_keys WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, actor.tenantId],
      );
      const existing = rows[0];
      if (!existing) throw new NotFoundException('Key not found');
      if (existing.revoked_at) throw new ConflictException('A revoked key cannot be rotated');

      const { rows: updated } = await client.query(
        `UPDATE api_keys
            SET previous_secret_hash = CASE WHEN $3::int > 0 THEN secret_hash ELSE NULL END,
                previous_secret_expires_at = CASE WHEN $3::int > 0
                                                  THEN now() + make_interval(secs => $3::int)
                                                  ELSE NULL END,
                secret_hash = $4,
                rotated_at = now()
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, name, prefix, scopes, rotated_at, previous_secret_expires_at`,
        [id, actor.tenantId, grace, hashSecret(secret)],
      );
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor_id, action, target, metadata)
         VALUES ($1, $2, 'key.rotated', $3, $4)`,
        [
          actor.tenantId,
          actor.userId,
          id,
          JSON.stringify({ prefix: existing.prefix, gracePeriodSeconds: grace }),
        ],
      );
      return updated[0];
    });

    await this.keyCache.invalidate(result.prefix);
    return { ...result, gracePeriodSeconds: grace, secret: `${result.prefix}.${secret}` };
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async revoke(@Actor() actor: RequestActor, @Param('id', new ParseUUIDPipe()) id: string) {
    const key = await this.db.one(
      `UPDATE api_keys SET revoked_at = now(), previous_secret_hash = NULL, previous_secret_expires_at = NULL
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
        RETURNING id, prefix`,
      [id, actor.tenantId],
    );
    if (!key) throw new NotFoundException('Key not found or already revoked');

    // DEF-005 / SUP-1051: revocation must take effect on the next request.
    await this.keyCache.invalidate(key.prefix);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'key.revoked',
      target: id,
      metadata: { prefix: key.prefix },
    });
    return { ok: true };
  }
}
