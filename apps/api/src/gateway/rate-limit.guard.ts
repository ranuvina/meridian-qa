import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyService, KeyScope } from './api-key.service';
import { RateLimiterService } from './rate-limiter.service';
import { effectiveRateLimit, PlanTier } from '../common/plans';

/** A2: GET routes need `read`, POST routes need `write`. Anything else needs both. */
export function requiredScope(method: string): KeyScope[] {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return ['read'];
  if (m === 'POST') return ['write'];
  return ['read', 'write'];
}

/**
 * Order matters: authenticate -> suspended -> scope -> rate limit.
 * Requests refused for suspension or scope never consume rate-limit budget (DEF-028; A2 decision).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly keys: ApiKeyService, private readonly limiter: RateLimiterService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    const rawKey = req.headers['x-api-key'];
    if (!rawKey) throw new UnauthorizedException('Missing x-api-key');

    const resolved = await this.keys.resolve(rawKey);
    if (!resolved) throw new UnauthorizedException('Invalid API key');

    if (resolved.suspended) throw new ForbiddenException('Tenant suspended');

    const needed = requiredScope(req.method);
    if (!needed.every((s) => resolved.scopes.includes(s))) {
      throw new ForbiddenException(`API key lacks required scope: ${needed.join(', ')}`);
    }

    const limit = effectiveRateLimit(resolved.plan as PlanTier, resolved.rateLimitOverride);
    const decision = await this.limiter.consume(resolved.tenantId, limit);

    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    req.apiKey = resolved;
    return true;
  }
}
