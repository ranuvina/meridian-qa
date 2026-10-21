import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { RateLimitGuard } from './rate-limit.guard';
import { ApiKeyService } from './api-key.service';
import { MeterService } from './meter.service';
import { RateLimiterService } from './rate-limiter.service';

@Module({
  controllers: [GatewayController],
  providers: [RateLimitGuard, ApiKeyService, MeterService, RateLimiterService],
  exports: [ApiKeyService, MeterService, RateLimiterService],
})
export class GatewayModule {}
