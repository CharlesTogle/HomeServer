export type DatabaseMode = 'mariadb' | 'memory';

export type FileStatus = 'ready' | 'uploading';
export type UploadBatchStatus = 'completed' | 'open' | 'partial';
export type UploadItemStatus = 'complete' | 'failed' | 'pending' | 'uploading';

export interface UserRecord {
  createdAt: Date;
  email: string;
  id: string;
  passwordHash: string;
  updatedAt: Date;
}

export interface SessionRecord {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  updatedAt: Date;
  userId: string;
}

export interface AuthenticatedSession {
  email: string;
  sessionId: string;
  userId: string;
}

export interface FolderRecord {
  createdAt: Date;
  displayName: string;
  id: string;
  isRoot: boolean;
  parentFolderId: string | null;
  storageRelPath: string;
  updatedAt: Date;
  userId: string;
}

export interface FileRecord {
  createdAt: Date;
  displayName: string;
  folderId: string;
  id: string;
  mimeType: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  status: FileStatus;
  storageRelPath: string;
  storedExtension: string;
  updatedAt: Date;
  userId: string;
}

export interface UploadBatchRecord {
  completedAt: Date | null;
  completedCount: number;
  createdAt: Date;
  expectedCount: number | null;
  failedCount: number;
  folderId: string;
  id: string;
  status: UploadBatchStatus;
  updatedAt: Date;
  userId: string;
}

export interface UploadItemRecord {
  batchId: string;
  clientIdempotencyKey: string;
  createdAt: Date;
  errorCode: string | null;
  fileId: string | null;
  id: string;
  originalName: string;
  status: UploadItemStatus;
  updatedAt: Date;
  userId: string;
}

export interface DatabaseConnectionState {
  mode: DatabaseMode;
}
