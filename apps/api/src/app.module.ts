import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { MembershipsModule } from './memberships/memberships.module';
import { KeysModule } from './keys/keys.module';
import { GatewayModule } from './gateway/gateway.module';
import { UsageModule } from './usage/usage.module';
import { BillingModule } from './billing/billing.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    DbModule,
    AuthModule,
    TenantsModule,
    MembershipsModule,
    KeysModule,
    GatewayModule,
    UsageModule,
    BillingModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
