import { apiBlob, apiJson, apiResponse } from './api-client.ts'
import type {
  CreateFolderInput,
  DeleteItemInput,
  FileRecord,
  FolderContents,
  FolderRecord,
  FolderTreeNode,
  MediaKind,
  MoveItemInput,
  UploadInput,
} from '../types/library.ts'

interface BackendFolderResponse {
  createdAt: string
  id: string
  isRoot: boolean
  name: string
  parentFolderId: string | null
  updatedAt: string
}

interface BackendFolderTreeFolderResponse extends BackendFolderResponse {
  itemCount: number
}

interface BackendFolderTreeResponse {
  folders: BackendFolderTreeFolderResponse[]
}

interface BackendFileResponse {
  contentUrl: string
  createdAt: string
  folderId: string
  id: string
  mimeType: string
  name: string
  originalName: string
  sizeBytes: number
  status: string
  updatedAt: string
}

interface BackendFolderEntriesResponse {
  files: BackendFileResponse[]
  folder: BackendFolderResponse
  folders: BackendFolderResponse[]
}

interface BackendUploadBatchResponse {
  id: string
}

interface BackendUploadItemResponse {
  id: string
}

export interface PreparedDownload {
  fileName: string
  blob: Blob
}

function compareByName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function inferMediaKind(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }

  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('word')
  ) {
    return 'document'
  }

  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('compressed')
  ) {
    return 'archive'
  }

  return 'other'
}

function createDescription(mediaKind: MediaKind): string {
  switch (mediaKind) {
    case 'image':
      return 'Protected image preview is available from the backend.'
    case 'audio':
      return 'Protected audio playback streams from the backend.'
    case 'video':
      return 'Protected video playback uses the backend media route.'
    case 'document':
      return 'Document metadata is live and the file is ready to download.'
    case 'archive':
      return 'Archive metadata is live and the file is ready to download.'
    default:
      return 'File metadata is live and the file is ready to download.'
  }
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[^\w.-]+/g, '-').replace(/-+/g, '-')
}

function toFolderRecord(
  folder: BackendFolderResponse | BackendFolderTreeFolderResponse,
  itemCount: number,
): FolderRecord {
  return {
    createdAt: folder.createdAt,
    id: folder.id,
    itemCount,
    name: folder.name,
    parentId: folder.parentFolderId,
  }
}

function toFileRecord(file: BackendFileResponse): FileRecord {
  const mediaKind = inferMediaKind(file.mimeType)

  return {
    contentUrl: file.contentUrl,
    createdAt: file.createdAt,
    description: createDescription(mediaKind),
    folderId: file.folderId,
    id: file.id,
    mediaKind,
    mimeType: file.mimeType,
    name: file.name,
    sizeBytes: file.sizeBytes,
    status: file.status,
    updatedAt: file.updatedAt,
  }
}

function buildFolderTree(folders: BackendFolderTreeFolderResponse[]): FolderTreeNode {
  const nodesById = new Map<string, FolderTreeNode>(
    folders.map((folder) => [
      folder.id,
      {
        children: [],
        folder: toFolderRecord(folder, folder.itemCount),
      },
    ]),
  )
  let rootNode: FolderTreeNode | null = null

  for (const folder of folders) {
    const node = nodesById.get(folder.id)

    if (node === undefined) {
      continue
    }

    if (folder.parentFolderId === null) {
      rootNode = node
      continue
    }

    const parentNode = nodesById.get(folder.parentFolderId)

    if (parentNode !== undefined) {
      parentNode.children.push(node)
    }
  }

  if (rootNode === null) {
    throw new Error('The backend did not return a root folder.')
  }

  function sortNode(node: FolderTreeNode): void {
    node.children.sort((left, right) => compareByName(left.folder, right.folder))

    for (const child of node.children) {
      sortNode(child)
    }
  }

  sortNode(rootNode)

  return rootNode
}

export function findFolderNodeById(
  tree: FolderTreeNode,
  folderId: string,
): FolderTreeNode | null {
  if (tree.folder.id === folderId) {
    return tree
  }

  for (const childNode of tree.children) {
    const match = findFolderNodeById(childNode, folderId)

    if (match !== null) {
      return match
    }
  }

  return null
}

export function findFolderPath(
  tree: FolderTreeNode,
  folderId: string,
): FolderRecord[] {
  if (tree.folder.id === folderId) {
    return [tree.folder]
  }

  for (const childNode of tree.children) {
    const path = findFolderPath(childNode, folderId)

    if (path.length > 0) {
      return [tree.folder, ...path]
    }
  }

  return []
}

function collectDescendantFolderIds(tree: FolderTreeNode, folderId: string): string[] {
  const startNode = findFolderNodeById(tree, folderId)

  if (startNode === null) {
    return []
  }

  const descendantIds: string[] = [startNode.folder.id]
  const queue = [...startNode.children]

  while (queue.length > 0) {
    const currentNode = queue.shift()

    if (currentNode === undefined) {
      continue
    }

    descendantIds.push(currentNode.folder.id)
    queue.push(...currentNode.children)
  }

  return descendantIds
}

export function isPreviewableFile(file: FileRecord): boolean {
  return file.mediaKind === 'audio' || file.mediaKind === 'image' || file.mediaKind === 'video'
}

export async function getFolderTree(): Promise<FolderTreeNode> {
  const response = await apiJson<BackendFolderTreeResponse>('/api/folders/tree')

  return buildFolderTree(response.folders)
}

export async function getFolderContents(
  folderId: string,
  tree: FolderTreeNode,
): Promise<FolderContents> {
  const response = await apiJson<BackendFolderEntriesResponse>(`/api/folders/${folderId}/entries`)
  const currentFolderNode = findFolderNodeById(tree, response.folder.id)
  const path = findFolderPath(tree, response.folder.id)

  if (currentFolderNode === null || path.length === 0) {
    throw new Error('The selected folder is missing from the current tree snapshot.')
  }

  return {
    currentFolder: currentFolderNode.folder,
    files: response.files.map((file) => toFileRecord(file)),
    folders: response.folders
      .map((folder) => findFolderNodeById(tree, folder.id)?.folder ?? toFolderRecord(folder, 0))
      .sort(compareByName),
    path,
  }
}

export async function createFolder(input: CreateFolderInput): Promise<FolderRecord> {
  const response = await apiJson<BackendFolderResponse>('/api/folders', {
    json: {
      name: input.name,
      parentFolderId: input.parentId,
    },
    method: 'POST',
  })

  return toFolderRecord(response, 0)
}

export async function uploadFiles(input: UploadInput): Promise<FileRecord[]> {
  if (input.files.length === 0) {
    throw new Error('Choose at least one file before uploading.')
  }

  const uploadBatch = await apiJson<BackendUploadBatchResponse>('/api/upload-batches', {
    json: {
      expectedCount: input.files.length,
      folderId: input.folderId,
    },
    method: 'POST',
  })
  const uploadedFiles: FileRecord[] = []

  for (const [index, file] of input.files.entries()) {
    const uploadItem = await apiJson<BackendUploadItemResponse>(
      `/api/upload-batches/${uploadBatch.id}/items`,
      {
        json: {
          clientIdempotencyKey: `${file.name}-${file.lastModified}-${index}`,
          originalName: file.name,
        },
        method: 'POST',
      },
    )
    const formData = new FormData()

    formData.append('file', file)

    const uploadedFile = await apiJson<BackendFileResponse>(
      `/api/upload-items/${uploadItem.id}/content`,
      {
        body: formData,
        method: 'POST',
      },
    )

    uploadedFiles.push(toFileRecord(uploadedFile))
  }

  return uploadedFiles
}

export async function deleteItem(input: DeleteItemInput): Promise<void> {
  if (input.kind === 'folder') {
    await apiResponse(`/api/folders/${input.id}?recursive=true`, {
      method: 'DELETE',
    })
    return
  }

  await apiResponse(`/api/files/${input.id}`, {
    method: 'DELETE',
  })
}

export async function moveItem(input: MoveItemInput): Promise<void> {
  if (input.kind === 'folder') {
    await apiJson<BackendFolderResponse>(`/api/folders/${input.id}`, {
      json: {
        parentFolderId: input.destinationFolderId,
      },
      method: 'PATCH',
    })
    return
  }

  await apiJson<BackendFileResponse>(`/api/files/${input.id}`, {
    json: {
      folderId: input.destinationFolderId,
    },
    method: 'PATCH',
  })
}

export async function getFilePreviewBlob(file: FileRecord): Promise<Blob> {
  return await apiBlob(file.contentUrl)
}

export async function prepareFileDownload(file: FileRecord): Promise<PreparedDownload> {
  return {
    blob: await apiBlob(file.contentUrl),
    fileName: file.name,
  }
}

export async function prepareFolderDownload(
  folder: FolderRecord,
  tree: FolderTreeNode,
): Promise<PreparedDownload> {
  const folderIds = collectDescendantFolderIds(tree, folder.id)
  const responses = await Promise.all(
    folderIds.map((folderId) =>
      apiJson<BackendFolderEntriesResponse>(`/api/folders/${folderId}/entries`),
    ),
  )
  const exportedFolders = folderIds
    .map((folderId) => findFolderNodeById(tree, folderId)?.folder)
    .filter((entry): entry is FolderRecord => entry !== undefined)
    .sort(compareByName)
  const exportedFiles = responses
    .flatMap((response) => response.files.map((file) => toFileRecord(file)))
    .sort(compareByName)
  const snapshot = {
    exportedAt: new Date().toISOString(),
    files: exportedFiles.map((file) => ({
      contentUrl: file.contentUrl,
      createdAt: file.createdAt,
      folderId: file.folderId,
      id: file.id,
      mimeType: file.mimeType,
      name: file.name,
      sizeBytes: file.sizeBytes,
      status: file.status,
      updatedAt: file.updatedAt,
    })),
    folder: {
      createdAt: folder.createdAt,
      id: folder.id,
      itemCount: folder.itemCount,
      name: folder.name,
      parentId: folder.parentId,
    },
    folders: exportedFolders.map((entry) => ({
      createdAt: entry.createdAt,
      id: entry.id,
      itemCount: entry.itemCount,
      name: entry.name,
      parentId: entry.parentId,
    })),
  }

  return {
    blob: new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    }),
    fileName: `${sanitizeFileName(folder.name) || 'folder'}-snapshot.json`,
  }
}
