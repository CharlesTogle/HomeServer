export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'archive' | 'other'
export type LibraryItemKind = 'file' | 'folder'

export interface FolderRecord {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  itemCount: number
}

export interface FolderTreeNode {
  folder: FolderRecord
  children: FolderTreeNode[]
}

export interface FileRecord {
  id: string
  name: string
  folderId: string
  mimeType: string
  sizeBytes: number
  mediaKind: MediaKind
  createdAt: string
  updatedAt: string
  contentUrl: string
  status: string
  description: string
}

export interface FolderContents {
  currentFolder: FolderRecord
  path: FolderRecord[]
  folders: FolderRecord[]
  files: FileRecord[]
}

export interface CreateFolderInput {
  parentId: string
  name: string
}

export interface UploadInput {
  folderId: string
  files: File[]
}

export interface DeleteItemInput {
  kind: LibraryItemKind
  id: string
}

export interface MoveItemInput {
  kind: LibraryItemKind
  id: string
  destinationFolderId: string
}

export interface DownloadItemInput {
  kind: LibraryItemKind
  id: string
}
