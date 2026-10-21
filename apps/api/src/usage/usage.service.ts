import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface KeyUsageRow {
  keyId: string;
  name: string;
  prefix: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
}

@Injectable()
export class UsageService {
  constructor(private readonly db: DbService) {}

  /** DEF-014 / SUP-1062: one grouped query instead of one query per key. */
  async summary(tenantId: string, from: string, to: string) {
    const stats = await this.db.query(
      `SELECT k.id, k.name, k.prefix,
              COUNT(e.id)::int AS requests,
              COUNT(e.id) FILTER (WHERE e.status >= 400)::int AS errors,
              COALESCE(AVG(e.latency_ms), 0)::float AS avg_latency
         FROM api_keys k
         LEFT JOIN usage_events e
                ON e.api_key_id = k.id
               AND e.created_at >= $2::timestamptz
               AND e.created_at < $3::timestamptz
        WHERE k.tenant_id = $1
        GROUP BY k.id, k.name, k.prefix, k.created_at
        ORDER BY k.created_at`,
      [tenantId, from, to],
    );

    const rows: KeyUsageRow[] = stats.map((r) => ({
      keyId: r.id,
      name: r.name,
      prefix: r.prefix,
      requests: r.requests,
      errors: r.errors,
      avgLatencyMs: r.avg_latency,
    }));

    return {
      from,
      to,
      totalRequests: rows.reduce((acc, r) => acc + r.requests, 0),
      keys: rows,
    };
  }

  async daily(tenantId: string, from: string, to: string) {
    return this.db.query(
      `SELECT date_trunc('day', created_at)::date AS day,
              COUNT(*)::int AS requests
         FROM usage_events
        WHERE tenant_id = $1
          AND created_at >= $2::timestamptz
          AND created_at < $3::timestamptz
        GROUP BY 1
        ORDER BY 1`,
      [tenantId, from, to],
    );
  }

  /** DEF-001: every row is constrained to the caller's tenant, including when keyId is given. */
  async exportRows(tenantId: string, keyId: string | null, from: string, to: string) {
    if (keyId) {
      const key = await this.db.one(
        `SELECT id FROM api_keys WHERE id::text = $1 AND tenant_id = $2`,
        [keyId, tenantId],
      );
      if (!key) throw new NotFoundException('Key not found');
    }
    return this.db.query(
      `SELECT e.created_at, e.route, e.status, e.latency_ms, k.name AS key_name
         FROM usage_events e
         JOIN api_keys k ON k.id = e.api_key_id
        WHERE e.tenant_id = $1
          AND ($2::uuid IS NULL OR e.api_key_id = $2::uuid)
          AND e.created_at >= $3::timestamptz
          AND e.created_at < $4::timestamptz
        ORDER BY e.created_at DESC
        LIMIT 50000`,
      [tenantId, keyId, from, to],
    );
  }

  toCsv(rows: any[]): string {
    const header = 'timestamp,key_name,route,status,latency_ms';
    const lines = rows.map((r) =>
      [
        new Date(r.created_at).toISOString(),
        r.key_name,
        r.route,
        r.status,
        r.latency_ms,
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }
}
