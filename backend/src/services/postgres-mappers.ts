import type {
  FileRecord,
  FileStatus,
  FolderRecord,
  SessionRecord,
  UploadBatchRecord,
  UploadBatchStatus,
  UploadItemRecord,
  UploadItemStatus,
  UserRecord,
} from '../types/domain.js';

export const USER_SELECT_COLUMNS = `
  id,
  email,
  password_hash AS "passwordHash",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export const SESSION_SELECT_COLUMNS = `
  id,
  user_id AS "userId",
  refresh_token_hash AS "refreshTokenHash",
  expires_at AS "expiresAt",
  revoked_at AS "revokedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export const FOLDER_SELECT_COLUMNS = `
  id,
  user_id AS "userId",
  parent_folder_id AS "parentFolderId",
  display_name AS "displayName",
  is_root AS "isRoot",
  storage_rel_path AS "storageRelPath",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export const FILE_SELECT_COLUMNS = `
  id,
  user_id AS "userId",
  folder_id AS "folderId",
  display_name AS "displayName",
  original_name AS "originalName",
  stored_extension AS "storedExtension",
  mime_type AS "mimeType",
  size_bytes AS "sizeBytes",
  sha256,
  status,
  storage_rel_path AS "storageRelPath",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export const UPLOAD_BATCH_SELECT_COLUMNS = `
  id,
  user_id AS "userId",
  folder_id AS "folderId",
  status,
  expected_count AS "expectedCount",
  completed_count AS "completedCount",
  failed_count AS "failedCount",
  completed_at AS "completedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export const UPLOAD_ITEM_SELECT_COLUMNS = `
  id,
  batch_id AS "batchId",
  user_id AS "userId",
  file_id AS "fileId",
  client_idempotency_key AS "clientIdempotencyKey",
  original_name AS "originalName",
  status,
  error_code AS "errorCode",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export interface UserRow {
  createdAt: Date | string;
  email: string;
  id: string;
  passwordHash: string;
  updatedAt: Date | string;
}

export interface SessionRow {
  createdAt: Date | string;
  expiresAt: Date | string;
  id: string;
  refreshTokenHash: string;
  revokedAt: Date | string | null;
  updatedAt: Date | string;
  userId: string;
}

export interface FolderRow {
  createdAt: Date | string;
  displayName: string;
  id: string;
  isRoot: boolean;
  parentFolderId: string | null;
  storageRelPath: string;
  updatedAt: Date | string;
  userId: string;
}

export interface FileRow {
  createdAt: Date | string;
  displayName: string;
  folderId: string;
  id: string;
  mimeType: string;
  originalName: string;
  sha256: string;
  sizeBytes: number | string;
  status: FileStatus;
  storageRelPath: string;
  storedExtension: string;
  updatedAt: Date | string;
  userId: string;
}

export interface UploadBatchRow {
  completedAt: Date | string | null;
  completedCount: number;
  createdAt: Date | string;
  expectedCount: number | null;
  failedCount: number;
  folderId: string;
  id: string;
  status: UploadBatchStatus;
  updatedAt: Date | string;
  userId: string;
}

export interface UploadItemRow {
  batchId: string;
  clientIdempotencyKey: string;
  createdAt: Date | string;
  errorCode: string | null;
  fileId: string | null;
  id: string;
  originalName: string;
  status: UploadItemStatus;
  updatedAt: Date | string;
  userId: string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function toUserRecord(row: UserRow): UserRecord {
  return {
    createdAt: toDate(row.createdAt),
    email: row.email,
    id: row.id,
    passwordHash: row.passwordHash,
    updatedAt: toDate(row.updatedAt),
  };
}

export function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    createdAt: toDate(row.createdAt),
    expiresAt: toDate(row.expiresAt),
    id: row.id,
    refreshTokenHash: row.refreshTokenHash,
    revokedAt: row.revokedAt === null ? null : toDate(row.revokedAt),
    updatedAt: toDate(row.updatedAt),
    userId: row.userId,
  };
}

export function toFolderRecord(row: FolderRow): FolderRecord {
  return {
    createdAt: toDate(row.createdAt),
    displayName: row.displayName,
    id: row.id,
    isRoot: row.isRoot,
    parentFolderId: row.parentFolderId,
    storageRelPath: row.storageRelPath,
    updatedAt: toDate(row.updatedAt),
    userId: row.userId,
  };
}

export function toFileRecord(row: FileRow): FileRecord {
  return {
    createdAt: toDate(row.createdAt),
    displayName: row.displayName,
    folderId: row.folderId,
    id: row.id,
    mimeType: row.mimeType,
    originalName: row.originalName,
    sha256: row.sha256,
    sizeBytes: Number(row.sizeBytes),
    status: row.status,
    storageRelPath: row.storageRelPath,
    storedExtension: row.storedExtension,
    updatedAt: toDate(row.updatedAt),
    userId: row.userId,
  };
}

export function toUploadBatchRecord(row: UploadBatchRow): UploadBatchRecord {
  return {
    completedAt: row.completedAt === null ? null : toDate(row.completedAt),
    completedCount: row.completedCount,
    createdAt: toDate(row.createdAt),
    expectedCount: row.expectedCount,
    failedCount: row.failedCount,
    folderId: row.folderId,
    id: row.id,
    status: row.status,
    updatedAt: toDate(row.updatedAt),
    userId: row.userId,
  };
}

export function toUploadItemRecord(row: UploadItemRow): UploadItemRecord {
  return {
    batchId: row.batchId,
    clientIdempotencyKey: row.clientIdempotencyKey,
    createdAt: toDate(row.createdAt),
    errorCode: row.errorCode,
    fileId: row.fileId,
    id: row.id,
    originalName: row.originalName,
    status: row.status,
    updatedAt: toDate(row.updatedAt),
    userId: row.userId,
  };
}
