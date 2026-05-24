import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { FastifyInstance } from 'fastify';

import type {
  FileResponse,
  FolderEntriesResponse,
  FolderResponse,
} from '../src/types/api.js';
import {
  authorizationHeaders,
  createPostgresTestAppContext,
  createUploadBatch,
  createUploadItem,
  createUserRootFolder,
  hasPostgresTestDatabaseUrl,
  seedUserSession,
  uploadFile,
} from './support/app.js';
import {
  createFileFixture,
  createFolderFixture,
  createUserFixture,
} from './support/faker.js';

const postgresOnly = hasPostgresTestDatabaseUrl() ? test : test.skip;

postgresOnly(
  'auth service user provisioning rolls back user, session, folder row, and root directory when initial session issuance fails',
  async () => {
    const { app, cleanup } = await createPostgresTestAppContext();
    const userFixture = createUserFixture();
    let capturedUserId: string | null = null;

    const authService = app.authService as unknown as {
      issueTokensForUser: (...args: unknown[]) => Promise<unknown>;
    };
    const libraryService = app.libraryService as unknown as {
      createUserRootFolderInTransaction: (
        tx: unknown,
        userId: string,
        createdAt: Date,
        folderId?: string,
      ) => Promise<string>;
    };

    const originalIssueTokensForUser = authService.issueTokensForUser;
    const originalCreateUserRootFolderInTransaction =
      libraryService.createUserRootFolderInTransaction;

    try {
      try {
        libraryService.createUserRootFolderInTransaction = async (
          tx,
          userId,
          createdAt,
          folderId,
        ) => {
          capturedUserId = userId;
          return originalCreateUserRootFolderInTransaction.call(
            libraryService,
            tx,
            userId,
            createdAt,
            folderId,
          );
        };

        authService.issueTokensForUser = async () => {
          throw new Error('simulated session issuance failure');
        };

        await assert.rejects(
          async () =>
            await app.authService.provisionUser(
              userFixture.email,
              userFixture.password,
            ),
          /simulated session issuance failure/u,
        );
      } finally {
        libraryService.createUserRootFolderInTransaction =
          originalCreateUserRootFolderInTransaction;
        authService.issueTokensForUser = originalIssueTokensForUser;
      }

      assert.equal(
        await queryCount(
          app,
          'SELECT COUNT(*)::int AS count FROM users WHERE email = $1',
          [userFixture.email.toLowerCase()],
        ),
        0,
      );

      if (capturedUserId !== null) {
        const folderCount = await queryCount(
          app,
          'SELECT COUNT(*)::int AS count FROM folders WHERE user_id = $1',
          [capturedUserId],
        );
        const sessionCount = await queryCount(
          app,
          'SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = $1',
          [capturedUserId],
        );

        assert.equal(folderCount, 0);
        assert.equal(sessionCount, 0);

        await expectPathMissing(
          path.join(app.storageRoot, 'users', capturedUserId),
        );
      }
    } finally {
      await cleanup();
    }
  },
);

postgresOnly(
  'createFolder does not leave a directory behind when its database transaction fails',
  async () => {
    const { app, cleanup } = await createPostgresTestAppContext();

    try {
      const user = await seedUserSession(app, createUserFixture());
      const rootFolder = await createUserRootFolder(app, user.accessToken);
      const beforeEntries = await getFolderEntries(
        app,
        user.accessToken,
        rootFolder.id,
      );
      const beforeDiskChildren = (
        await readdir(path.join(app.storageRoot, 'users', user.userId))
      ).sort();

      const libraryService = app.libraryService as unknown as {
        withTransaction: <T>(
          callback: (client: unknown) => Promise<T>,
        ) => Promise<T>;
      };
      const originalWithTransaction = libraryService.withTransaction;

      try {
        libraryService.withTransaction = async () => {
          throw new Error('simulated folder transaction failure');
        };

        const response = await app.inject({
          headers: authorizationHeaders(user.accessToken),
          method: 'POST',
          payload: {
            name: createFolderFixture().name,
            parentFolderId: rootFolder.id,
          },
          url: '/api/folders',
        });

        assert.equal(response.statusCode, 500);
      } finally {
        libraryService.withTransaction = originalWithTransaction;
      }

      const afterEntries = await getFolderEntries(
        app,
        user.accessToken,
        rootFolder.id,
      );
      const afterDiskChildren = (
        await readdir(path.join(app.storageRoot, 'users', user.userId))
      ).sort();

      assert.deepEqual(afterEntries, beforeEntries);
      assert.deepEqual(afterDiskChildren, beforeDiskChildren);
    } finally {
      await cleanup();
    }
  },
);

postgresOnly(
  'deleteFile restores staged content when file deletion fails in PostgreSQL',
  async () => {
    const { app, cleanup } = await createPostgresTestAppContext();

    try {
      const user = await seedUserSession(app, createUserFixture());
      const rootFolder = await createUserRootFolder(app, user.accessToken);
      const destinationFolder = await createFolder(
        app,
        user.accessToken,
        rootFolder.id,
      );
      const fileFixture = createFileFixture();
      const batch = await createUploadBatch(
        app,
        user.accessToken,
        destinationFolder.id,
      );
      const uploadItem = await createUploadItem(
        app,
        user.accessToken,
        batch.id,
        fileFixture.name,
      );
      const uploadedFile = await uploadFile(
        app,
        user.accessToken,
        uploadItem.id,
        fileFixture,
      );

      const libraryService = app.libraryService as unknown as {
        deletePersistedFile: (...args: unknown[]) => Promise<unknown>;
      };
      const originalDelete = libraryService.deletePersistedFile;

      try {
        libraryService.deletePersistedFile = async () => {
          throw new Error('simulated file delete failure');
        };

        const deleteResponse = await app.inject({
          headers: authorizationHeaders(user.accessToken),
          method: 'DELETE',
          url: `/api/files/${uploadedFile.id}`,
        });

        assert.equal(deleteResponse.statusCode, 500);
      } finally {
        libraryService.deletePersistedFile = originalDelete;
      }

      assert.equal(
        (await getFile(app, user.accessToken, uploadedFile.id)).id,
        uploadedFile.id,
      );
      assert.equal(
        await getFileContent(app, user.accessToken, uploadedFile.id),
        fileFixture.contents,
      );
    } finally {
      await cleanup();
    }
  },
);

postgresOnly(
  'deleteFolder restores the staged tree when the delete transaction fails',
  async () => {
    const { app, cleanup } = await createPostgresTestAppContext();

    try {
      const user = await seedUserSession(app, createUserFixture());
      const rootFolder = await createUserRootFolder(app, user.accessToken);
      const childFolder = await createFolder(
        app,
        user.accessToken,
        rootFolder.id,
      );
      const fileFixture = createFileFixture();
      const batch = await createUploadBatch(
        app,
        user.accessToken,
        childFolder.id,
      );
      const uploadItem = await createUploadItem(
        app,
        user.accessToken,
        batch.id,
        fileFixture.name,
      );
      const uploadedFile = await uploadFile(
        app,
        user.accessToken,
        uploadItem.id,
        fileFixture,
      );

      const libraryService = app.libraryService as unknown as {
        withTransaction: <T>(
          callback: (client: unknown) => Promise<T>,
        ) => Promise<T>;
      };
      const originalWithTransaction = libraryService.withTransaction;

      try {
        libraryService.withTransaction = async () => {
          throw new Error('simulated delete transaction failure');
        };

        const deleteResponse = await app.inject({
          headers: authorizationHeaders(user.accessToken),
          method: 'DELETE',
          url: `/api/folders/${childFolder.id}?recursive=true`,
        });

        assert.equal(deleteResponse.statusCode, 500);
      } finally {
        libraryService.withTransaction = originalWithTransaction;
      }

      const folderResponse = await app.inject({
        headers: authorizationHeaders(user.accessToken),
        method: 'GET',
        url: `/api/folders/${childFolder.id}`,
      });
      assert.equal(folderResponse.statusCode, 200);

      const entries = await getFolderEntries(app, user.accessToken, childFolder.id);
      assert.equal(entries.files.length, 1);
      assert.equal(entries.files[0]?.id, uploadedFile.id);
      assert.equal(
        await getFileContent(app, user.accessToken, uploadedFile.id),
        fileFixture.contents,
      );
    } finally {
      await cleanup();
    }
  },
);

postgresOnly(
  'updateFile leaves the file in its original folder when PostgreSQL update fails',
  async () => {
    const { app, cleanup } = await createPostgresTestAppContext();

    try {
      const user = await seedUserSession(app, createUserFixture());
      const rootFolder = await createUserRootFolder(app, user.accessToken);
      const sourceFolder = await createFolder(
        app,
        user.accessToken,
        rootFolder.id,
      );
      const destinationFolder = await createFolder(
        app,
        user.accessToken,
        rootFolder.id,
      );
      const fileFixture = createFileFixture();
      const batch = await createUploadBatch(
        app,
        user.accessToken,
        sourceFolder.id,
      );
      const uploadItem = await createUploadItem(
        app,
        user.accessToken,
        batch.id,
        fileFixture.name,
      );
      const uploadedFile = await uploadFile(
        app,
        user.accessToken,
        uploadItem.id,
        fileFixture,
      );

      const libraryService = app.libraryService as unknown as {
        persistMovedFileRecord: (...args: unknown[]) => Promise<unknown>;
      };
      const originalUpdate = libraryService.persistMovedFileRecord;

      try {
        libraryService.persistMovedFileRecord = async () => {
          throw new Error('simulated file update failure');
        };

        const patchResponse = await app.inject({
          headers: authorizationHeaders(user.accessToken),
          method: 'PATCH',
          payload: {
            folderId: destinationFolder.id,
            name: 'renamed-photo.jpg',
          },
          url: `/api/files/${uploadedFile.id}`,
        });

        assert.equal(patchResponse.statusCode, 500);
      } finally {
        libraryService.persistMovedFileRecord = originalUpdate;
      }

      const fileAfter = await getFile(app, user.accessToken, uploadedFile.id);
      assert.equal(fileAfter.folderId, sourceFolder.id);

      const sourceEntries = await getFolderEntries(
        app,
        user.accessToken,
        sourceFolder.id,
      );
      const destinationEntries = await getFolderEntries(
        app,
        user.accessToken,
        destinationFolder.id,
      );

      assert.equal(
        sourceEntries.files.some((file) => file.id === uploadedFile.id),
        true,
      );
      assert.equal(
        destinationEntries.files.some((file) => file.id === uploadedFile.id),
        false,
      );
      assert.equal(
        await getFileContent(app, user.accessToken, uploadedFile.id),
        fileFixture.contents,
      );
    } finally {
      await cleanup();
    }
  },
);

async function createFolder(
  app: FastifyInstance,
  accessToken: string,
  parentFolderId: string,
): Promise<FolderResponse> {
  const folderFixture = createFolderFixture();
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'POST',
    payload: {
      name: folderFixture.name,
      parentFolderId,
    },
    url: '/api/folders',
  });

  assert.equal(response.statusCode, 201);

  return response.json() as FolderResponse;
}

async function getFolderEntries(
  app: FastifyInstance,
  accessToken: string,
  folderId: string,
): Promise<FolderEntriesResponse> {
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'GET',
    url: `/api/folders/${folderId}/entries`,
  });

  assert.equal(response.statusCode, 200);

  return response.json() as FolderEntriesResponse;
}

async function getFile(
  app: FastifyInstance,
  accessToken: string,
  fileId: string,
): Promise<FileResponse> {
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'GET',
    url: `/api/files/${fileId}`,
  });

  assert.equal(response.statusCode, 200);

  return response.json() as FileResponse;
}

async function getFileContent(
  app: FastifyInstance,
  accessToken: string,
  fileId: string,
): Promise<string> {
  const response = await app.inject({
    headers: authorizationHeaders(accessToken),
    method: 'GET',
    url: `/api/files/${fileId}/content`,
  });

  assert.equal(response.statusCode, 200);

  return response.body;
}

async function expectPathMissing(absolutePath: string): Promise<void> {
  try {
    await stat(absolutePath);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return;
    }

    throw error;
  }

  assert.fail(`Expected path to be missing: ${absolutePath}`);
}

async function queryCount(
  app: FastifyInstance,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  if (app.pgPool === null) {
    throw new Error('Expected pgPool in durable test context.');
  }

  const result = await app.pgPool.query<{ count: number }>(sql, [...values]);
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('Expected count query to return a row.');
  }

  return row.count;
}
