import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor, Roles } from '../common/decorators';
import { DbService } from '../db/db.service';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(JwtGuard, RolesGuard)
export class BillingController {
  constructor(private readonly db: DbService, private readonly billing: BillingService) {}

  @Get('events')
  @Roles('OWNER', 'ADMIN', 'BILLING', 'VIEWER')
  events(@Actor() actor: RequestActor) {
    return this.db.query(
      `SELECT id, period, overage_requests, amount, provider_ref, created_at
         FROM billing_events
        WHERE tenant_id = $1
        ORDER BY period DESC`,
      [actor.tenantId],
    );
  }

  @Get('invoice-preview')
  @Roles('OWNER', 'ADMIN', 'BILLING', 'VIEWER')
  preview(@Actor() actor: RequestActor) {
    return this.billing.previewInvoice(actor.tenantId);
  }

  @Post('sync')
  @Roles('OWNER', 'BILLING')
  sync(@Actor() actor: RequestActor) {
    return this.billing.syncToProvider(actor.tenantId);
  }
}
