import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { computeOverage, PlanTier } from '../common/plans';

/** 'YYYY-MM' of the current UTC month. Billing periods are UTC (DEF-012, not fixed). */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Stable per billing event, so retries and concurrent syncs can never create a second charge. */
export function idempotencyKeyFor(eventId: string) {
  return `meridian-billing-event-${eventId}`;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly db: DbService) {}

  async previewInvoice(tenantId: string) {
    const tenant = await this.db.one(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);

    const row = await this.db.one(
      `SELECT COUNT(*)::bigint AS used
         FROM usage_events
        WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`,
      [tenantId],
    );

    const o = computeOverage(tenant.plan as PlanTier, Number(row.used));
    return {
      plan: tenant.plan,
      quota: o.quota,
      used: o.used,
      overageRequests: o.overageRequests,
      overageAmount: o.overageAmount,
      total: o.overageAmount,
    };
  }

  /**
   * Pushes overage for CLOSED periods only (DEF-007: the open month's row keeps changing after
   * it is synced, so later overage was never charged). Every charge carries an Idempotency-Key
   * derived from the billing event (DEF-006), and one failed call no longer aborts the batch.
   */
  async syncToProvider(tenantId: string) {
    const events = await this.db.query(
      `SELECT id, period, overage_requests, amount
         FROM billing_events
        WHERE tenant_id = $1 AND provider_ref IS NULL AND period < $2
        ORDER BY period`,
      [tenantId, currentPeriod()],
    );

    const results = [];
    for (const event of events) {
      let status = 0;
      let providerRef: string | null = null;
      try {
        const res = await fetch(`${process.env.BILLING_PROVIDER_URL}/charges`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKeyFor(event.id),
          },
          body: JSON.stringify({
            tenantId,
            period: event.period,
            amount: event.amount,
            quantity: Number(event.overage_requests),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
        const body: any = await res.json().catch(() => ({}));
        if (res.ok && body?.id) {
          providerRef = body.id;
          await this.db.query(
            `UPDATE billing_events SET provider_ref = $2 WHERE id = $1 AND provider_ref IS NULL`,
            [event.id, providerRef],
          );
        }
      } catch (err) {
        this.logger.warn(`Billing sync failed for event ${event.id}: ${(err as Error).message}`);
      }
      results.push({ eventId: event.id, period: event.period, status, providerRef });
    }
    return { synced: results.filter((r) => r.providerRef).length, attempted: results.length, results };
  }
}
