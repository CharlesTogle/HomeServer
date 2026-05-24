import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { createInMemoryTestServerConfig } from '../src/utils/env.js';

test('GET /health returns ok status', async () => {
  const storageRoot = await mkdtemp(
    path.join(os.tmpdir(), 'homeserver-health-test-'),
  );
  const previousEnv = {
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    HOMESERVER_TEST_MODE: process.env.HOMESERVER_TEST_MODE,
    NODE_ENV: process.env.NODE_ENV,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
  };

  process.env.AUTH_TOKEN_SECRET = 'homeserver-test-secret';
  delete process.env.DATABASE_URL;
  process.env.HOMESERVER_TEST_MODE = 'true';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_ROOT = storageRoot;

  const app = buildApp({
    config: createInMemoryTestServerConfig({ storageRoot }),
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  } finally {
    await app.close();
    await rm(storageRoot, { force: true, recursive: true });
    restoreEnv(previousEnv);
  }
});

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}
