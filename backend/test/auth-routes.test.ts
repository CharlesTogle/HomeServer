import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestAppContext, registerUser } from './support/app.js';
import { createUserFixture } from './support/faker.js';

test('auth routes register, refresh, and logout a user session', async () => {
  const { app, cleanup } = await createTestAppContext();

  try {
    const userFixture = createUserFixture();
    const registeredUser = await registerUser(app, userFixture);

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
});
