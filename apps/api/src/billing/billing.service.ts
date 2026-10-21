import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { planFor, PlanTier } from '../common/plans';

@Injectable()
export class BillingService {
  constructor(private readonly db: DbService) {}

  async previewInvoice(tenantId: string) {
    const tenant = await this.db.one(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);
    const plan = planFor(tenant.plan as PlanTier);

    const row = await this.db.one(
      `SELECT COUNT(*)::bigint AS used
         FROM usage_events
        WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`,
      [tenantId],
    );

    const used = Number(row.used);
    const overage = Math.max(0, used - plan.monthlyQuota);
    const amount = overage * plan.overageRatePerRequest;

    return {
      plan: tenant.plan,
      quota: plan.monthlyQuota,
      used,
      overageRequests: overage,
      overageAmount: amount,
      total: amount,
    };
  }

  async syncToProvider(tenantId: string) {
    const events = await this.db.query(
      `SELECT id, period, overage_requests, amount
         FROM billing_events
        WHERE tenant_id = $1 AND provider_ref IS NULL`,
      [tenantId],
    );

    const results = [];
    for (const event of events) {
      const res = await fetch(`${process.env.BILLING_PROVIDER_URL}/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          period: event.period,
          amount: event.amount,
          quantity: Number(event.overage_requests),
        }),
      });

      const body: any = await res.json().catch(() => ({}));
      if (res.ok && body?.id) {
        await this.db.query(`UPDATE billing_events SET provider_ref = $2 WHERE id = $1`, [
          event.id,
          body.id,
        ]);
      }
      results.push({ eventId: event.id, status: res.status, providerRef: body?.id ?? null });
    }
    return { synced: results.length, results };
  }
}
