import { createWriteStream } from 'node:fs';
import {
  mkdir,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';
import { MulterError } from 'multer';
import pLimit from 'p-limit';

import type {
  CreateFolderInput,
  CreateUploadBatchInput,
  CreateUploadItemInput,
  FileReadDescriptor,
  FolderEntries,
  LibraryServiceContract,
  UpdateFileInput,
  UpdateFolderInput,
  UploadBatchSnapshot,
} from './contracts.js';
import { InMemoryHomeServerStore } from '../store/in-memory-store.js';
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
  replaceStoragePathPrefix,
} from '../utils/storage-paths.js';

export class LibraryService implements LibraryServiceContract {
  private readonly deleteLimiter = pLimit(4);
  private readonly store: InMemoryHomeServerStore;
  private readonly storageRoot: string;

  public constructor(store: InMemoryHomeServerStore, storageRoot: string) {
    this.store = store;
    this.storageRoot = storageRoot;
  }

  public async createFolder(
    userId: string,
    input: CreateFolderInput,
  ): Promise<FolderRecord> {
    const normalizedName = ensureValidDisplayName(input.name);
    const parentFolder = this.getOwnedFolder(userId, input.parentFolderId);

    this.assertSiblingFolderNameAvailable(
      userId,
      parentFolder.id,
      normalizedName,
      null,
    );

    const now = new Date();
    const folderId = randomUUID();
    const storageRelPath = buildFolderStorageRelPath(
      parentFolder.storageRelPath,
      folderId,
    );
    const folderRecord: FolderRecord = {
      createdAt: now,
      displayName: normalizedName,
      id: folderId,
      isRoot: false,
      parentFolderId: parentFolder.id,
      storageRelPath,
      updatedAt: now,
      userId,
    };

    await mkdir(this.resolveAbsolutePath(storageRelPath), { recursive: true });

    this.store.folders.set(folderId, folderRecord);

    return folderRecord;
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

    const folder = this.getOwnedFolder(userId, input.folderId);
    const now = new Date();
    const batchRecord: UploadBatchRecord = {
      completedAt: null,
      completedCount: 0,
      createdAt: now,
      expectedCount: input.expectedCount ?? null,
      failedCount: 0,
      folderId: folder.id,
      id: randomUUID(),
      status: 'open',
      updatedAt: now,
      userId,
    };

    this.store.uploadBatches.set(batchRecord.id, batchRecord);

    return batchRecord;
  }

  public async createUploadItem(
    userId: string,
    batchId: string,
    input: CreateUploadItemInput,
  ): Promise<UploadItemRecord> {
    const batch = this.getOwnedUploadBatch(userId, batchId);
    const clientIdempotencyKey = input.clientIdempotencyKey.trim();

    if (clientIdempotencyKey === '') {
      throw new BadRequestError('clientIdempotencyKey must not be empty.');
    }

    const originalName = ensureValidDisplayName(input.originalName);
    const idempotencyKey = this.getUploadItemIdempotencyKey(
      userId,
      batch.id,
      clientIdempotencyKey,
    );
    const existingItemId = this.store.uploadItemByIdempotencyKey.get(
      idempotencyKey,
    );

    if (existingItemId !== undefined) {
      const existingItem = this.store.uploadItems.get(existingItemId);

      if (existingItem !== undefined) {
        return existingItem;
      }
    }

    const now = new Date();
    const uploadItem: UploadItemRecord = {
      batchId: batch.id,
      clientIdempotencyKey,
      createdAt: now,
      errorCode: null,
      fileId: null,
      id: randomUUID(),
      originalName,
      status: 'pending',
      updatedAt: now,
      userId,
    };

    this.store.uploadItems.set(uploadItem.id, uploadItem);
    this.store.uploadItemByIdempotencyKey.set(idempotencyKey, uploadItem.id);
    this.syncBatchStatus(batch.id);

    return uploadItem;
  }

  public async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = this.getOwnedFile(userId, fileId);

    await this.safeUnlink(file.storageRelPath);
    this.store.files.delete(file.id);
  }

  public async deleteFolder(
    userId: string,
    folderId: string,
    recursive: boolean,
  ): Promise<void> {
    const folder = this.getOwnedFolder(userId, folderId);

    if (folder.isRoot) {
      throw new ConflictError('The root folder cannot be deleted.');
    }

    const descendantFolders = this.getDescendantFolders(userId, folder.id);
    const allFolderIds = new Set<string>([
      folder.id,
      ...descendantFolders.map((entry) => entry.id),
    ]);
    const filesToDelete = [...this.store.files.values()].filter((fileRecord) =>
      allFolderIds.has(fileRecord.folderId),
    );

    if (!recursive && (descendantFolders.length > 0 || filesToDelete.length > 0)) {
      throw new ConflictError('Folder is not empty.');
    }

    await Promise.all(
      filesToDelete.map((fileRecord) =>
        this.deleteLimiter(() => this.safeUnlink(fileRecord.storageRelPath)),
      ),
    );

    const orderedFolders = [folder, ...descendantFolders].sort(
      (left, right) =>
        right.storageRelPath.split('/').length -
        left.storageRelPath.split('/').length,
    );

    await Promise.all(
      orderedFolders.map((folderRecord) =>
        this.deleteLimiter(async () => {
          await rm(this.resolveAbsolutePath(folderRecord.storageRelPath), {
            force: true,
            recursive: false,
          });
        }),
      ),
    );

    for (const fileRecord of filesToDelete) {
      this.store.files.delete(fileRecord.id);
    }

    for (const folderRecord of orderedFolders) {
      this.store.folders.delete(folderRecord.id);
    }
  }

  public async ensureUserRootFolder(userId: string): Promise<FolderRecord> {
    const existingRootFolderId = this.store.rootFolderByUserId.get(userId);

    if (existingRootFolderId !== undefined) {
      const existingRootFolder = this.store.folders.get(existingRootFolderId);

      if (existingRootFolder !== undefined) {
        return existingRootFolder;
      }
    }

    const now = new Date();
    const rootFolder: FolderRecord = {
      createdAt: now,
      displayName: 'Root',
      id: randomUUID(),
      isRoot: true,
      parentFolderId: null,
      storageRelPath: buildRootStorageRelPath(userId),
      updatedAt: now,
      userId,
    };

    await mkdir(this.resolveAbsolutePath(rootFolder.storageRelPath), {
      recursive: true,
    });

    this.store.folders.set(rootFolder.id, rootFolder);
    this.store.rootFolderByUserId.set(userId, rootFolder.id);

    return rootFolder;
  }

  public async getFile(userId: string, fileId: string): Promise<FileRecord> {
    return this.getOwnedFile(userId, fileId);
  }

  public async getFilesInFolder(
    userId: string,
    folderId: string,
  ): Promise<FileRecord[]> {
    const folder = this.getOwnedFolder(userId, folderId);

    return [...this.store.files.values()]
      .filter(
        (fileRecord) =>
          fileRecord.userId === userId && fileRecord.folderId === folder.id,
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public async getFolder(
    userId: string,
    folderId: string,
  ): Promise<FolderRecord> {
    return this.getOwnedFolder(userId, folderId);
  }

  public async getFolderEntries(
    userId: string,
    folderId: string,
  ): Promise<FolderEntries> {
    const folder = this.getOwnedFolder(userId, folderId);
    const childFolders = [...this.store.folders.values()]
      .filter(
        (folderRecord) =>
          folderRecord.userId === userId &&
          folderRecord.parentFolderId === folder.id,
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    const files = await this.getFilesInFolder(userId, folder.id);

    return {
      files,
      folder,
      folders: childFolders,
    };
  }

  public async getRootFolder(userId: string): Promise<FolderRecord> {
    const rootFolderId = this.store.rootFolderByUserId.get(userId);

    if (rootFolderId === undefined) {
      throw new NotFoundError('Root folder not found.');
    }

    const rootFolder = this.store.folders.get(rootFolderId);

    if (rootFolder === undefined) {
      throw new NotFoundError('Root folder not found.');
    }

    return rootFolder;
  }

  public async getUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatchSnapshot> {
    const batch = this.getOwnedUploadBatch(userId, batchId);
    const items = [...this.store.uploadItems.values()]
      .filter((uploadItem) => uploadItem.batchId === batch.id)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    this.syncBatchStatus(batch.id);

    return {
      batch,
      items,
    };
  }

  public async getFileReadDescriptor(
    userId: string,
    fileId: string,
  ): Promise<FileReadDescriptor> {
    const file = this.getOwnedFile(userId, fileId);
    const absolutePath = this.resolveAbsolutePath(file.storageRelPath);
    const fileStats = await stat(absolutePath);

    return {
      absolutePath,
      file,
      sizeBytes: fileStats.size,
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

    const file = this.getOwnedFile(userId, fileId);
    const nextName =
      input.name === undefined
        ? file.displayName
        : ensureValidDisplayName(input.name);
    const nextFolder =
      input.folderId === undefined
        ? this.getOwnedFolder(userId, file.folderId)
        : this.getOwnedFolder(userId, input.folderId);

    if (file.folderId !== nextFolder.id) {
      const nextStorageRelPath = buildFileStorageRelPath(
        nextFolder.storageRelPath,
        file.id,
        file.storedExtension,
      );

      await mkdir(this.resolveAbsolutePath(nextFolder.storageRelPath), {
        recursive: true,
      });
      await rename(
        this.resolveAbsolutePath(file.storageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );

      file.folderId = nextFolder.id;
      file.storageRelPath = nextStorageRelPath;
    }

    file.displayName = nextName;
    file.updatedAt = new Date();

    return file;
  }

  public async updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderInput,
  ): Promise<FolderRecord> {
    if (input.name === undefined && input.parentFolderId === undefined) {
      throw new BadRequestError('At least one folder field must be provided.');
    }

    const folder = this.getOwnedFolder(userId, folderId);

    if (folder.isRoot) {
      throw new ConflictError('The root folder cannot be modified.');
    }

    const nextName =
      input.name === undefined
        ? folder.displayName
        : ensureValidDisplayName(input.name);
    const nextParentFolder =
      input.parentFolderId === undefined
        ? this.getOwnedFolder(
            userId,
            folder.parentFolderId ?? (await this.getRootFolder(userId)).id,
          )
        : this.getOwnedFolder(userId, input.parentFolderId);

    this.assertFolderMoveIsValid(folder, nextParentFolder.id);
    this.assertSiblingFolderNameAvailable(
      userId,
      nextParentFolder.id,
      nextName,
      folder.id,
    );

    if (folder.parentFolderId !== nextParentFolder.id) {
      const currentStorageRelPath = folder.storageRelPath;
      const nextStorageRelPath = buildFolderStorageRelPath(
        nextParentFolder.storageRelPath,
        folder.id,
      );
      const descendants = this.getDescendantFolders(userId, folder.id);
      const files = [...this.store.files.values()].filter((fileRecord) =>
        fileRecord.storageRelPath.startsWith(`${currentStorageRelPath}/`),
      );

      await mkdir(this.resolveAbsolutePath(nextParentFolder.storageRelPath), {
        recursive: true,
      });
      await rename(
        this.resolveAbsolutePath(currentStorageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );

      folder.parentFolderId = nextParentFolder.id;
      folder.storageRelPath = nextStorageRelPath;

      for (const descendant of descendants) {
        descendant.storageRelPath = replaceStoragePathPrefix(
          descendant.storageRelPath,
          currentStorageRelPath,
          nextStorageRelPath,
        );
        descendant.updatedAt = new Date();
      }

      for (const fileRecord of files) {
        fileRecord.storageRelPath = replaceStoragePathPrefix(
          fileRecord.storageRelPath,
          currentStorageRelPath,
          nextStorageRelPath,
        );
        fileRecord.updatedAt = new Date();
      }
    }

    folder.displayName = nextName;
    folder.updatedAt = new Date();

    return folder;
  }

  public async uploadItemContent(
    userId: string,
    itemId: string,
    multipartFile: MultipartFile | undefined,
  ): Promise<FileRecord> {
    if (multipartFile === undefined) {
      throw new MulterError('LIMIT_UNEXPECTED_FILE', 'file');
    }

    const uploadItem = this.getOwnedUploadItem(userId, itemId);

    if (uploadItem.status === 'uploading') {
      throw new ConflictError('Upload item is already processing.');
    }

    if (uploadItem.status === 'complete' && uploadItem.fileId !== null) {
      return this.getOwnedFile(userId, uploadItem.fileId);
    }

    const batch = this.getOwnedUploadBatch(userId, uploadItem.batchId);
    const folder = this.getOwnedFolder(userId, batch.folderId);
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

    uploadItem.status = 'uploading';
    uploadItem.errorCode = null;
    uploadItem.updatedAt = now;

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

      const fileRecord: FileRecord = {
        createdAt: now,
        displayName: effectiveOriginalName,
        folderId: folder.id,
        id: fileId,
        mimeType: multipartFile.mimetype || 'application/octet-stream',
        originalName: effectiveOriginalName,
        sha256: uploadStats.sha256,
        sizeBytes: uploadStats.sizeBytes,
        status: 'ready',
        storageRelPath: finalStorageRelPath,
        storedExtension,
        updatedAt: now,
        userId,
      };

      uploadItem.fileId = fileRecord.id;
      uploadItem.originalName = effectiveOriginalName;
      uploadItem.status = 'complete';
      uploadItem.updatedAt = new Date();

      this.store.files.set(fileRecord.id, fileRecord);
      this.syncBatchStatus(batch.id);

      return fileRecord;
    } catch (error) {
      uploadItem.errorCode = this.getUploadErrorCode(error);
      uploadItem.status = 'failed';
      uploadItem.updatedAt = new Date();
      this.syncBatchStatus(batch.id);
      await this.safeUnlink(tempStorageRelPath);
      throw error;
    }
  }

  private assertFolderMoveIsValid(
    folder: FolderRecord,
    nextParentFolderId: string,
  ): void {
    if (folder.id === nextParentFolderId) {
      throw new BadRequestError('A folder cannot become its own parent.');
    }

    const descendantIds = new Set(
      this.getDescendantFolders(folder.userId, folder.id).map(
        (descendant) => descendant.id,
      ),
    );

    if (descendantIds.has(nextParentFolderId)) {
      throw new BadRequestError(
        'A folder cannot move inside one of its descendants.',
      );
    }
  }

  private assertSiblingFolderNameAvailable(
    userId: string,
    parentFolderId: string,
    displayName: string,
    currentFolderId: string | null,
  ): void {
    const conflictingFolder = [...this.store.folders.values()].find(
      (folderRecord) =>
        folderRecord.userId === userId &&
        folderRecord.parentFolderId === parentFolderId &&
        folderRecord.displayName.toLowerCase() === displayName.toLowerCase() &&
        folderRecord.id !== currentFolderId,
    );

    if (conflictingFolder !== undefined) {
      throw new ConflictError('A sibling folder already uses that name.');
    }
  }

  private getDescendantFolders(
    userId: string,
    folderId: string,
  ): FolderRecord[] {
    const descendants: FolderRecord[] = [];
    const stack = [folderId];

    while (stack.length > 0) {
      const currentFolderId = stack.pop();

      if (currentFolderId === undefined) {
        continue;
      }

      const children = [...this.store.folders.values()].filter(
        (folderRecord) =>
          folderRecord.userId === userId &&
          folderRecord.parentFolderId === currentFolderId,
      );

      for (const childFolder of children) {
        descendants.push(childFolder);
        stack.push(childFolder.id);
      }
    }

    return descendants;
  }

  private getOwnedFile(userId: string, fileId: string): FileRecord {
    const file = this.store.files.get(fileId);

    if (file === undefined || file.userId !== userId) {
      throw new NotFoundError('File not found.');
    }

    return file;
  }

  private getOwnedFolder(userId: string, folderId: string): FolderRecord {
    const folder = this.store.folders.get(folderId);

    if (folder === undefined || folder.userId !== userId) {
      throw new NotFoundError('Folder not found.');
    }

    return folder;
  }

  private getOwnedUploadBatch(
    userId: string,
    batchId: string,
  ): UploadBatchRecord {
    const batch = this.store.uploadBatches.get(batchId);

    if (batch === undefined || batch.userId !== userId) {
      throw new NotFoundError('Upload batch not found.');
    }

    return batch;
  }

  private getOwnedUploadItem(
    userId: string,
    itemId: string,
  ): UploadItemRecord {
    const uploadItem = this.store.uploadItems.get(itemId);

    if (uploadItem === undefined || uploadItem.userId !== userId) {
      throw new NotFoundError('Upload item not found.');
    }

    return uploadItem;
  }

  private getUploadErrorCode(error: unknown): string {
    if (error instanceof MulterError) {
      return error.code;
    }

    return 'UPLOAD_FAILED';
  }

  private getUploadItemIdempotencyKey(
    userId: string,
    batchId: string,
    clientIdempotencyKey: string,
  ): string {
    return `${userId}:${batchId}:${clientIdempotencyKey}`;
  }

  private resolveAbsolutePath(storageRelPath: string): string {
    return ensureWithinStorageRoot(this.storageRoot, storageRelPath);
  }

  private async safeUnlink(storageRelPath: string): Promise<void> {
    try {
      await unlink(this.resolveAbsolutePath(storageRelPath));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === 'ENOENT'
      ) {
        return;
      }

      throw error;
    }
  }

  private syncBatchStatus(batchId: string): void {
    const batch = this.store.uploadBatches.get(batchId);

    if (batch === undefined) {
      return;
    }

    const items = [...this.store.uploadItems.values()].filter(
      (uploadItem) => uploadItem.batchId === batchId,
    );
    const completedCount = items.filter(
      (uploadItem) => uploadItem.status === 'complete',
    ).length;
    const failedCount = items.filter(
      (uploadItem) => uploadItem.status === 'failed',
    ).length;
    const processedCount = completedCount + failedCount;

    batch.completedCount = completedCount;
    batch.failedCount = failedCount;
    batch.updatedAt = new Date();

    if (batch.expectedCount !== null && processedCount >= batch.expectedCount) {
      batch.status = failedCount > 0 ? 'partial' : 'completed';
      batch.completedAt = new Date();
      return;
    }

    batch.status = 'open';
    batch.completedAt = null;
  }

  private async streamMultipartFile(
    multipartFile: MultipartFile,
    destinationPath: string,
  ): Promise<{ sha256: string; sizeBytes: number }> {
    const hash = createHash('sha256');
    let sizeBytes = 0;
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
}
