import assert from 'node:assert/strict';

import type {
  FileResponse,
  FolderEntriesResponse,
  FolderResponse,
  FolderTreeResponse,
} from '../../src/types/api.js';
import {
  authorizationHeaders,
  type TestAppContextFactory,
  createUploadBatch,
  createUploadItem,
  createUserRootFolder,
  seedUserSession,
  uploadFile,
} from './app.js';
import {
  createFileFixture,
  createFolderFixture,
  createUserFixture,
} from './faker.js';

export async function runLibraryOwnershipAndBrowseScenario(
  createAppContext: TestAppContextFactory,
): Promise<void> {
  const { app, cleanup } = await createAppContext();

  try {
    const firstUser = await seedUserSession(app, createUserFixture());
    const secondUser = await seedUserSession(app, createUserFixture());
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

    const folderTreeResponse = await app.inject({
      headers: authorizationHeaders(firstUser.accessToken),
      method: 'GET',
      url: '/api/folders/tree',
    });

    assert.equal(folderTreeResponse.statusCode, 200);

    const folderTree = folderTreeResponse.json() as FolderTreeResponse;
    const rootTreeFolder = folderTree.folders.find((folder) => folder.id === rootFolder.id);
    const destinationTreeFolder = folderTree.folders.find(
      (folder) => folder.id === destinationFolder.id,
    );
    const nestedTreeFolder = folderTree.folders.find(
      (folder) => folder.id === nestedFolder.id,
    );

    assert.equal(rootTreeFolder?.itemCount, 2);
    assert.equal(destinationTreeFolder?.itemCount, 1);
    assert.equal(nestedTreeFolder?.itemCount, 0);

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
    assert.equal(
      (renamedFileResponse.json() as FileResponse).folderId,
      nestedFolder.id,
    );

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
}

async function createFolder(
  app: Awaited<ReturnType<TestAppContextFactory>>['app'],
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
