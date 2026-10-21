/**
 * Three projects share one coverage report:
 *   unit        src/**\/*.spec.ts         pure logic, no I/O
 *   integration test/integration/**       real Postgres + Redis + mock provider, services in-process
 *   api         test/api/**               full HTTP surface through the Nest app (supertest)
 *
 * Tests never truncate shared tables: every test creates its own tenant/users/keys with random
 * identifiers, so files run in parallel and in any order.
 */
const common = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/support/env.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', isolatedModules: true }] },
};

module.exports = {
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      testTimeout: 30_000,
    },
    {
      ...common,
      displayName: 'api',
      testMatch: ['<rootDir>/test/api/**/*.api-spec.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      testTimeout: 30_000,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/*.spec.ts'],
  coverageDirectory: '<rootDir>/../../reports/coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'cobertura'],
  coverageThreshold: {
    global: { statements: 85, branches: 70, functions: 85, lines: 85 },
  },
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: '../../reports/junit', outputName: 'api.xml', addFileAttribute: 'true' }],
  ],
};
