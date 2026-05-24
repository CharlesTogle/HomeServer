import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  FileResponse,
  FolderEntriesResponse,
  FolderResponse,
} from '../src/types/api.js';
import {
  authorizationHeaders,
  createTestAppContext,
  createUploadBatch,
  createUploadItem,
  createUserRootFolder,
  registerUser,
  uploadFile,
} from './support/app.js';
import {
  createFileFixture,
  createFolderFixture,
  createUserFixture,
} from './support/faker.js';

test('authenticated users can manage their own folders and files only', async () => {
  const { app, cleanup } = await createTestAppContext();

  try {
    const firstUser = await registerUser(app, createUserFixture());
    const secondUser = await registerUser(app, createUserFixture());
    const rootFolder = await createUserRootFolder(app, firstUser.accessToken);
    const destinationFolder = await createFolder(
      app,
      firstUser.accessToken,
      rootFolder.id,
    );
    const nestedFolder = await createFolder(
      app,
      firstUser.accessToken,
      rootFolder.id,
    );
    const fileFixture = createFileFixture();
    const batch = await createUploadBatch(
      app,
      firstUser.accessToken,
      destinationFolder.id,
    );
    const uploadItem = await createUploadItem(
      app,
      firstUser.accessToken,
      batch.id,
      fileFixture.name,
    );
    const uploadedFile = await uploadFile(
      app,
      firstUser.accessToken,
      uploadItem.id,
      fileFixture,
    );

    const folderEntriesResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'GET',
      url: `/api/folders/${destinationFolder.id}/entries`,
    });

    assert.equal(folderEntriesResponse.statusCode, 200);

    const folderEntries = folderEntriesResponse.json() as FolderEntriesResponse;
    assert.equal(folderEntries.files.length, 1);
    assert.equal(folderEntries.files[0]?.id, uploadedFile.id);

    const fileResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'GET',
      url: `/api/files/${uploadedFile.id}`,
    });

    assert.equal(fileResponse.statusCode, 200);
    assert.equal((fileResponse.json() as FileResponse).id, uploadedFile.id);

    const rangeResponse = await app.inject({
      headers: {
        ...authorizationHeaders(firstUser.accessToken),
        range: 'bytes=0-4',
      },
      method: 'GET',
      url: `/api/files/${uploadedFile.id}/content`,
    });

    assert.equal(rangeResponse.statusCode, 206);
    assert.equal(rangeResponse.body, fileFixture.contents.slice(0, 5));

    const unauthorizedFileResponse = await app.inject({
      headers: authorizationHeaders(secondUser.accessToken),
      method: 'GET',
      url: `/api/files/${uploadedFile.id}`,
    });

    assert.equal(unauthorizedFileResponse.statusCode, 404);

    const renamedFileResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'PATCH',
      payload: {
        folderId: nestedFolder.id,
        name: 'renamed-photo.jpg',
      },
      url: `/api/files/${uploadedFile.id}`,
    });

    assert.equal(renamedFileResponse.statusCode, 200);
    assert.equal((renamedFileResponse.json() as FileResponse).folderId, nestedFolder.id);

    const movedFolderFilesResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'GET',
      url: `/api/files?folderId=${nestedFolder.id}`,
    });

    assert.equal(movedFolderFilesResponse.statusCode, 200);
    assert.equal((movedFolderFilesResponse.json() as FileResponse[]).length, 1);

    const deleteFileResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'DELETE',
      url: `/api/files/${uploadedFile.id}`,
    });

    assert.equal(deleteFileResponse.statusCode, 204);

    const missingFileResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'GET',
      url: `/api/files/${uploadedFile.id}`,
    });

    assert.equal(missingFileResponse.statusCode, 404);
  } finally {
    await cleanup();
  }
});

async function createFolder(
  app: Awaited<ReturnType<typeof createTestAppContext>>['app'],
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
