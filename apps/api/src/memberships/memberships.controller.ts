import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import type { MemberRole } from '../common/rbac';

const VALID_ROLES: MemberRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'BILLING'];

@Controller('memberships')
@UseGuards(JwtGuard, RolesGuard)
export class MembershipsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  list(@Actor() actor: RequestActor) {
    return this.db.query(
      `SELECT m.id, m.role, m.created_at, u.id AS user_id, u.email
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY u.email`,
      [actor.tenantId],
    );
  }

  @Post('invite')
  @Roles('OWNER', 'ADMIN')
  async invite(
    @Actor() actor: RequestActor,
    @Body() body: { email?: string; role?: MemberRole; password?: string },
  ) {
    if (!body?.email) throw new BadRequestException('email required');
    const role = body.role ?? 'MEMBER';
    if (!VALID_ROLES.includes(role)) throw new BadRequestException('invalid role');

    let user = await this.db.one(`SELECT id FROM users WHERE email = $1`, [body.email]);
    if (!user) {
      const hash = await bcrypt.hash(body.password || 'ChangeMe123!', 10);
      user = await this.db.one(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [body.email, hash],
      );
    }

    const membership = await this.db.one(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING id, role`,
      [actor.tenantId, user.id, role],
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'membership.invited',
      target: membership.id,
      metadata: { email: body.email, role },
    });
    return membership;
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  async updateRole(
    @Actor() actor: RequestActor,
    @Param('id') id: string,
    @Body() body: { role?: MemberRole },
  ) {
    if (!body?.role || !VALID_ROLES.includes(body.role)) {
      throw new BadRequestException('valid role required');
    }

    const membership = await this.db.one(
      `UPDATE memberships SET role = $3
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, user_id, role`,
      [id, actor.tenantId, body.role],
    );
    if (!membership) throw new NotFoundException('Membership not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'membership.role_changed',
      target: membership.id,
      metadata: { role: body.role },
    });
    return membership;
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async remove(@Actor() actor: RequestActor, @Param('id') id: string) {
    const membership = await this.db.one(
      `DELETE FROM memberships WHERE id = $1 AND tenant_id = $2 RETURNING id, user_id`,
      [id, actor.tenantId],
    );
    if (!membership) throw new NotFoundException('Membership not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'membership.removed',
      target: id,
      metadata: {},
    });
    return { ok: true };
  }
}
