import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';
import type {
  File,
  Folder,
  Prisma,
  PrismaClient,
  UploadBatch,
  UploadItem,
} from '@prisma/client';
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
  toFileRecord,
  toFolderRecord,
  toUploadBatchRecord,
  toUploadItemRecord,
} from './prisma-mappers.js';
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

type PrismaDatabaseClient = PrismaClient | Prisma.TransactionClient;

export class PrismaLibraryService implements LibraryServiceContract {
  private readonly prisma: PrismaClient;
  private readonly storageRoot: string;

  private isPrismaErrorCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }

  private isFsErrorCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }

  private buildUserTmpRelPath(userId: string, ...segments: string[]): string {
    return path.posix.join(buildRootStorageRelPath(userId), '_tmp', ...segments);
  }

  public constructor(prisma: PrismaClient, storageRoot: string) {
    this.prisma = prisma;
    this.storageRoot = storageRoot;
  }

  public async createFolder(
    userId: string,
    input: CreateFolderInput,
  ): Promise<FolderRecord> {
    const normalizedName = ensureValidDisplayName(input.name);
    const folderId = randomUUID();
    const now = new Date();
    let folder: Folder;

    try {
      folder = await this.prisma.$transaction(async (tx) => {
        const parentFolder = await this.getOwnedFolderWithClient(
          tx,
          userId,
          input.parentFolderId,
        );

        await this.assertSiblingFolderNameAvailableWithClient(
          tx,
          userId,
          parentFolder.id,
          normalizedName,
          null,
        );

        const storageRelPath = buildFolderStorageRelPath(
          parentFolder.storageRelPath,
          folderId,
        );

        return tx.folder.create({
          data: {
            createdAt: now,
            displayName: normalizedName,
            id: folderId,
            isRoot: false,
            parentFolderId: parentFolder.id,
            storageRelPath,
            updatedAt: now,
            userId,
          },
        });
      });
    } catch (error) {
      if (this.isPrismaErrorCode(error, 'P2002')) {
        throw new ConflictError('A sibling folder already uses that name.');
      }

      throw error;
    }

    try {
      await mkdir(this.resolveAbsolutePath(folder.storageRelPath), {
        recursive: true,
      });
    } catch (error) {
      // DB-first durability: if the directory cannot be created, remove the folder row.
      await this.prisma.folder
        .delete({
          where: {
            id: folder.id,
          },
        })
        .catch(() => undefined);
      throw error;
    }

    return toFolderRecord(folder);
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
    const batch = await this.prisma.uploadBatch.create({
      data: {
        expectedCount: input.expectedCount ?? null,
        folderId: folder.id,
        status: 'open',
        userId,
      },
    });

    return toUploadBatchRecord(batch);
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
    const existingUploadItem = await this.prisma.uploadItem.findUnique({
      where: {
        userId_batchId_clientIdempotencyKey: {
          batchId: batch.id,
          clientIdempotencyKey,
          userId,
        },
      },
    });

    if (existingUploadItem !== null) {
      return toUploadItemRecord(existingUploadItem);
    }

    let uploadItem: UploadItem;

    try {
      uploadItem = await this.prisma.uploadItem.create({
        data: {
          batchId: batch.id,
          clientIdempotencyKey,
          originalName,
          status: 'pending',
          userId,
        },
      });
    } catch (error) {
      // Another request may have created the same idempotency key concurrently.
      if (this.isPrismaErrorCode(error, 'P2002')) {
        const racedUploadItem = await this.prisma.uploadItem.findUnique({
          where: {
            userId_batchId_clientIdempotencyKey: {
              batchId: batch.id,
              clientIdempotencyKey,
              userId,
            },
          },
        });

        if (racedUploadItem !== null) {
          uploadItem = racedUploadItem;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    await this.refreshBatchStatus(batch.id);

    return toUploadItemRecord(uploadItem);
  }

  public async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getOwnedFile(userId, fileId);
    const stagedDelete = await this.stageStoragePathForDeletion(
      userId,
      file.storageRelPath,
    );

    try {
      await this.prisma.file.delete({
        where: {
          id: file.id,
        },
      });
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
    const filesToDelete = await this.prisma.file.findMany({
      where: {
        folderId: {
          in: allFolderIds,
        },
        userId,
      },
    });

    if (!recursive && (descendantFolders.length > 0 || filesToDelete.length > 0)) {
      throw new ConflictError('Folder is not empty.');
    }
    const stagedDelete = await this.stageStoragePathForDeletion(
      userId,
      folder.storageRelPath,
    );

    try {
      const uploadBatches = await this.prisma.uploadBatch.findMany({
        select: {
          id: true,
        },
        where: {
          folderId: {
            in: allFolderIds,
          },
          userId,
        },
      });
      const uploadBatchIds = uploadBatches.map((uploadBatch) => uploadBatch.id);

      await this.prisma.$transaction([
        this.prisma.uploadItem.deleteMany({
          where: {
            batchId: {
              in: uploadBatchIds,
            },
            userId,
          },
        }),
        this.prisma.uploadBatch.deleteMany({
          where: {
            id: {
              in: uploadBatchIds,
            },
            userId,
          },
        }),
        this.prisma.file.deleteMany({
          where: {
            folderId: {
              in: allFolderIds,
            },
            userId,
          },
        }),
        this.prisma.folder.deleteMany({
          where: {
            id: {
              in: allFolderIds,
            },
            userId,
          },
        }),
      ]);
    } catch (error) {
      await this.restoreStagedStoragePath(stagedDelete);
      throw error;
    }

    await this.purgeStagedStoragePath(stagedDelete);
  }

  public async ensureUserRootFolder(userId: string): Promise<FolderRecord> {
    const existingRootFolder = await this.findUserRootFolder(this.prisma, userId);

    if (existingRootFolder !== null) {
      await mkdir(this.resolveAbsolutePath(existingRootFolder.storageRelPath), {
        recursive: true,
      });
      return toFolderRecord(existingRootFolder);
    }

    const now = new Date();
    const folderId = randomUUID();
    const storageRelPath = buildRootStorageRelPath(userId);
    let rootFolder: Folder;
    let createdRootFolderRow = false;

    try {
      rootFolder = await this.prisma.folder.create({
        data: {
          createdAt: now,
          displayName: 'Root',
          id: folderId,
          isRoot: true,
          parentFolderId: null,
          storageRelPath,
          updatedAt: now,
          userId,
        },
      });
      createdRootFolderRow = true;
    } catch (error) {
      if (!this.isPrismaErrorCode(error, 'P2002')) {
        throw error;
      }

      const racedRootFolder = await this.findUserRootFolder(this.prisma, userId);

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
        await this.prisma.folder
          .delete({
            where: {
              id: rootFolder.id,
            },
          })
          .catch(() => undefined);
      }

      throw error;
    }

    return toFolderRecord(rootFolder);
  }

  public async createUserRootFolderInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    createdAt: Date,
    folderId: string = randomUUID(),
  ): Promise<string> {
    const existingRootFolder = await this.findUserRootFolder(tx, userId);

    if (existingRootFolder !== null) {
      return existingRootFolder.storageRelPath;
    }

    const storageRelPath = buildRootStorageRelPath(userId);

    await mkdir(this.resolveAbsolutePath(storageRelPath), { recursive: true });

    await tx.folder.create({
      data: {
        createdAt,
        displayName: 'Root',
        id: folderId,
        isRoot: true,
        parentFolderId: null,
        storageRelPath,
        updatedAt: createdAt,
        userId,
      },
    });

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

  public async getFilesInFolder(
    userId: string,
    folderId: string,
  ): Promise<FileRecord[]> {
    const folder = await this.getOwnedFolder(userId, folderId);
    const files = await this.prisma.file.findMany({
      orderBy: {
        displayName: 'asc',
      },
      where: {
        folderId: folder.id,
        userId,
      },
    });

    return files.map(toFileRecord);
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
      this.prisma.folder.findMany({
        orderBy: {
          displayName: 'asc',
        },
        where: {
          parentFolderId: folder.id,
          userId,
        },
      }),
      this.prisma.file.findMany({
        orderBy: {
          displayName: 'asc',
        },
        where: {
          folderId: folder.id,
          userId,
        },
      }),
    ]);

    return {
      files: files.map(toFileRecord),
      folder: toFolderRecord(folder),
      folders: childFolders.map(toFolderRecord),
    };
  }

  public async listFolders(userId: string): Promise<FolderTreeFolder[]> {
    const [fileCounts, folders] = await Promise.all([
      this.prisma.file.groupBy({
        _count: {
          _all: true,
        },
        by: ['folderId'],
        where: {
          userId,
        },
      }),
      this.prisma.folder.findMany({
        orderBy: {
          displayName: 'asc',
        },
        where: {
          userId,
        },
      }),
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
      fileCountByFolderId.set(entry.folderId, entry._count._all);
    }

    return folders.map((folder) => ({
      folder: toFolderRecord(folder),
      itemCount:
        (childFolderCountByParentId.get(folder.id) ?? 0) +
        (fileCountByFolderId.get(folder.id) ?? 0),
    }));
  }

  public async getRootFolder(userId: string): Promise<FolderRecord> {
    const rootFolder = await this.prisma.folder.findFirst({
      where: {
        isRoot: true,
        userId,
      },
    });

    if (rootFolder === null) {
      throw new NotFoundError('Root folder not found.');
    }

    return toFolderRecord(rootFolder);
  }

  public async getUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatchSnapshot> {
    const batch = await this.getOwnedUploadBatch(userId, batchId);
    const items = await this.prisma.uploadItem.findMany({
      orderBy: {
        createdAt: 'asc',
      },
      where: {
        batchId: batch.id,
        userId,
      },
    });

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

    const file = await this.getOwnedFile(userId, fileId);
    const nextName =
      input.name === undefined
        ? file.displayName
        : ensureValidDisplayName(input.name);
    const nextFolderId = input.folderId ?? file.folderId;
    const didMove = nextFolderId !== file.folderId;
    const now = new Date();

    if (!didMove) {
      const updatedFile = await this.prisma.file.update({
        data: {
          displayName: nextName,
          updatedAt: now,
        },
        where: {
          id: file.id,
        },
      });

      return toFileRecord(updatedFile);
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

    const updatedFile = await this.prisma.file.update({
      data: {
        displayName: nextName,
        folderId: nextFolder.id,
        storageRelPath: nextStorageRelPath,
        updatedAt: now,
      },
      where: {
        id: file.id,
      },
    });

    try {
      await mkdir(this.resolveAbsolutePath(nextFolder.storageRelPath), {
        recursive: true,
      });
      await rename(
        this.resolveAbsolutePath(file.storageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );
    } catch (error) {
      await this.prisma.file
        .update({
          data: {
            displayName: file.displayName,
            folderId: file.folderId,
            storageRelPath: file.storageRelPath,
            updatedAt: new Date(),
          },
          where: {
            id: file.id,
          },
        })
        .catch(() => undefined);

      throw error;
    }

    return toFileRecord(updatedFile);
  }

  public async updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderInput,
  ): Promise<FolderRecord> {
    if (input.name === undefined && input.parentFolderId === undefined) {
      throw new BadRequestError('At least one folder field must be provided.');
    }

    const folder = await this.getOwnedFolder(userId, folderId);

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
      await this.assertFolderMoveIsValid(toFolderRecord(folder), nextParentFolder.id);
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

      const updatedFolder = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE folders
          SET
            storage_rel_path = ${nextStorageRelPath} || substring(storage_rel_path FROM ${currentStorageRelPath.length + 1}),
            updated_at = ${now}
          WHERE user_id = ${userId}
            AND storage_rel_path LIKE ${`${currentStorageRelPath}/%`};
        `;
        await tx.$executeRaw`
          UPDATE files
          SET
            storage_rel_path = ${nextStorageRelPath} || substring(storage_rel_path FROM ${currentStorageRelPath.length + 1}),
            updated_at = ${now}
          WHERE user_id = ${userId}
            AND storage_rel_path LIKE ${`${currentStorageRelPath}/%`};
        `;

        return tx.folder.update({
          data: {
            displayName: nextName,
            parentFolderId: nextParentFolder.id,
            storageRelPath: nextStorageRelPath,
            updatedAt: now,
          },
          where: {
            id: folder.id,
          },
        });
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

        await this.prisma
          .$transaction(async (tx) => {
            await tx.$executeRaw`
              UPDATE folders
              SET
                storage_rel_path = ${currentStorageRelPath} || substring(storage_rel_path FROM ${nextStorageRelPath.length + 1}),
                updated_at = ${rollbackNow}
              WHERE user_id = ${userId}
                AND storage_rel_path LIKE ${`${nextStorageRelPath}/%`};
            `;
            await tx.$executeRaw`
              UPDATE files
              SET
                storage_rel_path = ${currentStorageRelPath} || substring(storage_rel_path FROM ${nextStorageRelPath.length + 1}),
                updated_at = ${rollbackNow}
              WHERE user_id = ${userId}
                AND storage_rel_path LIKE ${`${nextStorageRelPath}/%`};
            `;

            await tx.folder.update({
              data: {
                displayName: folder.displayName,
                parentFolderId: folder.parentFolderId,
                storageRelPath: currentStorageRelPath,
                updatedAt: rollbackNow,
              },
              where: {
                id: folder.id,
              },
            });
          })
          .catch(() => undefined);

        throw error;
      }

      return toFolderRecord(updatedFolder);
    }

    const updatedFolder = await this.prisma.folder.update({
      data: {
        displayName: nextName,
        updatedAt: new Date(),
      },
      where: {
        id: folder.id,
      },
    });

    return toFolderRecord(updatedFolder);
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

      const fileRecord = await this.prisma.$transaction(async (tx) => {
        const createdFile = await tx.file.create({
          data: {
            createdAt: now,
            displayName: effectiveOriginalName,
            folderId: folder.id,
            id: fileId,
            mimeType: multipartFile.mimetype || 'application/octet-stream',
            originalName: effectiveOriginalName,
            sha256: uploadStats.sha256,
            sizeBytes: BigInt(uploadStats.sizeBytes),
            status: 'ready',
            storageRelPath: finalStorageRelPath,
            storedExtension,
            updatedAt: now,
            userId,
          },
        });

        const completedUpdate = await tx.uploadItem.updateMany({
          data: {
            errorCode: null,
            fileId: createdFile.id,
            originalName: effectiveOriginalName,
            status: 'complete',
            updatedAt: new Date(),
          },
          where: {
            id: uploadItem.id,
            status: 'uploading',
            userId,
          },
        });

        if (completedUpdate.count !== 1) {
          throw new ConflictError('Upload item could not be completed.');
        }

        await this.refreshBatchStatus(batch.id, tx);

        return createdFile;
      });

      return toFileRecord(fileRecord);
    } catch (error) {
      await this.prisma.uploadItem.updateMany({
        data: {
          errorCode: this.getUploadErrorCode(error),
          status: 'failed',
          updatedAt: new Date(),
        },
        where: {
          id: uploadItem.id,
          status: 'uploading',
          userId,
        },
      });
      await this.refreshBatchStatus(batch.id);
      await this.safeUnlink(tempStorageRelPath);
      await this.safeUnlink(finalStorageRelPath);
      throw error;
    }
  }

  private async claimUploadItemForContentUpload(
    userId: string,
    uploadItemId: string,
  ): Promise<boolean> {
    const claimNow = new Date();
    const claimResult = await this.prisma.uploadItem.updateMany({
      data: {
        errorCode: null,
        status: 'uploading',
        updatedAt: claimNow,
      },
      where: {
        id: uploadItemId,
        status: {
          in: ['failed', 'pending'],
        },
        userId,
      },
    });

    return claimResult.count === 1;
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
      this.prisma,
      userId,
      parentFolderId,
      displayName,
      currentFolderId,
    );
  }

  private async assertSiblingFolderNameAvailableWithClient(
    client: PrismaDatabaseClient,
    userId: string,
    parentFolderId: string,
    displayName: string,
    currentFolderId: string | null,
  ): Promise<void> {
    const conflictingFolder = await client.folder.findFirst({
      where: {
        displayName,
        id: currentFolderId === null ? undefined : { not: currentFolderId },
        parentFolderId,
        userId,
      },
    });

    if (conflictingFolder !== null) {
      throw new ConflictError('A sibling folder already uses that name.');
    }
  }

  public async cleanupDirectoryAfterFailedFolderWrite(
    storageRelPath: string | null,
  ): Promise<void> {
    if (storageRelPath === null) {
      return;
    }

    const persistedFolder = await this.prisma.folder.findFirst({
      select: {
        id: true,
      },
      where: {
        storageRelPath,
      },
    });

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

  private async findUserRootFolder(
    client: PrismaDatabaseClient,
    userId: string,
  ): Promise<Folder | null> {
    return client.folder.findFirst({
      where: {
        isRoot: true,
        userId,
      },
    });
  }

  private async getDescendantFolders(
    userId: string,
    folderId: string,
  ): Promise<FolderRecord[]> {
    return this.prisma.$queryRaw<FolderRecord[]>`
      WITH RECURSIVE folder_tree AS (
        SELECT
          id,
          user_id AS "userId",
          parent_folder_id AS "parentFolderId",
          display_name AS "displayName",
          is_root AS "isRoot",
          storage_rel_path AS "storageRelPath",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM folders
        WHERE id = ${folderId} AND user_id = ${userId}

        UNION ALL

        SELECT
          f.id,
          f.user_id AS "userId",
          f.parent_folder_id AS "parentFolderId",
          f.display_name AS "displayName",
          f.is_root AS "isRoot",
          f.storage_rel_path AS "storageRelPath",
          f.created_at AS "createdAt",
          f.updated_at AS "updatedAt"
        FROM folders f
        INNER JOIN folder_tree t ON f.parent_folder_id = t.id
        WHERE f.user_id = ${userId}
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
      WHERE id <> ${folderId};
    `;
  }

  private async getOwnedFile(userId: string, fileId: string): Promise<File> {
    const file = await this.prisma.file.findFirst({
      where: {
        id: fileId,
        userId,
      },
    });

    if (file === null) {
      throw new NotFoundError('File not found.');
    }

    return file;
  }

  private async getOwnedFolder(
    userId: string,
    folderId: string,
  ): Promise<Folder> {
    return this.getOwnedFolderWithClient(this.prisma, userId, folderId);
  }

  private async getOwnedFolderWithClient(
    client: PrismaDatabaseClient,
    userId: string,
    folderId: string,
  ): Promise<Folder> {
    const folder = await client.folder.findFirst({
      where: {
        id: folderId,
        userId,
      },
    });

    if (folder === null) {
      throw new NotFoundError('Folder not found.');
    }

    return folder;
  }

  private async getOwnedUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatch> {
    const batch = await this.prisma.uploadBatch.findFirst({
      where: {
        id: batchId,
        userId,
      },
    });

    if (batch === null) {
      throw new NotFoundError('Upload batch not found.');
    }

    return batch;
  }

  private async getOwnedUploadItem(
    userId: string,
    itemId: string,
  ): Promise<UploadItem> {
    const uploadItem = await this.prisma.uploadItem.findFirst({
      where: {
        id: itemId,
        userId,
      },
    });

    if (uploadItem === null) {
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

  private async refreshBatchStatus(
    batchId: string,
    client: PrismaDatabaseClient = this.prisma,
  ): Promise<void> {
    const batch = await client.uploadBatch.findUnique({
      where: {
        id: batchId,
      },
    });

    if (batch === null) {
      return;
    }

    const completedCount = await client.uploadItem.count({
      where: {
        batchId,
        status: 'complete',
      },
    });
    const failedCount = await client.uploadItem.count({
      where: {
        batchId,
        status: 'failed',
      },
    });
    const processedCount = completedCount + failedCount;
    const nextStatus =
      batch.expectedCount !== null && processedCount >= batch.expectedCount
        ? failedCount > 0
          ? 'partial'
          : 'completed'
        : 'open';

    await client.uploadBatch.update({
      data: {
        completedAt:
          nextStatus === 'open'
            ? null
            : batch.completedAt ?? new Date(),
        completedCount,
        failedCount,
        status: nextStatus,
        updatedAt: new Date(),
      },
      where: {
        id: batchId,
      },
    });
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

  private async stageStoragePathForDeletion(
    userId: string,
    storageRelPath: string,
  ): Promise<StagedStorageDelete | null> {
    const stageId = randomUUID();
    const stageRootRelPath = this.buildUserTmpRelPath(userId, 'trash', stageId);
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
}

interface StagedStorageDelete {
  originalStorageRelPath: string;
  stageRootRelPath: string;
  stagedStorageRelPath: string;
}
