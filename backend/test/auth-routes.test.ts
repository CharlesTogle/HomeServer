import test from 'node:test';

import { createTestAppContext } from './support/app.js';
import { runAuthSessionLifecycleScenario } from './support/auth-route-scenarios.js';

test('auth routes login, refresh, and logout a seeded user session', async () => {
  await runAuthSessionLifecycleScenario(createTestAppContext);
});
