import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { closeDb } from './factories';

/**
 * Boots the real Nest application in-process against the test database, Redis and the mock
 * provider. Nothing is mocked: guards, pipes, SQL and Redis scripts all run for real, and the
 * same configureApp() as production is applied. In-process (rather than against the API
 * container) so coverage is measured and individual services can be reached for white-box checks.
 */
export async function startApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error'] }));
  await app.init();
  return app;
}

export async function stopApp(app?: INestApplication) {
  if (app) await app.close();
  await closeDb();
}

export const http = (app: INestApplication) => request(app.getHttpServer());

/** Mock billing provider / webhook receiver (apps/mock-billing). */
export const provider = {
  url: () => process.env.BILLING_PROVIDER_URL!,
  async charges(tenantId: string) {
    const res = await fetch(`${provider.url()}/charges?tenantId=${tenantId}`);
    return (await res.json()) as Array<{ id: string; tenantId: string; period: string; amount: number }>;
  },
  async received(channel: string) {
    const res = await fetch(`${provider.url()}/_webhook/received?channel=${channel}`);
    return (await res.json()) as Array<{ id: string; type: string; channel: string; signature: string; rawBody: string }>;
  },
  webhookUrl: (channel: string) => `${provider.url()}/_webhook/${channel}`,
};

/** Polls until `fn` returns a truthy value or the timeout passes. */
export async function eventually<T>(fn: () => Promise<T>, timeoutMs = 10_000, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return last!;
}
