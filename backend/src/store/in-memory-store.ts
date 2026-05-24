import type {
  FileRecord,
  FolderRecord,
  SessionRecord,
  UploadBatchRecord,
  UploadItemRecord,
  UserRecord,
} from '../types/domain.js';

export class InMemoryHomeServerStore {
  public readonly files = new Map<string, FileRecord>();
  public readonly folders = new Map<string, FolderRecord>();
  public readonly rootFolderByUserId = new Map<string, string>();
  public readonly sessionByRefreshTokenHash = new Map<string, string>();
  public readonly sessions = new Map<string, SessionRecord>();
  public readonly uploadBatches = new Map<string, UploadBatchRecord>();
  public readonly uploadItemByIdempotencyKey = new Map<string, string>();
  public readonly uploadItems = new Map<string, UploadItemRecord>();
  public readonly userIdByEmail = new Map<string, string>();
  public readonly users = new Map<string, UserRecord>();
}
