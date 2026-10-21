import { Test } from '@nestjs/testing';
import { RateLimiterService, WINDOW_MS } from '../../src/gateway/rate-limiter.service';
import { RedisService } from '../../src/db/redis.service';
import { randomId } from '../support/factories';

/**
 * Rate limiter against real Redis. The clock is injected, so window-boundary behaviour is
 * tested deterministically instead of by sleeping across a wall-clock minute.
 */
describe('RateLimiterService (real Redis)', () => {
  let limiter: RateLimiterService;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [RateLimiterService, RedisService] }).compile();
    limiter = moduleRef.get(RateLimiterService);
    redis = moduleRef.get(RedisService);
  });
  afterAll(() => redis.onModuleDestroy());

  const burst = (tenant: string, n: number, limit: number, at: number) =>
    Promise.all(Array.from({ length: n }, () => limiter.consume(tenant, limit, at)));
  const allowed = (ds: Array<{ allowed: boolean }>) => ds.filter((d) => d.allowed).length;

  it('admits exactly `limit` requests out of a large concurrent burst', async () => {
    const tenant = randomId();
    const decisions = await burst(tenant, 600, 100, Date.now());
    expect(allowed(decisions)).toBe(100);
  });

  it('stays exact across 20 repeated bursts (no lucky passes)', async () => {
    for (let i = 0; i < 20; i++) {
      expect(allowed(await burst(randomId(), 150, 100, Date.now()))).toBe(100);
    }
  });

  it('does not admit a second full burst just after a minute boundary', async () => {
    const tenant = randomId();
    const t0 = 1_800_000_000_000 + 59_000; // 59s into a wall-clock minute
    expect(allowed(await burst(tenant, 100, 100, t0))).toBe(100);
    expect(allowed(await burst(tenant, 100, 100, t0 + 2_000))).toBe(0); // 1s into the next minute
  });

  it('frees capacity exactly one window after each admitted request', async () => {
    const tenant = randomId();
    const t0 = 1_800_000_100_000;
    await burst(tenant, 100, 100, t0);
    expect((await limiter.consume(tenant, 100, t0 + WINDOW_MS - 1)).allowed).toBe(false);
    expect((await limiter.consume(tenant, 100, t0 + WINDOW_MS + 1)).allowed).toBe(true);
  });

  it('a sustained rate at the limit is admitted indefinitely', async () => {
    const tenant = randomId();
    const t0 = 1_800_000_200_000;
    const spacing = WINDOW_MS / 100; // 100 per minute, evenly spread
    let denied = 0;
    for (let i = 0; i < 300; i++) if (!(await limiter.consume(tenant, 100, t0 + i * spacing)).allowed) denied++;
    expect(denied).toBe(0);
  });

  it('rejected requests do not extend the block', async () => {
    const tenant = randomId();
    const t0 = 1_800_000_300_000;
    await burst(tenant, 100, 100, t0);
    await burst(tenant, 500, 100, t0 + 30_000); // hammering while blocked
    expect((await limiter.consume(tenant, 100, t0 + WINDOW_MS + 1)).allowed).toBe(true);
  });

  it('reports remaining budget and a Retry-After that points at the next free slot', async () => {
    const tenant = randomId();
    const t0 = 1_800_000_400_000;
    const first = await limiter.consume(tenant, 3, t0);
    expect(first).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    await limiter.consume(tenant, 3, t0 + 10_000);
    await limiter.consume(tenant, 3, t0 + 20_000);
    const blocked = await limiter.consume(tenant, 3, t0 + 45_000);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 15 });
  });

  it('tenants are independent', async () => {
    const a = randomId();
    const b = randomId();
    const now = Date.now();
    await burst(a, 100, 100, now);
    expect(allowed(await burst(b, 100, 100, now))).toBe(100);
  });

  it('a changed limit applies to the very next request (A1)', async () => {
    const tenant = randomId();
    const now = Date.now();
    expect(allowed(await burst(tenant, 100, 100, now))).toBe(100);
    expect((await limiter.consume(tenant, 100, now)).allowed).toBe(false);
    expect((await limiter.consume(tenant, 150, now)).allowed).toBe(true); // override raised to 150
    expect((await limiter.consume(tenant, 50, now)).allowed).toBe(false); // lowered below usage
  });

  it('expires its Redis key after one idle window', async () => {
    const tenant = randomId();
    await limiter.consume(tenant, 10);
    const ttl = await redis.client.pttl(RateLimiterService.bucketFor(tenant));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_MS);
  });
});
