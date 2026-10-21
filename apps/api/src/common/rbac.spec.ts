import { canGrantRole, canManageMember, isRole, MemberRole, ROLE_RANK, VALID_ROLES } from './rbac';

const pairs = VALID_ROLES.flatMap((a) => VALID_ROLES.map((b) => [a, b] as [MemberRole, MemberRole]));

describe('rbac: permission resolution', () => {
  it('ranks roles OWNER > ADMIN > BILLING > MEMBER > VIEWER', () => {
    const ordered = [...VALID_ROLES].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
    expect(ordered).toEqual(['OWNER', 'ADMIN', 'BILLING', 'MEMBER', 'VIEWER']);
  });

  it.each(pairs)('%s may grant %s only if it does not outrank the actor', (actor, granted) => {
    expect(canGrantRole(actor, granted)).toBe(ROLE_RANK[granted] <= ROLE_RANK[actor]);
  });

  it('an ADMIN cannot grant OWNER, an OWNER can grant anything', () => {
    expect(canGrantRole('ADMIN', 'OWNER')).toBe(false);
    expect(VALID_ROLES.every((r) => canGrantRole('OWNER', r))).toBe(true);
  });

  it('an ADMIN cannot manage an OWNER but can manage an ADMIN', () => {
    expect(canManageMember('ADMIN', 'OWNER')).toBe(false);
    expect(canManageMember('ADMIN', 'ADMIN')).toBe(true);
  });

  it.each([['OWNER', true], ['owner', false], ['ROOT', false], [undefined, false], [5, false]])(
    'isRole(%p) = %s',
    (value, expected) => expect(isRole(value)).toBe(expected),
  );
});
