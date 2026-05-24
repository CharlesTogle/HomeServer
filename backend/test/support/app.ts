import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import {
  createInMemoryTestServerConfig,
  type ServerConfig,
} from '../../src/utils/env.js';
import type {
  FileResponse,
  FolderResponse,
  UploadBatchResponse,
  UploadItemResponse,
} from '../../src/types/api.js';
import { REFRESH_COOKIE_NAME } from '../../src/utils/cookies.js';
import type { FileFixture, UserFixture } from './faker.js';

interface SeededUserSession {
  accessToken: string;
  refreshCookie: string;
  userId: string;
}

interface PreviousEnv {
  AUTH_TOKEN_SECRET: string | undefined;
  DATABASE_URL: string | undefined;
  HOMESERVER_TEST_MODE: string | undefined;
  NODE_ENV: string | undefined;
  PORT: string | undefined;
  REFRESH_TOKEN_TTL_SECONDS: string | undefined;
  STORAGE_ROOT: string | undefined;
}

export interface TestAppContext {
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

export type TestAppContextFactory = () => Promise<TestAppContext>;

export async function createTestAppContext(): Promise<TestAppContext> {
  return createInMemoryTestAppContext();
}

export async function createInMemoryTestAppContext(): Promise<TestAppContext> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'homeserver-backend-'));
  const previousEnv = captureEnv();

  process.env.AUTH_TOKEN_SECRET = 'homeserver-test-secret';
  delete process.env.DATABASE_URL;
  process.env.HOMESERVER_TEST_MODE = 'true';
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3999';
  process.env.REFRESH_TOKEN_TTL_SECONDS = `${60 * 60 * 24 * 30}`;
  process.env.STORAGE_ROOT = storageRoot;

  const app = buildApp({
    config: createInMemoryTestServerConfig({
      port: 3999,
      storageRoot,
    }),
  });
  await app.ready();

  return {
    app,
    cleanup: async () => {
      await app.close();
      await rm(storageRoot, { force: true, recursive: true });
      restoreEnv(previousEnv);
    },
  };
}

export async function createPostgresTestAppContext(): Promise<TestAppContext> {
  const databaseUrl = getPostgresTestDatabaseUrl();

  assert.notEqual(
    databaseUrl,
    null,
    'HOMESERVER_POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests.',
  );

  const storageRoot = await mkdtemp(
    path.join(os.tmpdir(), 'homeserver-backend-postgres-'),
  );
  const previousEnv = captureEnv();

  process.env.AUTH_TOKEN_SECRET = 'homeserver-test-secret';
  process.env.DATABASE_URL = databaseUrl;
  delete process.env.HOMESERVER_TEST_MODE;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3999';
  process.env.REFRESH_TOKEN_TTL_SECONDS = `${60 * 60 * 24 * 30}`;
  process.env.STORAGE_ROOT = storageRoot;

  const app = buildApp({
    config: createDurableTestServerConfig(databaseUrl, storageRoot),
  });
  await app.ready();
  await resetPostgresState(app);

  return {
    app,
    cleanup: async () => {
      await resetPostgresState(app);
      await app.close();
      await rm(storageRoot, { force: true, recursive: true });
      restoreEnv(previousEnv);
    },
  };
}

export function hasPostgresTestDatabaseUrl(): boolean {
  return getPostgresTestDatabaseUrl() !== null;
}

export function authorizationHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
  };
}

export function buildMultipartPayload(
  fileFixture: FileFixture,
): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----homeserver-boundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileFixture.name}"\r\nContent-Type: ${fileFixture.mimeType}\r\n\r\n`,
    ),
    Buffer.from(fileFixture.contents),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return {
    body,
    headers: {
      'content-length': `${body.length}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  };
}

export async function createUploadBatch(
  app: FastifyInstance,
  accessToken: string,
  folderId: string,
): Promise<UploadBatchResponse> {
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'POST',
    payload: {
      expectedCount: 1,
      folderId,
    },
    url: '/api/upload-batches',
  });

  assert.equal(response.statusCode, 201);

  return response.json() as UploadBatchResponse;
}

export async function createUploadItem(
  app: FastifyInstance,
  accessToken: string,
  batchId: string,
  originalName: string,
): Promise<UploadItemResponse> {
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'POST',
    payload: {
      clientIdempotencyKey: `${originalName}-idempotency`,
      originalName,
    },
    url: `/api/upload-batches/${batchId}/items`,
  });

  assert.equal(response.statusCode, 201);

  return response.json() as UploadItemResponse;
}

export async function createUserRootFolder(
  app: FastifyInstance,
  accessToken: string,
): Promise<FolderResponse> {
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'GET',
    url: '/api/folders/root',
  });

  assert.equal(response.statusCode, 200);

  return response.json() as FolderResponse;
}

export async function seedUserSession(
  app: FastifyInstance,
  userFixture: UserFixture,
): Promise<SeededUserSession> {
  const tokens = await app.authService.provisionUser(
    userFixture.email,
    userFixture.password,
  );
  return {
    accessToken: tokens.accessToken,
    refreshCookie: createRefreshCookieHeader(tokens.refreshToken),
    userId: tokens.user.id,
  };
}

export async function loginUser(
  app: FastifyInstance,
  userFixture: UserFixture,
): Promise<SeededUserSession> {
  const response = await app.inject({
    method: 'POST',
    payload: userFixture,
    url: '/api/auth/login',
  });

  assert.equal(response.statusCode, 200);

  const body = response.json() as { accessToken: string; user: { id: string } };
  const refreshCookie = getSetCookie(response.headers['set-cookie']);

  return {
    accessToken: body.accessToken,
    refreshCookie,
    userId: body.user.id,
  };
}

export async function uploadFile(
  app: FastifyInstance,
  accessToken: string,
  itemId: string,
  fileFixture: FileFixture,
): Promise<FileResponse> {
  const multipartPayload = buildMultipartPayload(fileFixture);
  const response = await app.inject({
    headers: {
      ...authorizationHeaders(accessToken),
      ...multipartPayload.headers,
    },
    method: 'POST',
    payload: multipartPayload.body,
    url: `/api/upload-items/${itemId}/content`,
  });

  assert.equal(response.statusCode, 201);

  return response.json() as FileResponse;
}

function getSetCookie(rawSetCookieHeader: string | string[] | undefined): string {
  if (Array.isArray(rawSetCookieHeader)) {
    return rawSetCookieHeader[0] ?? '';
  }

  return rawSetCookieHeader ?? '';
}

function createRefreshCookieHeader(refreshToken: string): string {
  return `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`;
}

function captureEnv(): PreviousEnv {
  return {
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    HOMESERVER_TEST_MODE: process.env.HOMESERVER_TEST_MODE,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    REFRESH_TOKEN_TTL_SECONDS: process.env.REFRESH_TOKEN_TTL_SECONDS,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
  };
}

function createDurableTestServerConfig(
  databaseUrl: string,
  storageRoot: string,
): ServerConfig {
  return {
    accessTokenTtlSeconds: 900,
    authTokenSecret: 'homeserver-test-secret',
    databaseUrl,
    host: '127.0.0.1',
    persistenceMode: 'durable',
    port: 3999,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
    runtimeMode: 'test',
    storageRoot,
  };
}

function getPostgresTestDatabaseUrl(): string | null {
  const databaseUrl =
    process.env.HOMESERVER_POSTGRES_TEST_DATABASE_URL?.trim() ??
    process.env.HOMESERVER_PRISMA_TEST_DATABASE_URL?.trim();

  if (databaseUrl === undefined || databaseUrl === '') {
    return null;
  }

  return databaseUrl;
}

async function resetPostgresState(app: FastifyInstance): Promise<void> {
  if (app.pgPool === null) {
    return;
  }

  await app.pgPool.query(`
    TRUNCATE TABLE
      file_derivatives,
      media_jobs,
      upload_items,
      upload_batches,
      files,
      folders,
      sessions,
      users
    RESTART IDENTITY CASCADE
  `);
}

function restoreEnv(previousEnv: PreviousEnv): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}
