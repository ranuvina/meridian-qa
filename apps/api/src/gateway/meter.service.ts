import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { planFor, PlanTier } from '../common/plans';
import { ResolvedKey } from './api-key.service';

@Injectable()
export class MeterService {
  constructor(private readonly db: DbService) {}

  private currentPeriod(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async quotaRemaining(tenantId: string, plan: PlanTier): Promise<number> {
    const row = await this.db.one(
      `SELECT COUNT(*)::bigint AS used
         FROM usage_events
        WHERE tenant_id = $1
          AND created_at >= date_trunc('month', now())`,
      [tenantId],
    );
    return planFor(plan).monthlyQuota - Number(row.used);
  }

  async record(key: ResolvedKey, route: string, status: number, latencyMs: number) {
    const remaining = await this.quotaRemaining(key.tenantId, key.plan as PlanTier);

    await this.db.query(
      `INSERT INTO usage_events (tenant_id, api_key_id, route, status, latency_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [key.tenantId, key.keyId, route, status, latencyMs],
    );

    const day = new Date().toISOString().slice(0, 10);
    await this.db.query(
      `INSERT INTO usage_daily (tenant_id, day, requests)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, day) DO UPDATE SET requests = usage_daily.requests + 1`,
      [key.tenantId, day],
    );

    await this.db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.keyId]);

    if (remaining <= 0) {
      await this.recordOverage(key.tenantId, key.plan as PlanTier, Math.abs(remaining) + 1);
    }
  }

  async recordOverage(tenantId: string, plan: PlanTier, overageRequests: number) {
    const rate = planFor(plan).overageRatePerRequest;
    const amount = overageRequests * rate;
    const period = this.currentPeriod();

    const existing = await this.db.one(
      `SELECT id, overage_requests, amount FROM billing_events
        WHERE tenant_id = $1 AND period = $2`,
      [tenantId, period],
    );

    if (existing) {
      await this.db.query(
        `UPDATE billing_events
            SET overage_requests = $2, amount = $3
          WHERE id = $1`,
        [existing.id, overageRequests, amount],
      );
    } else {
      await this.db.query(
        `INSERT INTO billing_events (tenant_id, period, overage_requests, amount)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, period, overageRequests, amount],
      );
    }
  }
}
