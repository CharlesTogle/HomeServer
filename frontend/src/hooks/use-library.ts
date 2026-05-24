import { useEffect, useState } from 'react'
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
  getFilePreviewBlob,
  getFolderContents,
  getFolderTree,
  isPreviewableFile,
  moveItem,
  uploadFiles,
} from '../services/library-service.ts'
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

export function useFolderContentsQuery(
  folderId: string | null,
  tree: FolderTreeNode | undefined,
): UseQueryResult<FolderContents, Error> {
  return useQuery({
    enabled: folderId !== null && tree !== undefined,
    queryKey: libraryQueryKeys.contents(folderId ?? 'none'),
    queryFn: async () => {
      if (folderId === null || tree === undefined) {
        throw new Error('Folder contents query requires both a folder id and tree snapshot.')
      }

      return await getFolderContents(folderId, tree)
    },
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

export function useFilePreview(file: FileRecord | null): {
  error: Error | null
  isPending: boolean
  previewUrl: string | null
} {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewQuery = useQuery({
    enabled: file !== null && isPreviewableFile(file),
    queryKey: ['library', 'file-preview', file?.id ?? 'none', file?.updatedAt ?? 'none'],
    queryFn: async () => {
      if (file === null) {
        throw new Error('A file is required before fetching preview bytes.')
      }

      return await getFilePreviewBlob(file)
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    if (previewQuery.data === undefined) {
      setPreviewUrl(null)
      return
    }

    const nextPreviewUrl = URL.createObjectURL(previewQuery.data)

    setPreviewUrl(nextPreviewUrl)

    return () => {
      URL.revokeObjectURL(nextPreviewUrl)
    }
  }, [previewQuery.data])

  return {
    error: previewQuery.error ?? null,
    isPending: previewQuery.isPending,
    previewUrl,
  }
}
