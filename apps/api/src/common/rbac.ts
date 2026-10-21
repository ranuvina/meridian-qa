export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'BILLING';

export const ROLE_RANK: Record<MemberRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  BILLING: 30,
  MEMBER: 20,
  VIEWER: 10,
};

export function atLeast(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
