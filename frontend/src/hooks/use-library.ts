import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  createFolder,
  deleteItem,
  getFolderContents,
  getFolderTree,
  moveItem,
  uploadFiles,
} from '../services/mock-library-service.ts'
import type {
  CreateFolderInput,
  DeleteItemInput,
  FileRecord,
  FolderContents,
  FolderRecord,
  FolderTreeNode,
  MoveItemInput,
  UploadInput,
} from '../types/library.ts'

export const libraryQueryKeys = {
  all: ['library'] as const,
  tree: () => [...libraryQueryKeys.all, 'tree'] as const,
  contents: (folderId: string) => [...libraryQueryKeys.all, 'contents', folderId] as const,
}

export function useFolderTreeQuery(): UseQueryResult<FolderTreeNode, Error> {
  return useQuery({
    queryKey: libraryQueryKeys.tree(),
    queryFn: getFolderTree,
  })
}

export function useFolderContentsQuery(folderId: string): UseQueryResult<FolderContents, Error> {
  return useQuery({
    queryKey: libraryQueryKeys.contents(folderId),
    queryFn: () => getFolderContents(folderId),
  })
}

export function useCreateFolderMutation(): UseMutationResult<
  FolderRecord,
  Error,
  CreateFolderInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createFolder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useUploadFilesMutation(): UseMutationResult<FileRecord[], Error, UploadInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: uploadFiles,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useDeleteItemMutation(): UseMutationResult<void, Error, DeleteItemInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useMoveItemMutation(): UseMutationResult<void, Error, MoveItemInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: moveItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}
