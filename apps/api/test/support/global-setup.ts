import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

/**
 * Creates a fresh `meridian_test` database from db/*.sql once per Jest run. Each project
 * (integration, api) calls this; a Postgres advisory lock makes the two calls safe when
 * Jest starts them together, and the second call is a no-op for the same run.
 */
export default async function globalSetup() {
  require('./env');
  const target = new URL(process.env.DATABASE_URL!);
  const dbName = target.pathname.slice(1);
  const admin = new URL(target.toString());
  admin.pathname = '/postgres';

  const runId = process.env.JEST_RUN_ID || String(process.pid);
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    const { rows } = await client.query(
      `SELECT shobj_description(oid, 'pg_database') AS run FROM pg_database WHERE datname = $1`,
      [dbName],
    );
    if (rows[0]?.run === runId) return;

    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${dbName}`);
    await client.query(`COMMENT ON DATABASE ${dbName} IS '${runId.replace(/'/g, '')}'`);

    const db = new Client({ connectionString: target.toString() });
    await db.connect();
    const dir = join(__dirname, '../../../../db');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await db.query(readFileSync(join(dir, file), 'utf8'));
    }
    await db.end();
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined);
    await client.end();
  }
}
