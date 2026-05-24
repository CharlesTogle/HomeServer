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
  replaceStoragePathPrefix,
} from '../utils/storage-paths.js';

type PrismaDatabaseClient = PrismaClient | Prisma.TransactionClient;

export class PrismaLibraryService implements LibraryServiceContract {
  private readonly deleteLimiter = pLimit(4);
  private readonly prisma: PrismaClient;
  private readonly storageRoot: string;

  public constructor(prisma: PrismaClient, storageRoot: string) {
    this.prisma = prisma;
    this.storageRoot = storageRoot;
  }

  public async createFolder(
    userId: string,
    input: CreateFolderInput,
  ): Promise<FolderRecord> {
    const normalizedName = ensureValidDisplayName(input.name);
    const parentFolder = await this.getOwnedFolder(userId, input.parentFolderId);

    await this.assertSiblingFolderNameAvailable(
      userId,
      parentFolder.id,
      normalizedName,
      null,
    );

    const folderId = randomUUID();
    const now = new Date();
    const storageRelPath = buildFolderStorageRelPath(
      parentFolder.storageRelPath,
      folderId,
    );

    await mkdir(this.resolveAbsolutePath(storageRelPath), { recursive: true });

    const folder = await this.prisma.folder.create({
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

    const uploadItem = await this.prisma.uploadItem.create({
      data: {
        batchId: batch.id,
        clientIdempotencyKey,
        originalName,
        status: 'pending',
        userId,
      },
    });

    await this.refreshBatchStatus(batch.id);

    return toUploadItemRecord(uploadItem);
  }

  public async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getOwnedFile(userId, fileId);

    await this.safeUnlink(file.storageRelPath);
    await this.prisma.file.delete({
      where: {
        id: file.id,
      },
    });
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

    await Promise.all(
      filesToDelete.map((fileRecord) =>
        this.deleteLimiter(() => this.safeUnlink(fileRecord.storageRelPath)),
      ),
    );

    await rm(this.resolveAbsolutePath(folder.storageRelPath), {
      force: true,
      recursive,
    });

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
  }

  public async ensureUserRootFolder(userId: string): Promise<FolderRecord> {
    const existingRootFolder = await this.prisma.folder.findFirst({
      where: {
        isRoot: true,
        userId,
      },
    });

    if (existingRootFolder !== null) {
      return toFolderRecord(existingRootFolder);
    }

    const now = new Date();
    const folderId = randomUUID();
    const storageRelPath = buildRootStorageRelPath(userId);

    await mkdir(this.resolveAbsolutePath(storageRelPath), { recursive: true });

    try {
      const rootFolder = await this.prisma.folder.create({
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

      return toFolderRecord(rootFolder);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const rootFolder = await this.prisma.folder.findFirst({
          where: {
            isRoot: true,
            userId,
          },
        });

        if (rootFolder !== null) {
          return toFolderRecord(rootFolder);
        }
      }

      throw error;
    }
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
    const nextFolder =
      input.folderId === undefined
        ? await this.getOwnedFolder(userId, file.folderId)
        : await this.getOwnedFolder(userId, input.folderId);
    let nextStorageRelPath = file.storageRelPath;

    if (file.folderId !== nextFolder.id) {
      nextStorageRelPath = buildFileStorageRelPath(
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
    }

    const updatedFile = await this.prisma.file.update({
      data: {
        displayName: nextName,
        folderId: nextFolder.id,
        storageRelPath: nextStorageRelPath,
        updatedAt: new Date(),
      },
      where: {
        id: file.id,
      },
    });

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
    const nextParentFolder =
      input.parentFolderId === undefined
        ? await this.getOwnedFolder(userId, folder.parentFolderId ?? '')
        : await this.getOwnedFolder(userId, input.parentFolderId);

    await this.assertFolderMoveIsValid(toFolderRecord(folder), nextParentFolder.id);
    await this.assertSiblingFolderNameAvailable(
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
      const descendants = await this.getDescendantFolders(userId, folder.id);
      const files = await this.prisma.file.findMany({
        where: {
          storageRelPath: {
            startsWith: `${currentStorageRelPath}/`,
          },
          userId,
        },
      });
      const now = new Date();

      await mkdir(this.resolveAbsolutePath(nextParentFolder.storageRelPath), {
        recursive: true,
      });
      await rename(
        this.resolveAbsolutePath(currentStorageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );

      const updatedRootFolder = await this.prisma.$transaction(async (tx) => {
        for (const descendant of descendants) {
          await tx.folder.update({
            data: {
              storageRelPath: replaceStoragePathPrefix(
                descendant.storageRelPath,
                currentStorageRelPath,
                nextStorageRelPath,
              ),
              updatedAt: now,
            },
            where: {
              id: descendant.id,
            },
          });
        }

        for (const fileRecord of files) {
          await tx.file.update({
            data: {
              storageRelPath: replaceStoragePathPrefix(
                fileRecord.storageRelPath,
                currentStorageRelPath,
                nextStorageRelPath,
              ),
              updatedAt: now,
            },
            where: {
              id: fileRecord.id,
            },
          });
        }

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

      return toFolderRecord(updatedRootFolder);
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

    if (uploadItem.status === 'uploading') {
      throw new ConflictError('Upload item is already processing.');
    }

    if (uploadItem.status === 'complete' && uploadItem.fileId !== null) {
      return this.getFile(userId, uploadItem.fileId);
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

    await this.prisma.uploadItem.update({
      data: {
        errorCode: null,
        status: 'uploading',
        updatedAt: now,
      },
      where: {
        id: uploadItem.id,
      },
    });

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

        await tx.uploadItem.update({
          data: {
            fileId: createdFile.id,
            originalName: effectiveOriginalName,
            status: 'complete',
            updatedAt: new Date(),
          },
          where: {
            id: uploadItem.id,
          },
        });

        await this.refreshBatchStatus(batch.id, tx);

        return createdFile;
      });

      return toFileRecord(fileRecord);
    } catch (error) {
      await this.prisma.uploadItem.update({
        data: {
          errorCode: this.getUploadErrorCode(error),
          status: 'failed',
          updatedAt: new Date(),
        },
        where: {
          id: uploadItem.id,
        },
      });
      await this.refreshBatchStatus(batch.id);
      await this.safeUnlink(tempStorageRelPath);
      throw error;
    }
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
    const conflictingFolder = await this.prisma.folder.findFirst({
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

  private async getDescendantFolders(
    userId: string,
    folderId: string,
  ): Promise<FolderRecord[]> {
    const descendants: FolderRecord[] = [];
    const stack = [folderId];

    while (stack.length > 0) {
      const currentFolderId = stack.pop();

      if (currentFolderId === undefined) {
        continue;
      }

      const children = await this.prisma.folder.findMany({
        where: {
          parentFolderId: currentFolderId,
          userId,
        },
      });

      for (const childFolder of children) {
        const mappedChildFolder = toFolderRecord(childFolder);

        descendants.push(mappedChildFolder);
        stack.push(childFolder.id);
      }
    }

    return descendants;
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
    const folder = await this.prisma.folder.findFirst({
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
