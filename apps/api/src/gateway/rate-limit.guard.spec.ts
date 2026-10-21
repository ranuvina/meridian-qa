import { requiredScope } from './rate-limit.guard';

describe('gateway: scope required per method (A2)', () => {
  it.each([
    ['GET', ['read']],
    ['get', ['read']],
    ['HEAD', ['read']],
    ['POST', ['write']],
    ['PUT', ['read', 'write']],
    ['DELETE', ['read', 'write']],
  ])('%s needs %p', (method, scopes) => expect(requiredScope(method)).toEqual(scopes));
});
