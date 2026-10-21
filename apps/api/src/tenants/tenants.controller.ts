import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { planFor, PlanTier } from '../common/plans';

@Controller('tenant')
@UseGuards(JwtGuard, RolesGuard)
export class TenantsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  async current(@Actor() actor: RequestActor) {
    const tenant = await this.db.one(
      `SELECT id, name, slug, plan, timezone, suspended, created_at
         FROM tenants WHERE id = $1`,
      [actor.tenantId],
    );
    return { ...tenant, limits: planFor(tenant.plan as PlanTier) };
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  async update(
    @Actor() actor: RequestActor,
    @Body() body: { name?: string; timezone?: string },
  ) {
    const tenant = await this.db.one(
      `UPDATE tenants
          SET name = COALESCE($2, name),
              timezone = COALESCE($3, timezone)
        WHERE id = $1
        RETURNING id, name, slug, plan, timezone, suspended`,
      [actor.tenantId, body.name ?? null, body.timezone ?? null],
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'tenant.updated',
      target: actor.tenantId,
      metadata: body as Record<string, unknown>,
    });
    return tenant;
  }

  @Get('audit-log')
  @Roles('OWNER', 'ADMIN')
  auditLog(@Actor() actor: RequestActor) {
    return this.audit.list(actor.tenantId);
  }
}
