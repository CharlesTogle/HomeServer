import { ROOT_FOLDER_ID } from '../constants/library.ts'
import {
  createFallbackPoster,
  initialFiles,
  initialFolders,
  type StoredFile,
  type StoredFolder,
} from '../data/mock-library.ts'
import type {
  CreateFolderInput,
  DownloadItemInput,
  DeleteItemInput,
  FileRecord,
  FolderContents,
  FolderRecord,
  FolderTreeNode,
  MediaKind,
  MoveItemInput,
  UploadInput,
} from '../types/library.ts'

export interface PreparedDownload {
  fileName: string
  blob: Blob
}

let folders: StoredFolder[] = initialFolders.map((folder) => ({ ...folder }))
let files: StoredFile[] = initialFiles.map((file) => ({ ...file }))

async function wait(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function compareByName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function getFolderById(folderId: string): StoredFolder {
  const folder = folders.find((entry) => entry.id === folderId)

  if (folder === undefined) {
    throw new Error('That folder is no longer available in the mock library.')
  }

  return folder
}

function getFileById(fileId: string): StoredFile {
  const file = files.find((entry) => entry.id === fileId)

  if (file === undefined) {
    throw new Error('That file is no longer available in the mock library.')
  }

  return file
}

function toFolderRecord(folder: StoredFolder): FolderRecord {
  const directFolderCount = folders.filter((entry) => entry.parentId === folder.id).length
  const directFileCount = files.filter((entry) => entry.folderId === folder.id).length

  return {
    ...folder,
    itemCount: directFolderCount + directFileCount,
  }
}

function toFileRecord(file: StoredFile): FileRecord {
  return { ...file }
}

function buildPath(folderId: string): FolderRecord[] {
  const path: FolderRecord[] = []
  let currentFolder: StoredFolder | null = getFolderById(folderId)

  while (currentFolder !== null) {
    const parentId: string | null = currentFolder.parentId

    path.unshift(toFolderRecord(currentFolder))
    currentFolder =
      parentId === null ? null : folders.find((entry) => entry.id === parentId) ?? null
  }

  return path
}

function buildTree(folder: StoredFolder): FolderTreeNode {
  const children = folders
    .filter((entry) => entry.parentId === folder.id)
    .sort(compareByName)
    .map((entry) => buildTree(entry))

  return {
    folder: toFolderRecord(folder),
    children,
  }
}

function inferMediaKind(file: File): MediaKind {
  if (file.type.startsWith('image/')) {
    return 'image'
  }

  if (file.type.startsWith('audio/')) {
    return 'audio'
  }

  if (file.type.startsWith('video/')) {
    return 'video'
  }

  if (
    file.type === 'application/pdf' ||
    file.type.startsWith('text/') ||
    file.type.includes('word')
  ) {
    return 'document'
  }

  if (
    file.type.includes('zip') ||
    file.type.includes('tar') ||
    file.type.includes('compressed')
  ) {
    return 'archive'
  }

  return 'other'
}

function createDescription(mediaKind: MediaKind): string {
  switch (mediaKind) {
    case 'image':
      return 'Uploaded locally for image preview testing before backend wiring.'
    case 'audio':
      return 'Audio playback uses a local object URL until the media route exists.'
    case 'video':
      return 'Video preview will stream from Fastify later; local uploads already prove the layout.'
    case 'document':
      return 'Document rows are prepared for metadata and download endpoints.'
    case 'archive':
      return 'Archive files stay listable and selectable even without direct preview.'
    default:
      return 'General file entry staged for the future API contract.'
  }
}

function revokeOwnedUrl(url: string | null): void {
  if (url !== null && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

function collectDescendantFolderIds(folderId: string): Set<string> {
  const descendantIds = new Set<string>()
  const queue: string[] = [folderId]

  while (queue.length > 0) {
    const currentFolderId = queue.shift()

    if (currentFolderId === undefined) {
      continue
    }

    const childFolders = folders.filter((entry) => entry.parentId === currentFolderId)

    for (const childFolder of childFolders) {
      descendantIds.add(childFolder.id)
      queue.push(childFolder.id)
    }
  }

  return descendantIds
}

function getFolderDownloadSnapshot(folderId: string): Record<string, unknown> {
  const folder = getFolderById(folderId)
  const descendantIds = collectDescendantFolderIds(folderId)
  const includedFolderIds = new Set<string>([folderId, ...descendantIds])

  return {
    exportedAt: new Date().toISOString(),
    folder: {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: folder.createdAt,
    },
    folders: folders
      .filter((entry) => includedFolderIds.has(entry.id))
      .sort(compareByName)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        parentId: entry.parentId,
        createdAt: entry.createdAt,
      })),
    files: files
      .filter((entry) => includedFolderIds.has(entry.folderId))
      .sort(compareByName)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        folderId: entry.folderId,
        mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes,
        mediaKind: entry.mediaKind,
        createdAt: entry.createdAt,
        source: entry.source,
      })),
  }
}

async function createBlobFromViewerUrl(url: string): Promise<Blob> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('The preview source could not be prepared for download.')
  }

  return await response.blob()
}

export async function getFolderTree(): Promise<FolderTreeNode> {
  await wait(120)

  return buildTree(getFolderById(ROOT_FOLDER_ID))
}

export async function getFolderContents(folderId: string): Promise<FolderContents> {
  await wait(120)

  const currentFolder = getFolderById(folderId)
  const childFolders = folders
    .filter((entry) => entry.parentId === folderId)
    .sort(compareByName)
    .map((entry) => toFolderRecord(entry))
  const childFiles = files
    .filter((entry) => entry.folderId === folderId)
    .sort(compareByName)
    .map((entry) => toFileRecord(entry))

  return {
    currentFolder: toFolderRecord(currentFolder),
    path: buildPath(folderId),
    folders: childFolders,
    files: childFiles,
  }
}

export async function createFolder(input: CreateFolderInput): Promise<FolderRecord> {
  const parentFolder = getFolderById(input.parentId)
  const normalizedName = input.name.trim()

  if (normalizedName.length === 0) {
    throw new Error('Name the folder before creating it.')
  }

  const siblingExists = folders.some(
    (entry) =>
      entry.parentId === parentFolder.id &&
      entry.name.localeCompare(normalizedName, undefined, { sensitivity: 'base' }) === 0,
  )

  if (siblingExists) {
    throw new Error('That folder name already exists here in the mock library.')
  }

  await wait(160)

  const createdFolder: StoredFolder = {
    id: `folder-${crypto.randomUUID()}`,
    name: normalizedName,
    parentId: parentFolder.id,
    createdAt: new Date().toISOString(),
  }

  folders = [...folders, createdFolder]

  return toFolderRecord(createdFolder)
}

export async function uploadFiles(input: UploadInput): Promise<FileRecord[]> {
  getFolderById(input.folderId)

  if (input.files.length === 0) {
    throw new Error('Choose at least one file to stage in the current folder.')
  }

  await wait(180)

  const uploadedFiles = input.files.map<StoredFile>((file) => {
    const mediaKind = inferMediaKind(file)
    const viewerUrl = URL.createObjectURL(file)
    const posterUrl =
      mediaKind === 'image'
        ? viewerUrl
        : createFallbackPoster(
            file.name,
            'Local object URL preview until the backend serves real bytes',
          )

    return {
      id: `file-${crypto.randomUUID()}`,
      name: file.name,
      folderId: input.folderId,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      mediaKind,
      createdAt: new Date().toISOString(),
      viewerUrl,
      posterUrl,
      description: createDescription(mediaKind),
      source: 'uploaded',
    }
  })

  files = [...files, ...uploadedFiles]

  return uploadedFiles.map((file) => toFileRecord(file))
}

export async function deleteItem(input: DeleteItemInput): Promise<void> {
  await wait(140)

  if (input.kind === 'file') {
    const file = files.find((entry) => entry.id === input.id)

    if (file === undefined) {
      throw new Error('That file is already gone from the mock library.')
    }

    revokeOwnedUrl(file.viewerUrl)
    revokeOwnedUrl(file.posterUrl)
    files = files.filter((entry) => entry.id !== input.id)

    return
  }

  if (input.id === ROOT_FOLDER_ID) {
    throw new Error('The root folder stays put in this prototype.')
  }

  const folder = folders.find((entry) => entry.id === input.id)

  if (folder === undefined) {
    throw new Error('That folder is already gone from the mock library.')
  }

  const hasChildFolders = folders.some((entry) => entry.parentId === folder.id)
  const hasChildFiles = files.some((entry) => entry.folderId === folder.id)

  if (hasChildFolders || hasChildFiles) {
    throw new Error('Empty the folder first so the confirmation modal mirrors a safe backend flow.')
  }

  folders = folders.filter((entry) => entry.id !== folder.id)
}

export async function moveItem(input: MoveItemInput): Promise<void> {
  await wait(140)

  const destinationFolder = getFolderById(input.destinationFolderId)

  if (input.kind === 'file') {
    const file = getFileById(input.id)

    if (file.folderId === destinationFolder.id) {
      throw new Error('Choose a different destination folder.')
    }

    const duplicateFile = files.some(
      (entry) =>
        entry.id !== file.id &&
        entry.folderId === destinationFolder.id &&
        entry.name.localeCompare(file.name, undefined, { sensitivity: 'base' }) === 0,
    )

    if (duplicateFile) {
      throw new Error('A file with that name already exists in the destination folder.')
    }

    files = files.map((entry) =>
      entry.id === file.id ? { ...entry, folderId: destinationFolder.id } : entry,
    )

    return
  }

  if (input.id === ROOT_FOLDER_ID) {
    throw new Error('The root folder cannot be moved.')
  }

  const folder = getFolderById(input.id)

  if (folder.parentId === destinationFolder.id) {
    throw new Error('Choose a different destination folder.')
  }

  const descendantIds = collectDescendantFolderIds(folder.id)

  if (destinationFolder.id === folder.id || descendantIds.has(destinationFolder.id)) {
    throw new Error('A folder cannot be moved into itself or one of its descendants.')
  }

  const duplicateFolder = folders.some(
    (entry) =>
      entry.id !== folder.id &&
      entry.parentId === destinationFolder.id &&
      entry.name.localeCompare(folder.name, undefined, { sensitivity: 'base' }) === 0,
  )

  if (duplicateFolder) {
    throw new Error('A folder with that name already exists in the destination folder.')
  }

  folders = folders.map((entry) =>
    entry.id === folder.id ? { ...entry, parentId: destinationFolder.id } : entry,
  )
}

export async function prepareItemDownload(
  input: DownloadItemInput,
): Promise<PreparedDownload> {
  await wait(80)

  if (input.kind === 'file') {
    const file = getFileById(input.id)

    if (file.viewerUrl !== null) {
      return {
        fileName: file.name,
        blob: await createBlobFromViewerUrl(file.viewerUrl),
      }
    }

    const fallbackText = [
      `File: ${file.name}`,
      `Type: ${file.mimeType}`,
      `Size: ${file.sizeBytes}`,
      `Created: ${file.createdAt}`,
      '',
      'This local-only preview does not have the file bytes attached yet.',
      'Wire this action to the backend download route when Fastify is ready.',
    ].join('\n')

    return {
      fileName: `${file.name}.txt`,
      blob: new Blob([fallbackText], { type: 'text/plain;charset=utf-8' }),
    }
  }

  const folder = getFolderById(input.id)
  const snapshot = getFolderDownloadSnapshot(folder.id)

  return {
    fileName: `${folder.name.toLowerCase().replaceAll(/\s+/g, '-')}-manifest.json`,
    blob: new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json;charset=utf-8',
    }),
  }
}
