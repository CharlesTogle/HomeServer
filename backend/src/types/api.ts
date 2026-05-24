import type {
  FileRecord,
  FolderRecord,
  UploadBatchRecord,
  UploadItemRecord,
  UserRecord,
} from './domain.js';

export interface UserResponse {
  email: string;
  id: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserResponse;
}

export interface FolderResponse {
  createdAt: string;
  id: string;
  isRoot: boolean;
  name: string;
  parentFolderId: string | null;
  updatedAt: string;
}

export interface FileResponse {
  contentUrl: string;
  createdAt: string;
  folderId: string;
  id: string;
  mimeType: string;
  name: string;
  originalName: string;
  sizeBytes: number;
  status: string;
  updatedAt: string;
}

export interface FolderEntriesResponse {
  files: FileResponse[];
  folder: FolderResponse;
  folders: FolderResponse[];
}

export interface UploadItemResponse {
  batchId: string;
  createdAt: string;
  errorCode: string | null;
  fileId: string | null;
  id: string;
  originalName: string;
  status: string;
  updatedAt: string;
}

export interface UploadBatchResponse {
  completedAt: string | null;
  completedCount: number;
  createdAt: string;
  expectedCount: number | null;
  failedCount: number;
  folderId: string;
  id: string;
  items: UploadItemResponse[];
  status: string;
  updatedAt: string;
}

export function toAuthResponse(
  accessToken: string,
  user: UserRecord,
): AuthResponse {
  return {
    accessToken,
    user: toUserResponse(user),
  };
}

export function toFileResponse(file: FileRecord): FileResponse {
  return {
    contentUrl: `/api/files/${file.id}/content`,
    createdAt: file.createdAt.toISOString(),
    folderId: file.folderId,
    id: file.id,
    mimeType: file.mimeType,
    name: file.displayName,
    originalName: file.originalName,
    sizeBytes: file.sizeBytes,
    status: file.status,
    updatedAt: file.updatedAt.toISOString(),
  };
}

export function toFolderEntriesResponse(
  folder: FolderRecord,
  folders: FolderRecord[],
  files: FileRecord[],
): FolderEntriesResponse {
  return {
    files: files.map(toFileResponse),
    folder: toFolderResponse(folder),
    folders: folders.map(toFolderResponse),
  };
}

export function toFolderResponse(folder: FolderRecord): FolderResponse {
  return {
    createdAt: folder.createdAt.toISOString(),
    id: folder.id,
    isRoot: folder.isRoot,
    name: folder.displayName,
    parentFolderId: folder.parentFolderId,
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function toUploadBatchResponse(
  batch: UploadBatchRecord,
  items: UploadItemRecord[],
): UploadBatchResponse {
  return {
    completedAt: batch.completedAt?.toISOString() ?? null,
    completedCount: batch.completedCount,
    createdAt: batch.createdAt.toISOString(),
    expectedCount: batch.expectedCount,
    failedCount: batch.failedCount,
    folderId: batch.folderId,
    id: batch.id,
    items: items.map(toUploadItemResponse),
    status: batch.status,
    updatedAt: batch.updatedAt.toISOString(),
  };
}

export function toUploadItemResponse(item: UploadItemRecord): UploadItemResponse {
  return {
    batchId: item.batchId,
    createdAt: item.createdAt.toISOString(),
    errorCode: item.errorCode,
    fileId: item.fileId,
    id: item.id,
    originalName: item.originalName,
    status: item.status,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toUserResponse(user: UserRecord): UserResponse {
  return {
    email: user.email,
    id: user.id,
  };
}
