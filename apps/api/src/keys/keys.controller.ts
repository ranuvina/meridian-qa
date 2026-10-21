import { Body, Controller, Delete, Get, Param, Post, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

@Controller('keys')
@UseGuards(JwtGuard, RolesGuard)
export class KeysController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  list(@Actor() actor: RequestActor) {
    return this.db.query(
      `SELECT id, name, prefix, revoked_at, last_used_at, created_at
         FROM api_keys
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [actor.tenantId],
    );
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  async create(@Actor() actor: RequestActor, @Body() body: { name?: string }) {
    if (!body?.name) throw new BadRequestException('name required');

    const prefix = 'mk_' + randomBytes(4).toString('hex');
    const secret = randomBytes(24).toString('hex');

    const key = await this.db.one(
      `INSERT INTO api_keys (tenant_id, name, prefix, secret_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, prefix, created_at`,
      [actor.tenantId, body.name, prefix, hashSecret(secret)],
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'key.created',
      target: key.id,
      metadata: { name: body.name },
    });

    return { ...key, secret: `${prefix}.${secret}` };
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async revoke(@Actor() actor: RequestActor, @Param('id') id: string) {
    const key = await this.db.one(
      `UPDATE api_keys SET revoked_at = now()
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
        RETURNING id, prefix`,
      [id, actor.tenantId],
    );
    if (!key) throw new NotFoundException('Key not found or already revoked');

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
