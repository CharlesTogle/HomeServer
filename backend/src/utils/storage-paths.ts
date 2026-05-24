import path from 'node:path';

import { BadRequestError } from './http-errors.js';

const INVALID_NAME_PATTERN = /[\\/]/u;

export function buildFileStorageRelPath(
  folderStorageRelPath: string,
  fileId: string,
  storedExtension: string,
): string {
  return path.posix.join(folderStorageRelPath, `${fileId}.${storedExtension}`);
}

export function buildFolderStorageRelPath(
  parentStorageRelPath: string,
  folderId: string,
): string {
  return path.posix.join(parentStorageRelPath, folderId);
}

export function buildRootStorageRelPath(userId: string): string {
  return path.posix.join('users', userId);
}

export function ensureValidDisplayName(rawName: string): string {
  const normalizedName = rawName.trim();

  if (normalizedName === '') {
    throw new BadRequestError('Name must not be empty.');
  }

  if (normalizedName === '.' || normalizedName === '..') {
    throw new BadRequestError('Name is reserved.');
  }

  if (INVALID_NAME_PATTERN.test(normalizedName)) {
    throw new BadRequestError('Name must not contain path separators.');
  }

  if (normalizedName.length > 255) {
    throw new BadRequestError('Name must be 255 characters or fewer.');
  }

  return normalizedName;
}

export function ensureWithinStorageRoot(
  storageRoot: string,
  storageRelPath: string,
): string {
  const absoluteStorageRoot = path.resolve(storageRoot);
  const absolutePath = path.resolve(storageRoot, storageRelPath);
  const relativePath = path.relative(absoluteStorageRoot, absolutePath);

  if (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  ) {
    return absolutePath;
  }

  throw new BadRequestError('Resolved path escaped the storage root.');
}

export function getStoredExtension(originalName: string): string {
  const rawExtension = path.extname(originalName).replace('.', '').trim().toLowerCase();

  if (rawExtension === '') {
    return 'bin';
  }

  return rawExtension;
}

export function replaceStoragePathPrefix(
  storageRelPath: string,
  currentPrefix: string,
  nextPrefix: string,
): string {
  if (storageRelPath === currentPrefix) {
    return nextPrefix;
  }

  const normalizedCurrentPrefix = `${currentPrefix}/`;

  if (!storageRelPath.startsWith(normalizedCurrentPrefix)) {
    throw new BadRequestError('Storage path prefix mismatch.');
  }

  return `${nextPrefix}${storageRelPath.slice(currentPrefix.length)}`;
}
