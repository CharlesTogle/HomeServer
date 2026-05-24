import { readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { FastifyInstance } from 'fastify';

import {
  createPostgresTestAppContext,
  hasPostgresTestDatabaseUrl,
} from './support/app.js';
import { runAuthSessionLifecycleScenario } from './support/auth-route-scenarios.js';
import { createUserFixture } from './support/faker.js';

const postgresTestSkipReason =
  'Set HOMESERVER_POSTGRES_TEST_DATABASE_URL to run PostgreSQL-backed auth integration tests.';

if (hasPostgresTestDatabaseUrl()) {
  test(
    'auth routes login, refresh, and logout a seeded user session against PostgreSQL',
    async () => {
      await runAuthSessionLifecycleScenario(createPostgresTestAppContext);
    },
  );

  test(
    'service user provisioning failure during initial session issuance rolls back PostgreSQL rows and root storage',
    async () => {
      const { app, cleanup } = await createPostgresTestAppContext();

      try {
        const userFixture = createUserFixture();
        const authService = app.authService as typeof app.authService & {
          issueTokensForUser?: (...args: unknown[]) => Promise<unknown>;
        };
        const originalIssueTokensForUser = authService.issueTokensForUser;

        assert.equal(typeof originalIssueTokensForUser, 'function');

        authService.issueTokensForUser = async (): Promise<never> => {
          throw new Error('Injected session issuance failure.');
        };

        await assert.rejects(
          async () => await app.authService.provisionUser(userFixture.email, userFixture.password),
          /Injected session issuance failure/u,
        );
        assert.equal(
          await queryCount(
            app,
            'SELECT COUNT(*)::int AS count FROM users WHERE email = $1',
            [userFixture.email.toLowerCase()],
          ),
          0,
        );
        assert.equal(await queryCount(app, 'SELECT COUNT(*)::int AS count FROM sessions'), 0);
        assert.equal(await queryCount(app, 'SELECT COUNT(*)::int AS count FROM folders'), 0);
        assert.deepEqual(
          await readdir(path.join(app.storageRoot, 'users')),
          [],
        );
      } finally {
        authService.issueTokensForUser = originalIssueTokensForUser;
        await cleanup();
      }
    },
  );
} else {
  test.skip(
    `auth routes login, refresh, and logout a seeded user session against PostgreSQL (${postgresTestSkipReason})`,
    () => {},
  );
}

async function queryCount(
  app: FastifyInstance,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  if (app.pgPool === null) {
    throw new Error('Expected pgPool in durable test context.');
  }

  const result = await app.pgPool.query<{ count: number }>(sql, [...values]);
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('Expected count query to return a row.');
  }

  return row.count;
}
