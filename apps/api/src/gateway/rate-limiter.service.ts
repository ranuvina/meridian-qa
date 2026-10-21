import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RedisService } from '../db/redis.service';

export const WINDOW_MS = 60_000;

/**
 * Sliding-log limiter in a single Lua script, so check-and-record is atomic in Redis.
 * Fixes DEF-003 (GET/SET race), DEF-011 (per-key buckets) and DEF-029 (2x burst at a
 * fixed-window boundary). Rejected requests are not recorded, so they do not extend a block.
 *
 * KEYS[1] = bucket, ARGV = now(ms), window(ms), limit, member id
 * returns { allowed(0|1), countAfter, oldestTimestampInWindow }
 */
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, ARGV[4])
  count = count + 1
  allowed = 1
end
redis.call('PEXPIRE', key, window)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestTs = now
if oldest[2] then oldestTs = tonumber(oldest[2]) end
return { allowed, count, oldestTs }
`;

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until a slot frees up; only meaningful when not allowed. */
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  static bucketFor(tenantId: string) {
    return `rl:tenant:${tenantId}`;
  }

  /** `now` is injectable so window-boundary behaviour can be tested deterministically. */
  async consume(tenantId: string, limit: number, now: number = Date.now()): Promise<RateDecision> {
    const member = `${now}-${randomBytes(6).toString('hex')}`;
    const [allowed, count, oldest] = (await this.redis.client.eval(
      SCRIPT,
      1,
      RateLimiterService.bucketFor(tenantId),
      String(now),
      String(WINDOW_MS),
      String(limit),
      member,
    )) as [number, number, number];

    const retryMs = Math.max(0, Number(oldest) + WINDOW_MS - now);
    return {
      allowed: allowed === 1,
      limit,
      remaining: Math.max(0, limit - Number(count)),
      retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  }
}
