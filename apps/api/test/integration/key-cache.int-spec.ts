import { Test } from '@nestjs/testing';
import { ApiKeyService, KEY_CACHE_TTL_SECONDS } from '../../src/gateway/api-key.service';
import { DbService } from '../../src/db/db.service';
import { RedisService } from '../../src/db/redis.service';
import { closeDb, createApiKey, createTenant, db } from '../support/factories';

/** Cache boundaries of API key resolution: what is cached, for how long, and what invalidates it. */
describe('ApiKeyService cache (real Postgres + Redis)', () => {
  let keys: ApiKeyService;
  let redis: RedisService;
  let dbService: DbService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [ApiKeyService, DbService, RedisService] }).compile();
    keys = moduleRef.get(ApiKeyService);
    redis = moduleRef.get(RedisService);
    dbService = moduleRef.get(DbService);
  });
  afterAll(async () => {
    await redis.onModuleDestroy();
    await dbService.onModuleDestroy();
    await closeDb();
  });

  it('resolves a valid key and rejects a wrong secret with the same prefix', async () => {
    const tenant = await createTenant({ plan: 'GROWTH' });
    const key = await createApiKey(tenant);
    expect(await keys.resolve(key.secret)).toMatchObject({ keyId: key.id, tenantId: tenant.id, plan: 'GROWTH' });
    expect(await keys.resolve(`${key.prefix}.wrong`)).toBeNull();
  });

  it.each(['', 'nodot', '.secretonly', 'prefixonly.'])('rejects malformed key %p without a lookup', async (raw) => {
    expect(await keys.resolve(raw)).toBeNull();
  });

  it('caches the key record in Redis for the TTL', async () => {
    const tenant = await createTenant();
    const key = await createApiKey(tenant);
    await keys.resolve(key.secret);
    const ttl = await redis.client.ttl(ApiKeyService.cacheKey(key.prefix));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(KEY_CACHE_TTL_SECONDS);
  });

  it('a DB change without invalidation is still served from cache (documents the TTL boundary)', async () => {
    const tenant = await createTenant();
    const key = await createApiKey(tenant);
    await keys.resolve(key.secret);
    await db().query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1`, [key.id]);
    expect(await keys.resolve(key.secret)).not.toBeNull();
    await keys.invalidate(key.prefix);
    expect(await keys.resolve(key.secret)).toBeNull();
  });

  it('tenant state is read live: plan and override changes apply on the next request', async () => {
    const tenant = await createTenant({ plan: 'FREE' });
    const key = await createApiKey(tenant);
    expect((await keys.resolve(key.secret)).plan).toBe('FREE');
    await db().query(`UPDATE tenants SET plan = 'SCALE', rate_limit_override = 7000 WHERE id = $1`, [tenant.id]);
    expect(await keys.resolve(key.secret)).toMatchObject({ plan: 'SCALE', rateLimitOverride: 7000 });
  });

  it('caches unknown prefixes briefly in Redis, not in process memory (DEF-027)', async () => {
    const prefix = `mk_unknown${Date.now()}`;
    expect(await keys.resolve(`${prefix}.abc`)).toBeNull();
    const ttl = await redis.client.ttl(ApiKeyService.cacheKey(prefix));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5);
  });

  describe('previous secret during a rotation grace period (A2)', () => {
    it('accepts the previous secret until it expires, then rejects it', async () => {
      const tenant = await createTenant();
      const key = await createApiKey(tenant);
      const oldHash = (await db().query(`SELECT secret_hash FROM api_keys WHERE id = $1`, [key.id])).rows[0].secret_hash;
      await db().query(
        `UPDATE api_keys SET previous_secret_hash = $2, previous_secret_expires_at = now() + interval '2 seconds',
                secret_hash = 'rotated' WHERE id = $1`,
        [key.id, oldHash],
      );
      await keys.invalidate(key.prefix);

      expect(await keys.resolve(key.secret)).toMatchObject({ keyId: key.id, viaPreviousSecret: true });
      await new Promise((r) => setTimeout(r, 2_200));
      expect(await keys.resolve(key.secret)).toBeNull(); // expiry is checked per request, not per cache fill
    });
  });
});
