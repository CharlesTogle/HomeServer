import type {
  File,
  Folder,
  Session,
  UploadBatch,
  UploadItem,
  User,
} from '@prisma/client';

import type {
  FileRecord,
  FolderRecord,
  SessionRecord,
  UploadBatchRecord,
  UploadItemRecord,
  UserRecord,
} from '../types/domain.js';

export function toFileRecord(file: File): FileRecord {
  return {
    createdAt: file.createdAt,
    displayName: file.displayName,
    folderId: file.folderId,
    id: file.id,
    mimeType: file.mimeType,
    originalName: file.originalName,
    sha256: file.sha256,
    sizeBytes: Number(file.sizeBytes),
    status: file.status,
    storageRelPath: file.storageRelPath,
    storedExtension: file.storedExtension,
    updatedAt: file.updatedAt,
    userId: file.userId,
  };
}

export function toFolderRecord(folder: Folder): FolderRecord {
  return {
    createdAt: folder.createdAt,
    displayName: folder.displayName,
    id: folder.id,
    isRoot: folder.isRoot,
    parentFolderId: folder.parentFolderId,
    storageRelPath: folder.storageRelPath,
    updatedAt: folder.updatedAt,
    userId: folder.userId,
  };
}

export function toSessionRecord(session: Session): SessionRecord {
  return {
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    id: session.id,
    refreshTokenHash: session.refreshTokenHash,
    revokedAt: session.revokedAt,
    updatedAt: session.updatedAt,
    userId: session.userId,
  };
}

export function toUploadBatchRecord(batch: UploadBatch): UploadBatchRecord {
  return {
    completedAt: batch.completedAt,
    completedCount: batch.completedCount,
    createdAt: batch.createdAt,
    expectedCount: batch.expectedCount,
    failedCount: batch.failedCount,
    folderId: batch.folderId,
    id: batch.id,
    status: batch.status,
    updatedAt: batch.updatedAt,
    userId: batch.userId,
  };
}

export function toUploadItemRecord(item: UploadItem): UploadItemRecord {
  return {
    batchId: item.batchId,
    clientIdempotencyKey: item.clientIdempotencyKey,
    createdAt: item.createdAt,
    errorCode: item.errorCode,
    fileId: item.fileId,
    id: item.id,
    originalName: item.originalName,
    status: item.status,
    updatedAt: item.updatedAt,
    userId: item.userId,
  };
}

export function toUserRecord(user: User): UserRecord {
  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    passwordHash: user.passwordHash,
    updatedAt: user.updatedAt,
  };
}
