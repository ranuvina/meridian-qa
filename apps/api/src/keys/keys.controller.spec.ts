import { BadRequestException } from '@nestjs/common';
import { DEFAULT_GRACE_SECONDS, MAX_GRACE_SECONDS, parseGracePeriod, parseScopes } from './keys.controller';

describe('keys: scope parsing (A2)', () => {
  it('defaults to full access when scopes are omitted', () => {
    expect(parseScopes(undefined)).toEqual(['read', 'write']);
  });
  it.each([
    [['read'], ['read']],
    [['write'], ['write']],
    [['write', 'read'], ['read', 'write']],
    [['read', 'read'], ['read']],
  ])('%p -> %p', (input, expected) => expect(parseScopes(input)).toEqual(expected));

  it.each([[[]], [['admin']], [['READ']], ['read'], [null], [[1]]])('rejects %p', (input) => {
    expect(() => parseScopes(input)).toThrow(BadRequestException);
  });
});

describe('keys: grace period parsing (A2)', () => {
  it('defaults to 3600 seconds', () => expect(parseGracePeriod(undefined)).toBe(DEFAULT_GRACE_SECONDS));
  it.each([0, 1, 3600, MAX_GRACE_SECONDS])('accepts %d', (v) => expect(parseGracePeriod(v)).toBe(v));
  it.each([-1, MAX_GRACE_SECONDS + 1, 1.5, '60', null])('rejects %p', (v) => {
    expect(() => parseGracePeriod(v)).toThrow(BadRequestException);
  });
});
