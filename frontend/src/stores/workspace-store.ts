import { create } from 'zustand'
import { ROOT_FOLDER_ID } from '../constants/library.ts'

export type WorkspaceViewMode = 'grid' | 'list'

interface WorkspaceStore {
  selectedFolderId: string
  selectedFileId: string | null
  viewMode: WorkspaceViewMode
  setSelectedFolderId: (folderId: string) => void
  setSelectedFileId: (fileId: string | null) => void
  setViewMode: (viewMode: WorkspaceViewMode) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  selectedFolderId: ROOT_FOLDER_ID,
  selectedFileId: null,
  viewMode: 'grid',
  setSelectedFolderId: (folderId) => {
    set({ selectedFolderId: folderId })
  },
  setSelectedFileId: (fileId) => {
    set({ selectedFileId: fileId })
  },
  setViewMode: (viewMode) => {
    set({ viewMode })
  },
  reset: () => {
    set({
      selectedFolderId: ROOT_FOLDER_ID,
      selectedFileId: null,
      viewMode: 'grid',
    })
  },
}))
