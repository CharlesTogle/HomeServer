import { create } from 'zustand'

export type WorkspaceViewMode = 'grid' | 'list'

interface WorkspaceStore {
  selectedFolderId: string | null
  selectedFileId: string | null
  viewMode: WorkspaceViewMode
  setSelectedFolderId: (folderId: string | null) => void
  setSelectedFileId: (fileId: string | null) => void
  setViewMode: (viewMode: WorkspaceViewMode) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  selectedFolderId: null,
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
      selectedFolderId: null,
      selectedFileId: null,
      viewMode: 'grid',
    })
  },
}))
