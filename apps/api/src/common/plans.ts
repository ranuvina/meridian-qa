export type PlanTier = 'FREE' | 'GROWTH' | 'SCALE';

export interface PlanDefinition {
  rateLimitPerMinute: number;
  /** A1: the highest rate-limit override a tenant on this plan may set. */
  rateLimitCeiling: number;
  monthlyQuota: number;
  overageRatePerRequest: number;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: { rateLimitPerMinute: 100, rateLimitCeiling: 500, monthlyQuota: 10_000, overageRatePerRequest: 0.002 },
  GROWTH: { rateLimitPerMinute: 1_000, rateLimitCeiling: 5_000, monthlyQuota: 500_000, overageRatePerRequest: 0.001 },
  SCALE: { rateLimitPerMinute: 5_000, rateLimitCeiling: 25_000, monthlyQuota: 5_000_000, overageRatePerRequest: 0.0005 },
};

export function planFor(tier: PlanTier): PlanDefinition {
  return PLANS[tier] ?? PLANS.FREE;
}

/**
 * A1 decision: overrides below the plan default are rejected until Product decides
 * (spec "Notes"). Flip this flag to allow them; validation and tests key off it.
 */
export const ALLOW_OVERRIDE_BELOW_PLAN_DEFAULT = false;

export type OverrideValidation = { ok: true; value: number } | { ok: false; reason: string };

export function validateRateLimitOverride(plan: PlanTier, raw: unknown): OverrideValidation {
  const def = planFor(plan);
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { ok: false, reason: 'rateLimitPerMinute must be an integer' };
  }
  const min = ALLOW_OVERRIDE_BELOW_PLAN_DEFAULT ? 1 : def.rateLimitPerMinute;
  if (raw < min) return { ok: false, reason: `rateLimitPerMinute must be at least ${min}` };
  if (raw > def.rateLimitCeiling) {
    return { ok: false, reason: `rateLimitPerMinute may not exceed the ${plan} ceiling of ${def.rateLimitCeiling}` };
  }
  return { ok: true, value: raw };
}

/**
 * The limit the gateway enforces. The stored override survives plan changes, but is clamped
 * to the current plan's ceiling, so a downgrade can never leave a tenant above its ceiling.
 */
export function effectiveRateLimit(plan: PlanTier, override: number | null | undefined): number {
  const def = planFor(plan);
  if (override == null) return def.rateLimitPerMinute;
  return Math.min(override, def.rateLimitCeiling);
}

export interface OverageBreakdown {
  used: number;
  quota: number;
  overageRequests: number;
  overageAmount: number;
}

export function computeOverage(plan: PlanTier, used: number): OverageBreakdown {
  const def = planFor(plan);
  const overageRequests = Math.max(0, used - def.monthlyQuota);
  return {
    used,
    quota: def.monthlyQuota,
    overageRequests,
    overageAmount: overageRequests * def.overageRatePerRequest,
  };
}
