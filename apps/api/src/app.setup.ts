import { INestApplication } from '@nestjs/common';

/** Shared by main.ts and the test harness so tests exercise the same HTTP configuration. */
export function configureApp(app: INestApplication) {
  // DEF-025 (not fixed, see DEFECTS.md): reflects any origin with credentials.
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  return app;
}
