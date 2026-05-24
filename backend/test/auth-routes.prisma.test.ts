import { readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPrismaTestAppContext,
  hasPrismaTestDatabaseUrl,
} from './support/app.js';
import { runAuthSessionLifecycleScenario } from './support/auth-route-scenarios.js';
import { createUserFixture } from './support/faker.js';

const prismaTestSkipReason =
  'Set HOMESERVER_PRISMA_TEST_DATABASE_URL to run Prisma-backed auth integration tests.';

if (hasPrismaTestDatabaseUrl()) {
  test(
    'auth routes login, refresh, and logout a seeded user session against Prisma',
    async () => {
      await runAuthSessionLifecycleScenario(createPrismaTestAppContext);
    },
  );

  test(
    'service user provisioning failure during initial session issuance rolls back Prisma rows and root storage',
    async () => {
      const { app, cleanup } = await createPrismaTestAppContext();

      try {
        assert.notEqual(app.prisma, null);

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
        assert.equal(await app.prisma.user.count(), 0);
        assert.equal(await app.prisma.session.count(), 0);
        assert.equal(await app.prisma.folder.count(), 0);
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
    `auth routes login, refresh, and logout a seeded user session against Prisma (${prismaTestSkipReason})`,
    () => {},
  );
}
