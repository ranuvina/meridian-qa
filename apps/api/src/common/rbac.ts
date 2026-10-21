export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'BILLING';

export const VALID_ROLES: MemberRole[] = ['OWNER', 'ADMIN', 'BILLING', 'MEMBER', 'VIEWER'];

export const ROLE_RANK: Record<MemberRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  BILLING: 30,
  MEMBER: 20,
  VIEWER: 10,
};

export function isRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (VALID_ROLES as string[]).includes(value);
}

export function atLeast(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** rbac-matrix "Role escalation": a role may not be granted above the actor's own role. */
export function canGrantRole(actor: MemberRole, granted: MemberRole): boolean {
  return ROLE_RANK[granted] <= ROLE_RANK[actor];
}

/** An actor may not change or remove a member who outranks them (an ADMIN cannot demote an OWNER). */
export function canManageMember(actor: MemberRole, target: MemberRole): boolean {
  return ROLE_RANK[target] <= ROLE_RANK[actor];
}
