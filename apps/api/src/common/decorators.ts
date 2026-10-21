import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { MemberRole } from './rbac';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface RequestActor {
  userId: string;
  email: string;
  tenantId: string;
  role: MemberRole;
}

export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestActor => {
  return ctx.switchToHttp().getRequest().actor;
});
