import assert from 'node:assert/strict';

import {
  type TestAppContextFactory,
  loginUser,
  seedUserSession,
} from './app.js';
import { createUserFixture } from './faker.js';

export async function runAuthSessionLifecycleScenario(
  createAppContext: TestAppContextFactory,
): Promise<void> {
  const { app, cleanup } = await createAppContext();

  try {
    const userFixture = createUserFixture();
    await seedUserSession(app, userFixture);
    const registeredUser = await loginUser(app, userFixture);

    assert.notEqual(registeredUser.refreshCookie, '');

    const refreshResponse = await app.inject({
      headers: {
        cookie: registeredUser.refreshCookie,
      },
      method: 'POST',
      url: '/api/auth/refresh',
    });

    assert.equal(refreshResponse.statusCode, 200);
    assert.notEqual(refreshResponse.json().accessToken.length, 0);

    const logoutResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredUser.accessToken}`,
        cookie: registeredUser.refreshCookie,
      },
      method: 'POST',
      url: '/api/auth/logout',
    });

    assert.equal(logoutResponse.statusCode, 204);

    const refreshAfterLogoutResponse = await app.inject({
      headers: {
        cookie: registeredUser.refreshCookie,
      },
      method: 'POST',
      url: '/api/auth/refresh',
    });

    assert.equal(refreshAfterLogoutResponse.statusCode, 401);
  } finally {
    await cleanup();
  }
}
