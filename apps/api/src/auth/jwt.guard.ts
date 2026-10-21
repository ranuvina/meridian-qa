import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { DbService } from '../db/db.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const tenantId = req.headers['x-tenant-id'] || req.params?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing x-tenant-id');

    const membership = await this.db.one(
      `SELECT m.role, u.email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1 AND m.tenant_id = $2`,
      [payload.sub, tenantId],
    );
    if (!membership) throw new ForbiddenException('Not a member of this tenant');

    req.actor = {
      userId: payload.sub,
      email: membership.email,
      tenantId,
      role: membership.role,
    };
    return true;
  }
}
