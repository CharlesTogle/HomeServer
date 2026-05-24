import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';
import { type Pool, type PoolClient } from 'pg';
import { MulterError } from 'multer';

import type {
  CreateFolderInput,
  CreateUploadBatchInput,
  CreateUploadItemInput,
  FileReadDescriptor,
  FolderEntries,
  FolderTreeFolder,
  LibraryServiceContract,
  UpdateFileInput,
  UpdateFolderInput,
  UploadBatchSnapshot,
} from './contracts.js';
import {
  FILE_SELECT_COLUMNS,
  FOLDER_SELECT_COLUMNS,
  SESSION_SELECT_COLUMNS,
  UPLOAD_BATCH_SELECT_COLUMNS,
  UPLOAD_ITEM_SELECT_COLUMNS,
  USER_SELECT_COLUMNS,
  type FileRow,
  type FolderRow,
  type UploadBatchRow,
  type UploadItemRow,
  toFileRecord,
  toFolderRecord,
  toUploadBatchRecord,
  toUploadItemRecord,
} from './postgres-mappers.js';
import {
  isPostgresErrorCode,
  queryOptionalRow,
  queryRequiredRow,
  queryRows,
  withPostgresTransaction,
} from './postgres-support.js';
import type {
  FileRecord,
  FolderRecord,
  UploadBatchRecord,
  UploadItemRecord,
} from '../types/domain.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../utils/http-errors.js';
import {
  buildFileStorageRelPath,
  buildFolderStorageRelPath,
  buildRootStorageRelPath,
  ensureValidDisplayName,
  ensureWithinStorageRoot,
  getStoredExtension,
} from '../utils/storage-paths.js';

interface CountRow {
  count: number;
}

interface BatchCountsRow {
  completedCount: number;
  failedCount: number;
}

interface FolderItemCountRow {
  count: number;
  folderId: string;
}

interface IdRow {
  id: string;
}

interface StagedStorageDelete {
  originalStorageRelPath: string;
  stageRootRelPath: string;
  stagedStorageRelPath: string;
}

export class PostgresLibraryService implements LibraryServiceContract {
  private readonly pool: Pool;
  private readonly storageRoot: string;

  public constructor(pool: Pool, storageRoot: string) {
    this.pool = pool;
    this.storageRoot = storageRoot;
  }

  public async createFolder(
    userId: string,
    input: CreateFolderInput,
  ): Promise<FolderRecord> {
    const normalizedName = ensureValidDisplayName(input.name);
    const folderId = randomUUID();
    const now = new Date();
    let folder: FolderRecord;

    try {
      folder = await this.withTransaction(async (client) => {
        const parentFolder = await this.getOwnedFolderWithClient(
          client,
          userId,
          input.parentFolderId,
        );

        await this.assertSiblingFolderNameAvailableWithClient(
          client,
          userId,
          parentFolder.id,
          normalizedName,
          null,
        );

        const storageRelPath = buildFolderStorageRelPath(
          parentFolder.storageRelPath,
          folderId,
        );
        const row = await queryRequiredRow<FolderRow>(
          client,
          `
            INSERT INTO folders (
              id,
              user_id,
              parent_folder_id,
              display_name,
              is_root,
              storage_rel_path,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING ${FOLDER_SELECT_COLUMNS}
          `,
          [folderId, userId, parentFolder.id, normalizedName, false, storageRelPath, now, now],
        );

        return toFolderRecord(row);
      });
    } catch (error) {
      if (isPostgresErrorCode(error, '23505')) {
        throw new ConflictError('A sibling folder already uses that name.');
      }

      throw error;
    }

    try {
      await mkdir(this.resolveAbsolutePath(folder.storageRelPath), {
        recursive: true,
      });
    } catch (error) {
      await this.pool
        .query('DELETE FROM folders WHERE id = $1', [folder.id])
        .catch(() => undefined);
      throw error;
    }

    return folder;
  }

  public async createUploadBatch(
    userId: string,
    input: CreateUploadBatchInput,
  ): Promise<UploadBatchRecord> {
    if (
      input.expectedCount !== undefined &&
      (!Number.isInteger(input.expectedCount) || input.expectedCount <= 0)
    ) {
      throw new BadRequestError('expectedCount must be a positive integer.');
    }

    const folder = await this.getOwnedFolder(userId, input.folderId);
    const batchRow = await queryRequiredRow<UploadBatchRow>(
      this.pool,
      `
        INSERT INTO upload_batches (
          user_id,
          folder_id,
          status,
          expected_count
        )
        VALUES ($1, $2, $3, $4)
        RETURNING ${UPLOAD_BATCH_SELECT_COLUMNS}
      `,
      [userId, folder.id, 'open', input.expectedCount ?? null],
    );

    return toUploadBatchRecord(batchRow);
  }

  public async createUploadItem(
    userId: string,
    batchId: string,
    input: CreateUploadItemInput,
  ): Promise<UploadItemRecord> {
    const batch = await this.getOwnedUploadBatch(userId, batchId);
    const clientIdempotencyKey = input.clientIdempotencyKey.trim();

    if (clientIdempotencyKey === '') {
      throw new BadRequestError('clientIdempotencyKey must not be empty.');
    }

    const originalName = ensureValidDisplayName(input.originalName);
    let uploadItemRow = await queryOptionalRow<UploadItemRow>(
      this.pool,
      `
        SELECT ${UPLOAD_ITEM_SELECT_COLUMNS}
        FROM upload_items
        WHERE user_id = $1
          AND batch_id = $2
          AND client_idempotency_key = $3
      `,
      [userId, batch.id, clientIdempotencyKey],
    );

    if (uploadItemRow === null) {
      uploadItemRow = await queryOptionalRow<UploadItemRow>(
        this.pool,
        `
          INSERT INTO upload_items (
            batch_id,
            user_id,
            client_idempotency_key,
            original_name,
            status
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (user_id, batch_id, client_idempotency_key) DO NOTHING
          RETURNING ${UPLOAD_ITEM_SELECT_COLUMNS}
        `,
        [batch.id, userId, clientIdempotencyKey, originalName, 'pending'],
      );

      if (uploadItemRow === null) {
        uploadItemRow = await queryRequiredRow<UploadItemRow>(
          this.pool,
          `
            SELECT ${UPLOAD_ITEM_SELECT_COLUMNS}
            FROM upload_items
            WHERE user_id = $1
              AND batch_id = $2
              AND client_idempotency_key = $3
          `,
          [userId, batch.id, clientIdempotencyKey],
        );
      }
    }

    await this.refreshBatchStatus(batch.id);

    return toUploadItemRecord(uploadItemRow);
  }

  public async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getOwnedFile(userId, fileId);
    const stagedDelete = await this.stageStoragePathForDeletion(
      userId,
      file.storageRelPath,
    );

    try {
      await this.deletePersistedFile(file.id);
    } catch (error) {
      await this.restoreStagedStoragePath(stagedDelete);
      throw error;
    }

    await this.purgeStagedStoragePath(stagedDelete);
  }

  public async deleteFolder(
    userId: string,
    folderId: string,
    recursive: boolean,
  ): Promise<void> {
    const folder = await this.getOwnedFolder(userId, folderId);

    if (folder.isRoot) {
      throw new ConflictError('The root folder cannot be deleted.');
    }

    const descendantFolders = await this.getDescendantFolders(userId, folder.id);
    const allFolders = [folder, ...descendantFolders];
    const allFolderIds = allFolders.map((entry) => entry.id);
    const filesToDelete = await queryRows<FileRow>(
      this.pool,
      `
        SELECT ${FILE_SELECT_COLUMNS}
        FROM files
        WHERE user_id = $1
          AND folder_id = ANY($2::uuid[])
      `,
      [userId, allFolderIds],
    );

    if (!recursive && (descendantFolders.length > 0 || filesToDelete.length > 0)) {
      throw new ConflictError('Folder is not empty.');
    }

    const stagedDelete = await this.stageStoragePathForDeletion(
      userId,
      folder.storageRelPath,
    );

    try {
      await this.withTransaction(async (client) => {
        await client.query(
          `
            DELETE FROM upload_items
            WHERE user_id = $1
              AND batch_id IN (
                SELECT id
                FROM upload_batches
                WHERE user_id = $1
                  AND folder_id = ANY($2::uuid[])
              )
          `,
          [userId, allFolderIds],
        );
        await client.query(
          `
            DELETE FROM upload_batches
            WHERE user_id = $1
              AND folder_id = ANY($2::uuid[])
          `,
          [userId, allFolderIds],
        );
        await client.query(
          `
            DELETE FROM files
            WHERE user_id = $1
              AND folder_id = ANY($2::uuid[])
          `,
          [userId, allFolderIds],
        );
        await client.query(
          `
            DELETE FROM folders
            WHERE user_id = $1
              AND id = ANY($2::uuid[])
          `,
          [userId, allFolderIds],
        );
      });
    } catch (error) {
      await this.restoreStagedStoragePath(stagedDelete);
      throw error;
    }

    await this.purgeStagedStoragePath(stagedDelete);
  }

  public async ensureUserRootFolder(userId: string): Promise<FolderRecord> {
    const existingRootFolder = await this.findUserRootFolder(this.pool, userId);

    if (existingRootFolder !== null) {
      await mkdir(this.resolveAbsolutePath(existingRootFolder.storageRelPath), {
        recursive: true,
      });
      return existingRootFolder;
    }

    const now = new Date();
    const folderId = randomUUID();
    const storageRelPath = buildRootStorageRelPath(userId);
    let rootFolder: FolderRecord;
    let createdRootFolderRow = false;

    try {
      const row = await queryRequiredRow<FolderRow>(
        this.pool,
        `
          INSERT INTO folders (
            id,
            user_id,
            parent_folder_id,
            display_name,
            is_root,
            storage_rel_path,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING ${FOLDER_SELECT_COLUMNS}
        `,
        [folderId, userId, null, 'Root', true, storageRelPath, now, now],
      );
      rootFolder = toFolderRecord(row);
      createdRootFolderRow = true;
    } catch (error) {
      if (!isPostgresErrorCode(error, '23505')) {
        throw error;
      }

      const racedRootFolder = await this.findUserRootFolder(this.pool, userId);

      if (racedRootFolder === null) {
        throw error;
      }

      rootFolder = racedRootFolder;
    }

    try {
      await mkdir(this.resolveAbsolutePath(rootFolder.storageRelPath), {
        recursive: true,
      });
    } catch (error) {
      if (createdRootFolderRow) {
        await this.pool
          .query('DELETE FROM folders WHERE id = $1', [rootFolder.id])
          .catch(() => undefined);
      }

      throw error;
    }

    return rootFolder;
  }

  public async createUserRootFolderInTransaction(
    client: PoolClient,
    userId: string,
    createdAt: Date,
    folderId: string = randomUUID(),
  ): Promise<string> {
    const existingRootFolder = await this.findUserRootFolder(client, userId);

    if (existingRootFolder !== null) {
      return existingRootFolder.storageRelPath;
    }

    const storageRelPath = buildRootStorageRelPath(userId);

    await mkdir(this.resolveAbsolutePath(storageRelPath), { recursive: true });
    await client.query(
      `
        INSERT INTO folders (
          id,
          user_id,
          parent_folder_id,
          display_name,
          is_root,
          storage_rel_path,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [folderId, userId, null, 'Root', true, storageRelPath, createdAt, createdAt],
    );

    return storageRelPath;
  }

  public async getFile(userId: string, fileId: string): Promise<FileRecord> {
    return toFileRecord(await this.getOwnedFile(userId, fileId));
  }

  public async getFileReadDescriptor(
    userId: string,
    fileId: string,
  ): Promise<FileReadDescriptor> {
    const file = await this.getFile(userId, fileId);
    const absolutePath = this.resolveAbsolutePath(file.storageRelPath);
    const fileStats = await stat(absolutePath);

    return {
      absolutePath,
      file,
      sizeBytes: fileStats.size,
    };
  }

  public async getFilesInFolder(userId: string, folderId: string): Promise<FileRecord[]> {
    const folder = await this.getOwnedFolder(userId, folderId);
    const rows = await queryRows<FileRow>(
      this.pool,
      `
        SELECT ${FILE_SELECT_COLUMNS}
        FROM files
        WHERE user_id = $1
          AND folder_id = $2
        ORDER BY display_name ASC
      `,
      [userId, folder.id],
    );

    return rows.map(toFileRecord);
  }

  public async getFolder(userId: string, folderId: string): Promise<FolderRecord> {
    return toFolderRecord(await this.getOwnedFolder(userId, folderId));
  }

  public async getFolderEntries(
    userId: string,
    folderId: string,
  ): Promise<FolderEntries> {
    const folder = await this.getOwnedFolder(userId, folderId);
    const [childFolders, files] = await Promise.all([
      queryRows<FolderRow>(
        this.pool,
        `
          SELECT ${FOLDER_SELECT_COLUMNS}
          FROM folders
          WHERE user_id = $1
            AND parent_folder_id = $2
          ORDER BY display_name ASC
        `,
        [userId, folder.id],
      ),
      queryRows<FileRow>(
        this.pool,
        `
          SELECT ${FILE_SELECT_COLUMNS}
          FROM files
          WHERE user_id = $1
            AND folder_id = $2
          ORDER BY display_name ASC
        `,
        [userId, folder.id],
      ),
    ]);

    return {
      files: files.map(toFileRecord),
      folder: toFolderRecord(folder),
      folders: childFolders.map(toFolderRecord),
    };
  }

  public async listFolders(userId: string): Promise<FolderTreeFolder[]> {
    const [fileCounts, folders] = await Promise.all([
      queryRows<FolderItemCountRow>(
        this.pool,
        `
          SELECT folder_id AS "folderId", COUNT(*)::int AS "count"
          FROM files
          WHERE user_id = $1
          GROUP BY folder_id
        `,
        [userId],
      ),
      queryRows<FolderRow>(
        this.pool,
        `
          SELECT ${FOLDER_SELECT_COLUMNS}
          FROM folders
          WHERE user_id = $1
          ORDER BY display_name ASC
        `,
        [userId],
      ),
    ]);
    const childFolderCountByParentId = new Map<string, number>();
    const fileCountByFolderId = new Map<string, number>();

    for (const folder of folders) {
      if (folder.parentFolderId === null) {
        continue;
      }

      childFolderCountByParentId.set(
        folder.parentFolderId,
        (childFolderCountByParentId.get(folder.parentFolderId) ?? 0) + 1,
      );
    }

    for (const entry of fileCounts) {
      fileCountByFolderId.set(entry.folderId, entry.count);
    }

    return folders.map((folder) => ({
      folder: toFolderRecord(folder),
      itemCount:
        (childFolderCountByParentId.get(folder.id) ?? 0) +
        (fileCountByFolderId.get(folder.id) ?? 0),
    }));
  }

  public async getRootFolder(userId: string): Promise<FolderRecord> {
    const rootFolder = await this.findUserRootFolder(this.pool, userId);

    if (rootFolder === null) {
      throw new NotFoundError('Root folder not found.');
    }

    return rootFolder;
  }

  public async getUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatchSnapshot> {
    const batch = await this.getOwnedUploadBatch(userId, batchId);
    const items = await queryRows<UploadItemRow>(
      this.pool,
      `
        SELECT ${UPLOAD_ITEM_SELECT_COLUMNS}
        FROM upload_items
        WHERE user_id = $1
          AND batch_id = $2
        ORDER BY created_at ASC
      `,
      [userId, batch.id],
    );

    return {
      batch: toUploadBatchRecord(batch),
      items: items.map(toUploadItemRecord),
    };
  }

  public async updateFile(
    userId: string,
    fileId: string,
    input: UpdateFileInput,
  ): Promise<FileRecord> {
    if (input.name === undefined && input.folderId === undefined) {
      throw new BadRequestError('At least one file field must be provided.');
    }

    const file = toFileRecord(await this.getOwnedFile(userId, fileId));
    const nextName =
      input.name === undefined
        ? file.displayName
        : ensureValidDisplayName(input.name);
    const nextFolderId = input.folderId ?? file.folderId;
    const didMove = nextFolderId !== file.folderId;
    const now = new Date();

    if (!didMove) {
      const row = await queryRequiredRow<FileRow>(
        this.pool,
        `
          UPDATE files
          SET
            display_name = $2,
            updated_at = $3
          WHERE id = $1
          RETURNING ${FILE_SELECT_COLUMNS}
        `,
        [file.id, nextName, now],
      );

      return toFileRecord(row);
    }

    const nextFolder = await this.getOwnedFolder(userId, nextFolderId);
    const nextStorageRelPath = buildFileStorageRelPath(
      nextFolder.storageRelPath,
      file.id,
      file.storedExtension,
    );

    await this.assertStoragePathExists(
      file.storageRelPath,
      'File content is missing on disk.',
    );
    await this.assertStoragePathDoesNotExist(nextStorageRelPath);

    const updatedFile = await this.persistMovedFileRecord(
      file.id,
      nextFolder.id,
      nextName,
      nextStorageRelPath,
      now,
    );

    try {
      await mkdir(this.resolveAbsolutePath(nextFolder.storageRelPath), {
        recursive: true,
      });
      await rename(
        this.resolveAbsolutePath(file.storageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );
    } catch (error) {
      await this.pool
        .query(
          `
            UPDATE files
            SET
              display_name = $2,
              folder_id = $3,
              storage_rel_path = $4,
              updated_at = $5
            WHERE id = $1
          `,
          [file.id, file.displayName, file.folderId, file.storageRelPath, new Date()],
        )
        .catch(() => undefined);

      throw error;
    }

    return updatedFile;
  }

  public async updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderInput,
  ): Promise<FolderRecord> {
    if (input.name === undefined && input.parentFolderId === undefined) {
      throw new BadRequestError('At least one folder field must be provided.');
    }

    const folder = toFolderRecord(await this.getOwnedFolder(userId, folderId));

    if (folder.isRoot) {
      throw new ConflictError('The root folder cannot be modified.');
    }

    const nextName =
      input.name === undefined
        ? folder.displayName
        : ensureValidDisplayName(input.name);
    const nextParentFolderId = input.parentFolderId ?? folder.parentFolderId;

    if (nextParentFolderId === null) {
      throw new BadRequestError('parentFolderId must be provided.');
    }

    const nextParentFolder = await this.getOwnedFolder(userId, nextParentFolderId);
    const didMove = folder.parentFolderId !== nextParentFolder.id;

    if (didMove) {
      await this.assertFolderMoveIsValid(folder, nextParentFolder.id);
    }

    await this.assertSiblingFolderNameAvailable(
      userId,
      nextParentFolder.id,
      nextName,
      folder.id,
    );

    if (didMove) {
      const currentStorageRelPath = folder.storageRelPath;
      const nextStorageRelPath = buildFolderStorageRelPath(
        nextParentFolder.storageRelPath,
        folder.id,
      );
      const now = new Date();

      await this.assertStoragePathExists(
        currentStorageRelPath,
        'Folder content is missing on disk.',
      );
      await this.assertStoragePathDoesNotExist(nextStorageRelPath);

      const updatedFolder = await this.withTransaction(async (client) => {
        await client.query(
          `
            UPDATE folders
            SET
              storage_rel_path = $1 || substring(storage_rel_path FROM $2),
              updated_at = $3
            WHERE user_id = $4
              AND storage_rel_path LIKE $5
          `,
          [
            nextStorageRelPath,
            currentStorageRelPath.length + 1,
            now,
            userId,
            `${currentStorageRelPath}/%`,
          ],
        );
        await client.query(
          `
            UPDATE files
            SET
              storage_rel_path = $1 || substring(storage_rel_path FROM $2),
              updated_at = $3
            WHERE user_id = $4
              AND storage_rel_path LIKE $5
          `,
          [
            nextStorageRelPath,
            currentStorageRelPath.length + 1,
            now,
            userId,
            `${currentStorageRelPath}/%`,
          ],
        );

        const row = await queryRequiredRow<FolderRow>(
          client,
          `
            UPDATE folders
            SET
              display_name = $2,
              parent_folder_id = $3,
              storage_rel_path = $4,
              updated_at = $5
            WHERE id = $1
            RETURNING ${FOLDER_SELECT_COLUMNS}
          `,
          [folder.id, nextName, nextParentFolder.id, nextStorageRelPath, now],
        );

        return toFolderRecord(row);
      });

      try {
        await mkdir(this.resolveAbsolutePath(nextParentFolder.storageRelPath), {
          recursive: true,
        });
        await rename(
          this.resolveAbsolutePath(currentStorageRelPath),
          this.resolveAbsolutePath(nextStorageRelPath),
        );
      } catch (error) {
        const rollbackNow = new Date();

        await this.withTransaction(async (client) => {
          await client.query(
            `
              UPDATE folders
              SET
                storage_rel_path = $1 || substring(storage_rel_path FROM $2),
                updated_at = $3
              WHERE user_id = $4
                AND storage_rel_path LIKE $5
            `,
            [
              currentStorageRelPath,
              nextStorageRelPath.length + 1,
              rollbackNow,
              userId,
              `${nextStorageRelPath}/%`,
            ],
          );
          await client.query(
            `
              UPDATE files
              SET
                storage_rel_path = $1 || substring(storage_rel_path FROM $2),
                updated_at = $3
              WHERE user_id = $4
                AND storage_rel_path LIKE $5
            `,
            [
              currentStorageRelPath,
              nextStorageRelPath.length + 1,
              rollbackNow,
              userId,
              `${nextStorageRelPath}/%`,
            ],
          );
          await client.query(
            `
              UPDATE folders
              SET
                display_name = $2,
                parent_folder_id = $3,
                storage_rel_path = $4,
                updated_at = $5
              WHERE id = $1
            `,
            [
              folder.id,
              folder.displayName,
              folder.parentFolderId,
              currentStorageRelPath,
              rollbackNow,
            ],
          );
        }).catch(() => undefined);

        throw error;
      }

      return updatedFolder;
    }

    const row = await queryRequiredRow<FolderRow>(
      this.pool,
      `
        UPDATE folders
        SET
          display_name = $2,
          updated_at = $3
        WHERE id = $1
        RETURNING ${FOLDER_SELECT_COLUMNS}
      `,
      [folder.id, nextName, new Date()],
    );

    return toFolderRecord(row);
  }

  public async uploadItemContent(
    userId: string,
    itemId: string,
    multipartFile: MultipartFile | undefined,
  ): Promise<FileRecord> {
    if (multipartFile === undefined) {
      throw new MulterError('LIMIT_UNEXPECTED_FILE', 'file');
    }

    const uploadItem = await this.getOwnedUploadItem(userId, itemId);

    if (uploadItem.status === 'complete' && uploadItem.fileId !== null) {
      return this.getFile(userId, uploadItem.fileId);
    }

    const claimed = await this.claimUploadItemForContentUpload(userId, uploadItem.id);

    if (!claimed) {
      const currentUploadItem = await this.getOwnedUploadItem(userId, itemId);

      if (
        currentUploadItem.status === 'complete' &&
        currentUploadItem.fileId !== null
      ) {
        return this.getFile(userId, currentUploadItem.fileId);
      }

      if (currentUploadItem.status === 'uploading') {
        throw new ConflictError('Upload item is already processing.');
      }

      throw new ConflictError('Upload item could not be claimed for processing.');
    }

    const batch = await this.getOwnedUploadBatch(userId, uploadItem.batchId);
    const folder = await this.getOwnedFolder(userId, batch.folderId);
    const effectiveOriginalName = ensureValidDisplayName(
      multipartFile.filename.trim() === ''
        ? uploadItem.originalName
        : multipartFile.filename,
    );
    const tempStorageRelPath = path.posix.join(
      buildRootStorageRelPath(userId),
      '_tmp',
      `${uploadItem.id}.part`,
    );
    const tempAbsolutePath = this.resolveAbsolutePath(tempStorageRelPath);
    const fileId = randomUUID();
    const storedExtension = getStoredExtension(effectiveOriginalName);
    const finalStorageRelPath = buildFileStorageRelPath(
      folder.storageRelPath,
      fileId,
      storedExtension,
    );
    const now = new Date();

    await mkdir(path.dirname(tempAbsolutePath), { recursive: true });
    await mkdir(this.resolveAbsolutePath(folder.storageRelPath), {
      recursive: true,
    });

    try {
      const uploadStats = await this.streamMultipartFile(
        multipartFile,
        tempAbsolutePath,
      );

      await rename(
        tempAbsolutePath,
        this.resolveAbsolutePath(finalStorageRelPath),
      );

      const fileRecord = await this.withTransaction(async (client) => {
        const createdFile = await queryRequiredRow<FileRow>(
          client,
          `
            INSERT INTO files (
              id,
              user_id,
              folder_id,
              display_name,
              original_name,
              stored_extension,
              mime_type,
              size_bytes,
              sha256,
              status,
              storage_rel_path,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING ${FILE_SELECT_COLUMNS}
          `,
          [
            fileId,
            userId,
            folder.id,
            effectiveOriginalName,
            effectiveOriginalName,
            storedExtension,
            multipartFile.mimetype || 'application/octet-stream',
            uploadStats.sizeBytes,
            uploadStats.sha256,
            'ready',
            finalStorageRelPath,
            now,
            now,
          ],
        );

        const completedUpdate = await client.query(
          `
            UPDATE upload_items
            SET
              error_code = NULL,
              file_id = $2,
              original_name = $3,
              status = $4,
              updated_at = $5
            WHERE id = $1
              AND status = 'uploading'
              AND user_id = $6
          `,
          [
            uploadItem.id,
            createdFile.id,
            effectiveOriginalName,
            'complete',
            new Date(),
            userId,
          ],
        );

        if (completedUpdate.rowCount !== 1) {
          throw new ConflictError('Upload item could not be completed.');
        }

        await this.refreshBatchStatus(batch.id, client);

        return toFileRecord(createdFile);
      });

      return fileRecord;
    } catch (error) {
      await this.pool.query(
        `
          UPDATE upload_items
          SET
            error_code = $2,
            status = $3,
            updated_at = $4
          WHERE id = $1
            AND status = 'uploading'
            AND user_id = $5
        `,
        [
          uploadItem.id,
          this.getUploadErrorCode(error),
          'failed',
          new Date(),
          userId,
        ],
      );
      await this.refreshBatchStatus(batch.id);
      await this.safeUnlink(tempStorageRelPath);
      await this.safeUnlink(finalStorageRelPath);
      throw error;
    }
  }

  public async cleanupDirectoryAfterFailedFolderWrite(
    storageRelPath: string | null,
  ): Promise<void> {
    if (storageRelPath === null) {
      return;
    }

    const persistedFolder = await queryOptionalRow<IdRow>(
      this.pool,
      `
        SELECT id
        FROM folders
        WHERE storage_rel_path = $1
      `,
      [storageRelPath],
    );

    if (persistedFolder !== null) {
      return;
    }

    try {
      await rm(this.resolveAbsolutePath(storageRelPath), {
        force: true,
        recursive: true,
      });
    } catch (error) {
      if (this.isFsErrorCode(error, 'ENOENT')) {
        return;
      }

      throw error;
    }
  }

  private async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return withPostgresTransaction(this.pool, callback);
  }

  private async deletePersistedFile(fileId: string): Promise<void> {
    await this.pool.query('DELETE FROM files WHERE id = $1', [fileId]);
  }

  private async persistMovedFileRecord(
    fileId: string,
    folderId: string,
    displayName: string,
    storageRelPath: string,
    now: Date,
  ): Promise<FileRecord> {
    const row = await queryRequiredRow<FileRow>(
      this.pool,
      `
        UPDATE files
        SET
          display_name = $2,
          folder_id = $3,
          storage_rel_path = $4,
          updated_at = $5
        WHERE id = $1
        RETURNING ${FILE_SELECT_COLUMNS}
      `,
      [fileId, displayName, folderId, storageRelPath, now],
    );

    return toFileRecord(row);
  }

  private async claimUploadItemForContentUpload(
    userId: string,
    uploadItemId: string,
  ): Promise<boolean> {
    const claimNow = new Date();
    const result = await this.pool.query<IdRow>(
      `
        UPDATE upload_items
        SET
          error_code = NULL,
          status = 'uploading',
          updated_at = $3
        WHERE id = $1
          AND user_id = $2
          AND status IN ('failed', 'pending')
        RETURNING id
      `,
      [uploadItemId, userId, claimNow],
    );

    return result.rowCount === 1;
  }

  private async assertFolderMoveIsValid(
    folder: FolderRecord,
    nextParentFolderId: string,
  ): Promise<void> {
    if (folder.id === nextParentFolderId) {
      throw new BadRequestError('A folder cannot become its own parent.');
    }

    const descendantIds = new Set(
      (await this.getDescendantFolders(folder.userId, folder.id)).map(
        (descendant) => descendant.id,
      ),
    );

    if (descendantIds.has(nextParentFolderId)) {
      throw new BadRequestError(
        'A folder cannot move inside one of its descendants.',
      );
    }
  }

  private async assertSiblingFolderNameAvailable(
    userId: string,
    parentFolderId: string,
    displayName: string,
    currentFolderId: string | null,
  ): Promise<void> {
    await this.assertSiblingFolderNameAvailableWithClient(
      this.pool,
      userId,
      parentFolderId,
      displayName,
      currentFolderId,
    );
  }

  private async assertSiblingFolderNameAvailableWithClient(
    client: Pool | PoolClient,
    userId: string,
    parentFolderId: string,
    displayName: string,
    currentFolderId: string | null,
  ): Promise<void> {
    const row = currentFolderId === null
      ? await queryOptionalRow<IdRow>(
          client,
          `
            SELECT id
            FROM folders
            WHERE user_id = $1
              AND parent_folder_id = $2
              AND display_name = $3
            LIMIT 1
          `,
          [userId, parentFolderId, displayName],
        )
      : await queryOptionalRow<IdRow>(
          client,
          `
            SELECT id
            FROM folders
            WHERE user_id = $1
              AND parent_folder_id = $2
              AND display_name = $3
              AND id <> $4
            LIMIT 1
          `,
          [userId, parentFolderId, displayName, currentFolderId],
        );

    if (row !== null) {
      throw new ConflictError('A sibling folder already uses that name.');
    }
  }

  private async findUserRootFolder(
    client: Pool | PoolClient,
    userId: string,
  ): Promise<FolderRecord | null> {
    const row = await queryOptionalRow<FolderRow>(
      client,
      `
        SELECT ${FOLDER_SELECT_COLUMNS}
        FROM folders
        WHERE is_root = TRUE
          AND user_id = $1
        LIMIT 1
      `,
      [userId],
    );

    return row === null ? null : toFolderRecord(row);
  }

  private async getDescendantFolders(
    userId: string,
    folderId: string,
  ): Promise<FolderRecord[]> {
    const rows = await queryRows<FolderRow>(
      this.pool,
      `
        WITH RECURSIVE folder_tree AS (
          SELECT
            ${FOLDER_SELECT_COLUMNS}
          FROM folders
          WHERE id = $1 AND user_id = $2

          UNION ALL

          SELECT
            ${FOLDER_SELECT_COLUMNS.replaceAll('created_at AS "createdAt"', 'f.created_at AS "createdAt"')
              .replaceAll('updated_at AS "updatedAt"', 'f.updated_at AS "updatedAt"')
              .replaceAll('id,', 'f.id,')
              .replaceAll('user_id AS "userId"', 'f.user_id AS "userId"')
              .replaceAll('parent_folder_id AS "parentFolderId"', 'f.parent_folder_id AS "parentFolderId"')
              .replaceAll('display_name AS "displayName"', 'f.display_name AS "displayName"')
              .replaceAll('is_root AS "isRoot"', 'f.is_root AS "isRoot"')
              .replaceAll('storage_rel_path AS "storageRelPath"', 'f.storage_rel_path AS "storageRelPath"')}
          FROM folders f
          INNER JOIN folder_tree t ON f.parent_folder_id = t.id
          WHERE f.user_id = $2
        )
        SELECT
          id,
          "userId",
          "parentFolderId",
          "displayName",
          "isRoot",
          "storageRelPath",
          "createdAt",
          "updatedAt"
        FROM folder_tree
        WHERE id <> $1
      `,
      [folderId, userId],
    );

    return rows.map(toFolderRecord);
  }

  private async getOwnedFile(userId: string, fileId: string): Promise<FileRow> {
    const file = await queryOptionalRow<FileRow>(
      this.pool,
      `
        SELECT ${FILE_SELECT_COLUMNS}
        FROM files
        WHERE id = $1
          AND user_id = $2
      `,
      [fileId, userId],
    );

    if (file === null) {
      throw new NotFoundError('File not found.');
    }

    return file;
  }

  private async getOwnedFolder(userId: string, folderId: string): Promise<FolderRow> {
    return this.getOwnedFolderWithClient(this.pool, userId, folderId);
  }

  private async getOwnedFolderWithClient(
    client: Pool | PoolClient,
    userId: string,
    folderId: string,
  ): Promise<FolderRow> {
    const folder = await queryOptionalRow<FolderRow>(
      client,
      `
        SELECT ${FOLDER_SELECT_COLUMNS}
        FROM folders
        WHERE id = $1
          AND user_id = $2
      `,
      [folderId, userId],
    );

    if (folder === null) {
      throw new NotFoundError('Folder not found.');
    }

    return folder;
  }

  private async getOwnedUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatchRow> {
    const batch = await queryOptionalRow<UploadBatchRow>(
      this.pool,
      `
        SELECT ${UPLOAD_BATCH_SELECT_COLUMNS}
        FROM upload_batches
        WHERE id = $1
          AND user_id = $2
      `,
      [batchId, userId],
    );

    if (batch === null) {
      throw new NotFoundError('Upload batch not found.');
    }

    return batch;
  }

  private async getOwnedUploadItem(
    userId: string,
    itemId: string,
  ): Promise<UploadItemRecord> {
    const uploadItem = await queryOptionalRow<UploadItemRow>(
      this.pool,
      `
        SELECT ${UPLOAD_ITEM_SELECT_COLUMNS}
        FROM upload_items
        WHERE id = $1
          AND user_id = $2
      `,
      [itemId, userId],
    );

    if (uploadItem === null) {
      throw new NotFoundError('Upload item not found.');
    }

    return toUploadItemRecord(uploadItem);
  }

  private getUploadErrorCode(error: unknown): string {
    if (error instanceof MulterError) {
      return error.code;
    }

    return 'UPLOAD_FAILED';
  }

  private async refreshBatchStatus(
    batchId: string,
    client: Pool | PoolClient = this.pool,
  ): Promise<void> {
    const batch = await queryOptionalRow<UploadBatchRow>(
      client,
      `
        SELECT ${UPLOAD_BATCH_SELECT_COLUMNS}
        FROM upload_batches
        WHERE id = $1
      `,
      [batchId],
    );

    if (batch === null) {
      return;
    }

    const counts = await queryRequiredRow<BatchCountsRow>(
      client,
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'complete')::int AS "completedCount",
          COUNT(*) FILTER (WHERE status = 'failed')::int AS "failedCount"
        FROM upload_items
        WHERE batch_id = $1
      `,
      [batchId],
    );
    const processedCount = counts.completedCount + counts.failedCount;
    const nextStatus =
      batch.expectedCount !== null && processedCount >= batch.expectedCount
        ? counts.failedCount > 0
          ? 'partial'
          : 'completed'
        : 'open';

    await client.query(
      `
        UPDATE upload_batches
        SET
          completed_at = $2,
          completed_count = $3,
          failed_count = $4,
          status = $5,
          updated_at = $6
        WHERE id = $1
      `,
      [
        batchId,
        nextStatus === 'open' ? null : batch.completedAt ?? new Date(),
        counts.completedCount,
        counts.failedCount,
        nextStatus,
        new Date(),
      ],
    );
  }

  private resolveAbsolutePath(storageRelPath: string): string {
    return ensureWithinStorageRoot(this.storageRoot, storageRelPath);
  }

  private async assertStoragePathExists(
    storageRelPath: string,
    message: string,
  ): Promise<void> {
    try {
      await stat(this.resolveAbsolutePath(storageRelPath));
    } catch (error) {
      if (this.isFsErrorCode(error, 'ENOENT')) {
        throw new ConflictError(message);
      }

      throw error;
    }
  }

  private async assertStoragePathDoesNotExist(storageRelPath: string): Promise<void> {
    try {
      await stat(this.resolveAbsolutePath(storageRelPath));
    } catch (error) {
      if (this.isFsErrorCode(error, 'ENOENT')) {
        return;
      }

      throw error;
    }

    throw new ConflictError('Destination already exists on disk.');
  }

  private async purgeStagedStoragePath(
    stagedDelete: StagedStorageDelete | null,
  ): Promise<void> {
    if (stagedDelete === null) {
      return;
    }

    await rm(this.resolveAbsolutePath(stagedDelete.stageRootRelPath), {
      force: true,
      recursive: true,
    });
  }

  private async restoreStagedStoragePath(
    stagedDelete: StagedStorageDelete | null,
  ): Promise<void> {
    if (stagedDelete === null) {
      return;
    }

    await mkdir(
      path.dirname(this.resolveAbsolutePath(stagedDelete.originalStorageRelPath)),
      {
        recursive: true,
      },
    );
    await rename(
      this.resolveAbsolutePath(stagedDelete.stagedStorageRelPath),
      this.resolveAbsolutePath(stagedDelete.originalStorageRelPath),
    );
    await this.purgeStagedStoragePath(stagedDelete);
  }

  private async safeUnlink(storageRelPath: string): Promise<void> {
    try {
      await unlink(this.resolveAbsolutePath(storageRelPath));
    } catch (error) {
      if (this.isFsErrorCode(error, 'ENOENT')) {
        return;
      }

      throw error;
    }
  }

  private async stageStoragePathForDeletion(
    userId: string,
    storageRelPath: string,
  ): Promise<StagedStorageDelete | null> {
    const stageId = randomUUID();
    const stageRootRelPath = path.posix.join(
      buildRootStorageRelPath(userId),
      '_tmp',
      'trash',
      stageId,
    );
    const stagedStorageRelPath = path.posix.join(
      stageRootRelPath,
      path.posix.basename(storageRelPath),
    );
    const stagedDelete: StagedStorageDelete = {
      originalStorageRelPath: storageRelPath,
      stageRootRelPath,
      stagedStorageRelPath,
    };

    await mkdir(path.dirname(this.resolveAbsolutePath(stagedStorageRelPath)), {
      recursive: true,
    });

    try {
      await rename(
        this.resolveAbsolutePath(storageRelPath),
        this.resolveAbsolutePath(stagedStorageRelPath),
      );
    } catch (error) {
      await this.purgeStagedStoragePath(stagedDelete);

      if (this.isFsErrorCode(error, 'ENOENT')) {
        return null;
      }

      throw error;
    }

    return stagedDelete;
  }

  private async streamMultipartFile(
    multipartFile: MultipartFile,
    destinationPath: string,
  ): Promise<{ sha256: string; sizeBytes: number }> {
    let sizeBytes = 0;
    const hash = createHash('sha256');
    const hashTransform = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

        hash.update(buffer);
        sizeBytes += buffer.length;
        callback(null, buffer);
      },
    });

    await pipeline(
      multipartFile.file,
      hashTransform,
      createWriteStream(destinationPath),
    );

    if (multipartFile.file.truncated) {
      throw new MulterError('LIMIT_FILE_SIZE', 'file');
    }

    return {
      sha256: hash.digest('hex'),
      sizeBytes,
    };
  }

  private isFsErrorCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}
