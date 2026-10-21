import {
  ALLOW_OVERRIDE_BELOW_PLAN_DEFAULT,
  computeOverage,
  effectiveRateLimit,
  PLANS,
  validateRateLimitOverride,
} from './plans';

describe('plans: limit calculation', () => {
  it('matches the plan table in the brief', () => {
    expect(PLANS.FREE).toMatchObject({ rateLimitPerMinute: 100, monthlyQuota: 10_000, rateLimitCeiling: 500 });
    expect(PLANS.GROWTH).toMatchObject({ rateLimitPerMinute: 1_000, monthlyQuota: 500_000, rateLimitCeiling: 5_000 });
    expect(PLANS.SCALE).toMatchObject({ rateLimitPerMinute: 5_000, monthlyQuota: 5_000_000, rateLimitCeiling: 25_000 });
  });

  describe('validateRateLimitOverride (A1)', () => {
    it.each([
      ['FREE', 100, true],
      ['FREE', 500, true], // ceiling is inclusive
      ['FREE', 501, false],
      ['GROWTH', 2_500, true],
      ['GROWTH', 5_000, true],
      ['GROWTH', 5_001, false],
      ['SCALE', 25_000, true],
      ['SCALE', 25_001, false],
    ] as const)('%s %d -> valid=%s', (plan, value, ok) => {
      expect(validateRateLimitOverride(plan, value).ok).toBe(ok);
    });

    it.each([0, -1, 2.5, NaN, Infinity, '200', null, undefined, {}])('rejects non-positive-integer %p', (value) => {
      expect(validateRateLimitOverride('GROWTH', value).ok).toBe(false);
    });

    it('rejects values below the plan default while Product has not approved them', () => {
      expect(ALLOW_OVERRIDE_BELOW_PLAN_DEFAULT).toBe(false);
      const result = validateRateLimitOverride('FREE', 99);
      expect(result).toEqual({ ok: false, reason: 'rateLimitPerMinute must be at least 100' });
    });
  });

  describe('effectiveRateLimit', () => {
    it('is the plan default without an override', () => {
      expect(effectiveRateLimit('FREE', null)).toBe(100);
      expect(effectiveRateLimit('SCALE', undefined)).toBe(5_000);
    });
    it('is the override when one is set', () => {
      expect(effectiveRateLimit('GROWTH', 2_500)).toBe(2_500);
    });
    it('clamps an override that survived a downgrade to the new ceiling', () => {
      expect(effectiveRateLimit('FREE', 4_000)).toBe(500);
    });
  });
});

describe('plans: billing arithmetic', () => {
  it('charges nothing under or at the quota', () => {
    expect(computeOverage('FREE', 9_999).overageRequests).toBe(0);
    expect(computeOverage('FREE', 10_000)).toEqual({ used: 10_000, quota: 10_000, overageRequests: 0, overageAmount: 0 });
  });
  it('charges each request beyond the quota at the plan rate', () => {
    expect(computeOverage('FREE', 10_500)).toMatchObject({ overageRequests: 500, overageAmount: 1 });
    expect(computeOverage('GROWTH', 600_000)).toMatchObject({ overageRequests: 100_000, overageAmount: 100 });
    expect(computeOverage('SCALE', 5_002_000)).toMatchObject({ overageRequests: 2_000, overageAmount: 1 });
  });
  it.failing('DEF-017: produces exact money amounts (no binary floating-point error)', () => {
    expect(computeOverage('FREE', 10_009).overageAmount).toBe(0.018);
  });
});
