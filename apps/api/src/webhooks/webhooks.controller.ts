import { Body, Controller, Delete, Get, Param, Post, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { WebhooksService } from './webhooks.service';
import { AuditService } from '../audit/audit.service';

@Controller('webhooks')
@UseGuards(JwtGuard, RolesGuard)
export class WebhooksController {
  constructor(
    private readonly db: DbService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Actor() actor: RequestActor) {
    return this.db.query(
      `SELECT id, label, url, active, created_at
         FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [actor.tenantId],
    );
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async create(@Actor() actor: RequestActor, @Body() body: { label?: string; url?: string }) {
    if (!body?.url || !body?.label) throw new BadRequestException('label and url required');
    const secret = randomBytes(16).toString('hex');
    const endpoint = await this.db.one(
      `INSERT INTO webhook_endpoints (tenant_id, label, url, secret)
       VALUES ($1, $2, $3, $4) RETURNING id, label, url, active`,
      [actor.tenantId, body.label, body.url, secret],
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'webhook.created',
      target: endpoint.id,
      metadata: { url: body.url },
    });
    return { ...endpoint, secret };
  }

  @Get('deliveries')
  deliveries(@Actor() actor: RequestActor) {
    return this.db.query(
      `SELECT d.id, d.event_id, d.event_type, d.attempt, d.status, d.delivered_at, d.created_at, e.label
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE e.tenant_id = $1
        ORDER BY d.created_at DESC LIMIT 200`,
      [actor.tenantId],
    );
  }

  @Post('test')
  @Roles('OWNER', 'ADMIN')
  test(@Actor() actor: RequestActor) {
    return this.webhooks.dispatch(actor.tenantId, 'test.ping', { at: new Date().toISOString() });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async remove(@Actor() actor: RequestActor, @Param('id') id: string) {
    const row = await this.db.one(
      `DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, actor.tenantId],
    );
    if (!row) throw new NotFoundException('Endpoint not found');
    return { ok: true };
  }
}
