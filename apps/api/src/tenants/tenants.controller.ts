import { BadRequestException, Body, Controller, Delete, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { effectiveRateLimit, planFor, PlanTier, validateRateLimitOverride } from '../common/plans';

function describeLimits(tenant: { plan: PlanTier; rate_limit_override: number | null }) {
  const plan = planFor(tenant.plan);
  const effective = effectiveRateLimit(tenant.plan, tenant.rate_limit_override);
  return {
    limits: {
      rateLimitPerMinute: effective,
      monthlyQuota: plan.monthlyQuota,
      overageRatePerRequest: plan.overageRatePerRequest,
    },
    rateLimit: {
      effective,
      planDefault: plan.rateLimitPerMinute,
      ceiling: plan.rateLimitCeiling,
      override: tenant.rate_limit_override,
    },
  };
}

@Controller('tenant')
@UseGuards(JwtGuard, RolesGuard)
export class TenantsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  async current(@Actor() actor: RequestActor) {
    const tenant = await this.db.one(
      `SELECT id, name, slug, plan, timezone, suspended, rate_limit_override, created_at
         FROM tenants WHERE id = $1`,
      [actor.tenantId],
    );
    const { rate_limit_override, ...rest } = tenant;
    return { ...rest, ...describeLimits(tenant) };
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

  /**
   * A1. OWNER only (spec). The row is locked so the audit entry's "previous" value is exact
   * even under concurrent updates, and the update and its audit entry commit together.
   */
  private async setOverride(actor: RequestActor, next: number | null, validate: boolean) {
    return this.db.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT plan, rate_limit_override FROM tenants WHERE id = $1 FOR UPDATE`,
        [actor.tenantId],
      );
      const current = rows[0];
      if (validate) {
        const check = validateRateLimitOverride(current.plan, next);
        if (!check.ok) throw new BadRequestException(check.reason);
      }
      const previous: number | null = current.rate_limit_override;

      const { rows: updated } = await client.query(
        `UPDATE tenants SET rate_limit_override = $2 WHERE id = $1
         RETURNING plan, rate_limit_override`,
        [actor.tenantId, next],
      );
      if (previous !== next) {
        await client.query(
          `INSERT INTO audit_log (tenant_id, actor_id, action, target, metadata)
           VALUES ($1, $2, $3, $1, $4)`,
          [
            actor.tenantId,
            actor.userId,
            next === null ? 'tenant.rate_limit_override.removed' : 'tenant.rate_limit_override.set',
            JSON.stringify({ previous, new: next }),
          ],
        );
      }
      return describeLimits(updated[0]).rateLimit;
    });
  }

  @Patch('rate-limit')
  @Roles('OWNER')
  setRateLimit(@Actor() actor: RequestActor, @Body() body: { rateLimitPerMinute?: unknown }) {
    return this.setOverride(actor, body?.rateLimitPerMinute as number, true);
  }

  /** Idempotent: removing a non-existent override returns 200 and writes no audit entry. */
  @Delete('rate-limit')
  @Roles('OWNER')
  clearRateLimit(@Actor() actor: RequestActor) {
    return this.setOverride(actor, null, false);
  }

  @Get('audit-log')
  @Roles('OWNER', 'ADMIN')
  auditLog(@Actor() actor: RequestActor) {
    return this.audit.list(actor.tenantId);
  }
}
