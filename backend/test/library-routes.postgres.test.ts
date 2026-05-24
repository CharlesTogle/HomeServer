import test from 'node:test';

import {
  createPostgresTestAppContext,
  hasPostgresTestDatabaseUrl,
} from './support/app.js';
import { runLibraryOwnershipAndBrowseScenario } from './support/library-route-scenarios.js';

const postgresTestSkipReason =
  'Set HOMESERVER_POSTGRES_TEST_DATABASE_URL to run PostgreSQL-backed library integration tests.';

if (hasPostgresTestDatabaseUrl()) {
  test(
    'authenticated users can manage their own folders and files only against PostgreSQL',
    async () => {
      await runLibraryOwnershipAndBrowseScenario(createPostgresTestAppContext);
    },
  );
} else {
  test.skip(
    `authenticated users can manage their own folders and files only against PostgreSQL (${postgresTestSkipReason})`,
    () => {},
  );
}
