import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { DbService } from '../db/db.service';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 3000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly db: DbService) {}

  private sign(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  async dispatch(tenantId: string, eventType: string, payload: Record<string, unknown>) {
    const endpoints = await this.db.query(
      `SELECT id, url, secret FROM webhook_endpoints WHERE tenant_id = $1 AND active = true`,
      [tenantId],
    );

    for (const endpoint of endpoints) {
      await this.deliver(endpoint, eventType, payload, 1);
    }
    return { endpoints: endpoints.length };
  }

  private async deliver(
    endpoint: { id: string; url: string; secret: string },
    eventType: string,
    payload: Record<string, unknown>,
    attempt: number,
  ) {
    const eventId = randomUUID();
    const body = JSON.stringify({ id: eventId, type: eventType, data: payload });
    const signature = this.sign(endpoint.secret, body);

    let status: number | null = null;
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Meridian-Signature': signature,
          'X-Meridian-Event': eventType,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch (err) {
      this.logger.warn(`Delivery to ${endpoint.url} failed on attempt ${attempt}`);
    }

    await this.db.query(
      `INSERT INTO webhook_deliveries (endpoint_id, event_id, event_type, payload, attempt, status, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        endpoint.id,
        eventId,
        eventType,
        JSON.stringify(payload),
        attempt,
        status,
        status && status < 400 ? new Date() : null,
      ],
    );

    if ((!status || status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
      return this.deliver(endpoint, eventType, payload, attempt + 1);
    }
  }
}
