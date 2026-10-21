import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(params: {
    tenantId: string;
    actorId: string | null;
    action: string;
    target?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.query(
      `INSERT INTO audit_log (tenant_id, actor_id, action, target, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.tenantId,
        params.actorId,
        params.action,
        params.target ?? null,
        JSON.stringify(params.metadata ?? {}),
      ],
    );
  }

  async list(tenantId: string, limit = 100) {
    return this.db.query(
      `SELECT a.id, a.action, a.target, a.metadata, a.created_at, u.email AS actor_email
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.tenant_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2`,
      [tenantId, limit],
    );
  }
}
