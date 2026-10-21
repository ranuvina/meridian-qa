import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { RedisService } from '../db/redis.service';
import { planFor, PlanTier } from '../common/plans';

const WINDOW_SECONDS = 60;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeyService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    const rawKey = req.headers['x-api-key'];
    if (!rawKey) throw new UnauthorizedException('Missing x-api-key');

    const resolved = await this.keys.resolve(rawKey);
    if (!resolved) throw new UnauthorizedException('Invalid API key');

    const limit = planFor(resolved.plan as PlanTier).rateLimitPerMinute;

    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const bucket = `rl:${resolved.prefix}:${window}`;

    const current = Number((await this.redis.client.get(bucket)) || 0);

    if (current >= limit) {
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('Retry-After', String(WINDOW_SECONDS));
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    const next = current + 1;
    await this.redis.client.set(bucket, String(next), 'EX', WINDOW_SECONDS);

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - next)));

    req.apiKey = resolved;
    return true;
  }
}
