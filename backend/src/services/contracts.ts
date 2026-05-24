import type { MultipartFile } from '@fastify/multipart';

import type {
  AuthenticatedSession,
  FileRecord,
  FolderRecord,
  UploadBatchRecord,
  UploadItemRecord,
  UserRecord,
} from '../types/domain.js';

export interface AuthServiceConfig {
  accessTokenTtlSeconds: number;
  authTokenSecret: string;
  refreshTokenTtlSeconds: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserRecord;
}

export interface CreateFolderInput {
  name: string;
  parentFolderId: string;
}

export interface UpdateFolderInput {
  name?: string;
  parentFolderId?: string;
}

export interface UpdateFileInput {
  folderId?: string;
  name?: string;
}

export interface CreateUploadBatchInput {
  expectedCount?: number;
  folderId: string;
}

export interface CreateUploadItemInput {
  clientIdempotencyKey: string;
  originalName: string;
}

export interface FileReadDescriptor {
  absolutePath: string;
  file: FileRecord;
  sizeBytes: number;
}

export interface FolderEntries {
  files: FileRecord[];
  folder: FolderRecord;
  folders: FolderRecord[];
}

export interface FolderTreeFolder {
  folder: FolderRecord;
  itemCount: number;
}

export interface UploadBatchSnapshot {
  batch: UploadBatchRecord;
  items: UploadItemRecord[];
}

export interface AuthServiceContract {
  authenticate(accessToken: string): Promise<AuthenticatedSession>;
  getUserById(userId: string): Promise<UserRecord>;
  login(email: string, password: string): Promise<AuthTokens>;
  logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void>;
  provisionUser(email: string, password: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
}

export interface LibraryServiceContract {
  createFolder(userId: string, input: CreateFolderInput): Promise<FolderRecord>;
  createUploadBatch(
    userId: string,
    input: CreateUploadBatchInput,
  ): Promise<UploadBatchRecord>;
  createUploadItem(
    userId: string,
    batchId: string,
    input: CreateUploadItemInput,
  ): Promise<UploadItemRecord>;
  deleteFile(userId: string, fileId: string): Promise<void>;
  deleteFolder(
    userId: string,
    folderId: string,
    recursive: boolean,
  ): Promise<void>;
  ensureUserRootFolder(userId: string): Promise<FolderRecord>;
  getFile(userId: string, fileId: string): Promise<FileRecord>;
  getFileReadDescriptor(
    userId: string,
    fileId: string,
  ): Promise<FileReadDescriptor>;
  getFilesInFolder(userId: string, folderId: string): Promise<FileRecord[]>;
  getFolder(userId: string, folderId: string): Promise<FolderRecord>;
  getFolderEntries(userId: string, folderId: string): Promise<FolderEntries>;
  listFolders(userId: string): Promise<FolderTreeFolder[]>;
  getRootFolder(userId: string): Promise<FolderRecord>;
  getUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatchSnapshot>;
  updateFile(
    userId: string,
    fileId: string,
    input: UpdateFileInput,
  ): Promise<FileRecord>;
  updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderInput,
  ): Promise<FolderRecord>;
  uploadItemContent(
    userId: string,
    itemId: string,
    multipartFile: MultipartFile | undefined,
  ): Promise<FileRecord>;
}
