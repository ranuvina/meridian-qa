import { Injectable } from '@nestjs/common';
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

  async summary(tenantId: string, from: string, to: string) {
    const keys = await this.db.query(
      `SELECT id, name, prefix FROM api_keys WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );

    const rows: KeyUsageRow[] = [];
    for (const key of keys) {
      const stats = await this.db.one(
        `SELECT COUNT(*)::int AS requests,
                COUNT(*) FILTER (WHERE status >= 400)::int AS errors,
                COALESCE(AVG(latency_ms), 0)::float AS avg_latency
           FROM usage_events
          WHERE api_key_id = $1
            AND created_at >= $2::timestamptz
            AND created_at < $3::timestamptz`,
        [key.id, from, to],
      );
      rows.push({
        keyId: key.id,
        name: key.name,
        prefix: key.prefix,
        requests: stats.requests,
        errors: stats.errors,
        avgLatencyMs: stats.avg_latency,
      });
    }

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

  async exportRows(keyId: string | null, from: string, to: string) {
    if (keyId) {
      return this.db.query(
        `SELECT e.created_at, e.route, e.status, e.latency_ms, k.name AS key_name
           FROM usage_events e
           JOIN api_keys k ON k.id = e.api_key_id
          WHERE e.api_key_id = $1
            AND e.created_at >= $2::timestamptz
            AND e.created_at < $3::timestamptz
          ORDER BY e.created_at DESC
          LIMIT 50000`,
        [keyId, from, to],
      );
    }

    return this.db.query(
      `SELECT e.created_at, e.route, e.status, e.latency_ms, k.name AS key_name
         FROM usage_events e
         JOIN api_keys k ON k.id = e.api_key_id
        WHERE e.created_at >= $1::timestamptz
          AND e.created_at < $2::timestamptz
        ORDER BY e.created_at DESC
        LIMIT 50000`,
      [from, to],
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
