export type PlanTier = 'FREE' | 'GROWTH' | 'SCALE';

export interface PlanDefinition {
  rateLimitPerMinute: number;
  monthlyQuota: number;
  overageRatePerRequest: number;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: { rateLimitPerMinute: 100, monthlyQuota: 10_000, overageRatePerRequest: 0.002 },
  GROWTH: { rateLimitPerMinute: 1_000, monthlyQuota: 500_000, overageRatePerRequest: 0.001 },
  SCALE: { rateLimitPerMinute: 5_000, monthlyQuota: 5_000_000, overageRatePerRequest: 0.0005 },
};

export function planFor(tier: PlanTier): PlanDefinition {
  return PLANS[tier] ?? PLANS.FREE;
}
