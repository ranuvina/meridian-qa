import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { canGrantRole, canManageMember, isRole, MemberRole } from '../common/rbac';

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
    if (!isRole(role)) throw new BadRequestException('invalid role');
    if (!canGrantRole(actor.role, role)) {
      throw new ForbiddenException(`${actor.role} may not grant ${role}`);
    }

    let user = await this.db.one(`SELECT id FROM users WHERE email = $1`, [body.email]);
    if (!user) {
      // DEF-015 (not fixed; needs an invite-acceptance flow): inviter-known initial password.
      const hash = await bcrypt.hash(body.password || 'ChangeMe123!', 10);
      user = await this.db.one(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [body.email, hash],
      );
    }

    // DEF-004: inviting an existing member used to overwrite their role silently
    // (ON CONFLICT DO UPDATE), which let an ADMIN demote an OWNER. Role changes go through PATCH.
    const membership = await this.db.one(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO NOTHING
       RETURNING id, role`,
      [actor.tenantId, user.id, role],
    );
    if (!membership) throw new ConflictException('User is already a member of this tenant');

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'membership.invited',
      target: membership.id,
      metadata: { email: body.email, role },
    });
    return membership;
  }

  /**
   * Locks every OWNER row of the tenant plus the target row, so the "last owner" check
   * cannot be raced by two owners demoting or removing each other at the same time.
   */
  private async lockForChange(client: PoolClient, tenantId: string, id: string) {
    const { rows: owners } = await client.query(
      `SELECT id FROM memberships WHERE tenant_id = $1 AND role = 'OWNER' ORDER BY id FOR UPDATE`,
      [tenantId],
    );
    const { rows } = await client.query(
      `SELECT id, user_id, role FROM memberships WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, tenantId],
    );
    if (!rows[0]) throw new NotFoundException('Membership not found');
    return { target: rows[0] as { id: string; user_id: string; role: MemberRole }, ownerCount: owners.length };
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  async updateRole(
    @Actor() actor: RequestActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { role?: MemberRole },
  ) {
    if (!isRole(body?.role)) throw new BadRequestException('valid role required');
    const next = body.role;
    if (!canGrantRole(actor.role, next)) throw new ForbiddenException(`${actor.role} may not grant ${next}`);

    const result = await this.db.tx(async (client) => {
      const { target, ownerCount } = await this.lockForChange(client, actor.tenantId, id);
      if (!canManageMember(actor.role, target.role)) {
        throw new ForbiddenException(`${actor.role} may not change a ${target.role}`);
      }
      if (target.role === 'OWNER' && next !== 'OWNER' && ownerCount <= 1) {
        throw new ConflictException('Cannot demote the last remaining OWNER');
      }
      const { rows } = await client.query(
        `UPDATE memberships SET role = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id, user_id, role`,
        [id, actor.tenantId, next],
      );
      return { membership: rows[0], previous: target.role };
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'membership.role_changed',
      target: id,
      metadata: { role: next, previous: result.previous },
    });
    return result.membership;
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async remove(@Actor() actor: RequestActor, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.tx(async (client) => {
      const { target, ownerCount } = await this.lockForChange(client, actor.tenantId, id);
      if (!canManageMember(actor.role, target.role)) {
        throw new ForbiddenException(`${actor.role} may not remove a ${target.role}`);
      }
      if (target.role === 'OWNER' && ownerCount <= 1) {
        throw new ConflictException('Cannot remove the last remaining OWNER');
      }
      await client.query(`DELETE FROM memberships WHERE id = $1 AND tenant_id = $2`, [id, actor.tenantId]);
    });

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
