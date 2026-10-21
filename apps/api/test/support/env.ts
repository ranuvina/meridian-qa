// Date handling must not depend on the machine running the suite.
process.env.TZ = 'UTC';

/**
 * Runs before any module is imported in each test file. Services read process.env at
 * construction time, so the test database must be chosen here.
 */
const base = process.env.DATABASE_URL || 'postgres://meridian:meridian@localhost:5432/meridian';
const url = new URL(base);
url.pathname = '/' + (process.env.TEST_DATABASE_NAME || 'meridian_test');
process.env.DATABASE_URL = url.toString();
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.BILLING_PROVIDER_URL = process.env.BILLING_PROVIDER_URL || 'http://localhost:4010';
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || '5';
if (!process.env.WEBHOOK_ALLOWED_HOSTS) {
  process.env.WEBHOOK_ALLOWED_HOSTS = new URL(process.env.BILLING_PROVIDER_URL).hostname;
}
