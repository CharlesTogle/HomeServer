import test from 'node:test';

import { createTestAppContext } from './support/app.js';
import { runLibraryOwnershipAndBrowseScenario } from './support/library-route-scenarios.js';

test('authenticated users can manage their own folders and files only', async () => {
  await runLibraryOwnershipAndBrowseScenario(createTestAppContext);
});
