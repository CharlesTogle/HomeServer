import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import type {
  AuthResponse,
  FileResponse,
  FolderResponse,
  UploadBatchResponse,
  UploadItemResponse,
} from '../../src/types/api.js';
import type { FileFixture, UserFixture } from './faker.js';

interface RegisteredUser {
  accessToken: string;
  refreshCookie: string;
  userId: string;
}

export interface TestAppContext {
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

export async function createTestAppContext(): Promise<TestAppContext> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'homeserver-backend-'));
  const previousEnv = {
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
  };

  process.env.AUTH_TOKEN_SECRET = 'homeserver-test-secret';
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3999';
  process.env.STORAGE_ROOT = storageRoot;

  const app = buildApp();
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

export async function registerUser(
  app: FastifyInstance,
  userFixture: UserFixture,
): Promise<RegisteredUser> {
  const response = await app.inject({
    method: 'POST',
    payload: userFixture,
    url: '/api/auth/register',
  });

  assert.equal(response.statusCode, 201);

  const body = response.json() as AuthResponse;
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

function restoreEnv(
  previousEnv: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}
