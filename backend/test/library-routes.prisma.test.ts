import test from 'node:test';

import {
  createPrismaTestAppContext,
  hasPrismaTestDatabaseUrl,
} from './support/app.js';
import { runLibraryOwnershipAndBrowseScenario } from './support/library-route-scenarios.js';

const prismaTestSkipReason =
  'Set HOMESERVER_PRISMA_TEST_DATABASE_URL to run Prisma-backed library integration tests.';

if (hasPrismaTestDatabaseUrl()) {
  test(
    'authenticated users can manage their own folders and files only against Prisma',
    async () => {
      await runLibraryOwnershipAndBrowseScenario(createPrismaTestAppContext);
    },
  );
} else {
  test.skip(
    `authenticated users can manage their own folders and files only against Prisma (${prismaTestSkipReason})`,
    () => {},
  );
}
