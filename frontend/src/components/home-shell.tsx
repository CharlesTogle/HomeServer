import { LoaderCircle, LogOut } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLogoutMutation } from '../hooks/use-auth.ts'
import {
  useCreateFolderMutation,
  useDeleteItemMutation,
  useFilePreview,
  useFolderContentsQuery,
  useFolderTreeQuery,
  useMoveItemMutation,
  useUploadFilesMutation,
} from '../hooks/use-library.ts'
import { cn } from '../lib/cn.ts'
import { glassPanelClass, ghostButtonClass, sectionHeadingClass } from '../lib/ui.ts'
import {
  findFolderNodeById,
  prepareFileDownload,
  prepareFolderDownload,
} from '../services/library-service.ts'
import { useWorkspaceStore } from '../stores/workspace-store.ts'
import type { FileRecord, FolderRecord, FolderTreeNode, LibraryItemKind } from '../types/library.ts'
import { triggerBlobDownload } from '../utils/download.ts'
import { ConfirmationModal } from './confirmation-modal.tsx'
import { CreateFolderModal } from './create-folder-modal.tsx'
import { FolderTree } from './folder-tree.tsx'
import { LibraryPanel } from './library-panel.tsx'
import { MediaViewer } from './media-viewer.tsx'
import { MoveItemModal, type MoveDestinationOption } from './move-item-modal.tsx'
import { UploadPanel } from './upload-panel.tsx'

interface DeleteTarget {
  kind: LibraryItemKind
  id: string
  name: string
  parentId: string | null
}

interface MoveTarget {
  kind: LibraryItemKind
  id: string
  name: string
  parentId: string | null
}

interface InspectorTarget {
  kind: LibraryItemKind
  id: string
  mode: 'preview' | 'properties'
}

function collectDescendantFolderIds(tree: FolderTreeNode, folderId: string): Set<string> {
  if (tree.folder.id === folderId) {
    const descendantIds = new Set<string>()

    function visit(node: FolderTreeNode): void {
      for (const childNode of node.children) {
        descendantIds.add(childNode.folder.id)
        visit(childNode)
      }
    }

    visit(tree)

    return descendantIds
  }

  for (const childNode of tree.children) {
    const descendantIds = collectDescendantFolderIds(childNode, folderId)

    if (descendantIds.size > 0) {
      return descendantIds
    }
  }

  return new Set<string>()
}

function buildMoveDestinationOptions(
  tree: FolderTreeNode,
  target: MoveTarget,
): MoveDestinationOption[] {
  const blockedFolderIds =
    target.kind === 'folder' ? collectDescendantFolderIds(tree, target.id) : new Set<string>()

  if (target.kind === 'folder') {
    blockedFolderIds.add(target.id)
  }

  function visit(node: FolderTreeNode, pathSegments: string[]): MoveDestinationOption[] {
    const nextPathSegments = [...pathSegments, node.folder.name]
    const label = nextPathSegments.join(' / ')
    const isCurrentParent = node.folder.id === target.parentId

    return [
      {
        id: node.folder.id,
        label,
        disabled: isCurrentParent || blockedFolderIds.has(node.folder.id),
      },
      ...node.children.flatMap((childNode) => visit(childNode, nextPathSegments)),
    ]
  }

  return visit(tree, [])
}

function findFirstEnabledDestinationId(destinations: MoveDestinationOption[]): string {
  return destinations.find((destination) => !destination.disabled)?.id ?? ''
}

function getFolderFromContents(
  folderId: string,
  currentFolder: FolderRecord,
  siblingFolders: FolderRecord[],
): FolderRecord | null {
  if (currentFolder.id === folderId) {
    return currentFolder
  }

  return siblingFolders.find((folder) => folder.id === folderId) ?? null
}

export function HomeShell(): React.JSX.Element {
  const { selectedFileId, selectedFolderId, setSelectedFileId, setSelectedFolderId } =
    useWorkspaceStore(
      useShallow((state) => ({
        selectedFileId: state.selectedFileId,
        selectedFolderId: state.selectedFolderId,
        setSelectedFileId: state.setSelectedFileId,
        setSelectedFolderId: state.setSelectedFolderId,
      })),
    )

  const folderTreeQuery = useFolderTreeQuery()
  const folderContentsQuery = useFolderContentsQuery(selectedFolderId, folderTreeQuery.data)
  const createFolderMutation = useCreateFolderMutation()
  const uploadFilesMutation = useUploadFilesMutation()
  const deleteItemMutation = useDeleteItemMutation()
  const moveItemMutation = useMoveItemMutation()
  const logoutMutation = useLogoutMutation()

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [moveDestinationFolderId, setMoveDestinationFolderId] = useState<string>('')
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false)
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState<boolean>(false)
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState<boolean>(false)
  const [newFolderName, setNewFolderName] = useState<string>('')

  useEffect(() => {
    if (folderTreeQuery.data === undefined) {
      return
    }

    if (
      selectedFolderId === null ||
      findFolderNodeById(folderTreeQuery.data, selectedFolderId) === null
    ) {
      setSelectedFolderId(folderTreeQuery.data.folder.id)
    }
  }, [folderTreeQuery.data, selectedFolderId, setSelectedFolderId])

  const currentContents = folderContentsQuery.data ?? null
  const previewFile = currentContents?.files.find((file) => file.id === selectedFileId) ?? null
  const inspectedFile =
    inspectorTarget?.kind === 'file'
      ? currentContents?.files.find((file) => file.id === inspectorTarget.id) ?? null
      : null
  const inspectedFolder =
    inspectorTarget?.kind === 'folder' && currentContents !== null
      ? getFolderFromContents(
          inspectorTarget.id,
          currentContents.currentFolder,
          currentContents.folders,
        )
      : null
  const activeInspectorFile = inspectedFile ?? previewFile
  const activeInspectorMode =
    inspectorTarget?.mode ?? (activeInspectorFile !== null ? 'preview' : 'properties')
  const filePreview = useFilePreview(activeInspectorFile)
  const deleteErrorMessage = deleteTarget !== null ? deleteItemMutation.error?.message ?? null : null
  const moveErrorMessage = moveTarget !== null ? moveItemMutation.error?.message ?? null : null
  const busyItemId =
    deleteItemMutation.isPending && deleteTarget !== null
      ? deleteTarget.id
      : moveItemMutation.isPending && moveTarget !== null
        ? moveTarget.id
        : downloadingItemId
  const moveDestinations =
    moveTarget !== null && folderTreeQuery.data !== undefined
      ? buildMoveDestinationOptions(folderTreeQuery.data, moveTarget)
      : []
  const hasInspector = inspectedFolder !== null
  const rootFolderId = folderTreeQuery.data?.folder.id ?? null
  const isFolderContentsLoading = selectedFolderId === null || folderContentsQuery.isPending

  function resetActionErrors(): void {
    setActionErrorMessage(null)
    deleteItemMutation.reset()
    moveItemMutation.reset()
  }

  function handleOpenFolder(folderId: string): void {
    resetActionErrors()
    setDeleteTarget(null)
    setMoveTarget(null)

    startTransition(() => {
      setSelectedFolderId(folderId)
      setSelectedFileId(null)
      setInspectorTarget(null)
    })
  }

  function handleSelectFile(fileId: string): void {
    resetActionErrors()
    setMoveTarget(null)
    setSelectedFileId(fileId)
    setInspectorTarget(null)
  }

  function handleRequestDeleteFolder(folder: FolderRecord): void {
    resetActionErrors()
    setDeleteTarget({
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
    })
  }

  function handleRequestDeleteFile(file: FileRecord): void {
    resetActionErrors()
    setDeleteTarget({
      kind: 'file',
      id: file.id,
      name: file.name,
      parentId: file.folderId,
    })
  }

  function handleRequestMoveFolder(folder: FolderRecord): void {
    resetActionErrors()

    if (folderTreeQuery.data === undefined) {
      setActionErrorMessage('Folder destinations are still loading.')
      return
    }

    const nextTarget: MoveTarget = {
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
    }
    const destinations = buildMoveDestinationOptions(folderTreeQuery.data, nextTarget)

    setMoveTarget(nextTarget)
    setMoveDestinationFolderId(findFirstEnabledDestinationId(destinations))
  }

  function handleOpenCreateFolderModal(): void {
    resetActionErrors()
    createFolderMutation.reset()
    setNewFolderName('')
    setIsCreateFolderModalOpen(true)
  }

  function handleRequestMoveFile(file: FileRecord): void {
    resetActionErrors()

    if (folderTreeQuery.data === undefined) {
      setActionErrorMessage('Folder destinations are still loading.')
      return
    }

    const nextTarget: MoveTarget = {
      kind: 'file',
      id: file.id,
      name: file.name,
      parentId: file.folderId,
    }
    const destinations = buildMoveDestinationOptions(folderTreeQuery.data, nextTarget)

    setMoveTarget(nextTarget)
    setMoveDestinationFolderId(findFirstEnabledDestinationId(destinations))
  }

  function handleRequestShowFolderProperties(folder: FolderRecord): void {
    resetActionErrors()
    setMoveTarget(null)
    setDeleteTarget(null)

    startTransition(() => {
      setSelectedFileId(null)
      setInspectorTarget({
        kind: 'folder',
        id: folder.id,
        mode: 'properties',
      })
    })
  }

  function handleRequestShowFileProperties(file: FileRecord): void {
    resetActionErrors()
    setMoveTarget(null)
    setDeleteTarget(null)

    startTransition(() => {
      setSelectedFileId(file.id)
      setInspectorTarget({
        kind: 'file',
        id: file.id,
        mode: 'properties',
      })
    })
  }

  async function handleRequestDownloadFile(file: FileRecord): Promise<void> {
    resetActionErrors()
    setDownloadingItemId(file.id)

    try {
      const preparedDownload = await prepareFileDownload(file)

      triggerBlobDownload(preparedDownload.blob, preparedDownload.fileName)
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error ? error.message : 'The download could not be prepared.',
      )
    } finally {
      setDownloadingItemId(null)
    }
  }

  async function handleRequestDownloadFolder(folder: FolderRecord): Promise<void> {
    resetActionErrors()
    setDownloadingItemId(folder.id)

    try {
      if (folderTreeQuery.data === undefined) {
        throw new Error('Folder tree is still loading.')
      }

      const preparedDownload = await prepareFolderDownload(folder, folderTreeQuery.data)

      triggerBlobDownload(preparedDownload.blob, preparedDownload.fileName)
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error ? error.message : 'The folder snapshot could not be prepared.',
      )
    } finally {
      setDownloadingItemId(null)
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (deleteTarget === null) {
      return
    }

    await deleteItemMutation.mutateAsync({
      kind: deleteTarget.kind,
      id: deleteTarget.id,
    })

    if (selectedFileId === deleteTarget.id) {
      setSelectedFileId(null)
    }

    if (inspectorTarget?.id === deleteTarget.id) {
      setInspectorTarget(null)
    }

    if (deleteTarget.kind === 'folder') {
      startTransition(() => {
        setSelectedFolderId(deleteTarget.parentId ?? rootFolderId)
        setSelectedFileId(null)
      })
    }

    setDeleteTarget(null)
  }

  async function handleConfirmMove(): Promise<void> {
    if (moveTarget === null || moveDestinationFolderId.length === 0) {
      return
    }

    await moveItemMutation.mutateAsync({
      kind: moveTarget.kind,
      id: moveTarget.id,
      destinationFolderId: moveDestinationFolderId,
    })

    if (selectedFileId === moveTarget.id) {
      setSelectedFileId(null)
    }

    if (inspectorTarget?.id === moveTarget.id) {
      setInspectorTarget(null)
    }

    setMoveTarget(null)
    setMoveDestinationFolderId('')
  }

  async function handleConfirmCreateFolder(): Promise<void> {
    resetActionErrors()

    if (selectedFolderId === null) {
      setActionErrorMessage('Select a folder before creating a nested folder.')
      return
    }

    const createdFolder = await createFolderMutation.mutateAsync({
      parentId: selectedFolderId,
      name: newFolderName,
    })

    setNewFolderName('')
    setIsCreateFolderModalOpen(false)

    startTransition(() => {
      setSelectedFolderId(createdFolder.id)
      setSelectedFileId(null)
      setInspectorTarget(null)
    })
  }

  async function handleUpload(files: File[]): Promise<void> {
    resetActionErrors()

    if (selectedFolderId === null) {
      setActionErrorMessage('Select a folder before uploading files.')
      return
    }

    await uploadFilesMutation.mutateAsync({
      folderId: selectedFolderId,
      files,
    })

    setSelectedFileId(null)
    setInspectorTarget(null)
    setIsUploadModalOpen(false)
  }

  async function handleConfirmSignOut(): Promise<void> {
    await logoutMutation.mutateAsync()
    setIsSignOutModalOpen(false)
    setInspectorTarget(null)
    setMoveTarget(null)
    setDeleteTarget(null)
    setActionErrorMessage(null)
  }

  return (
    <>
      <main className="relative min-h-screen overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_10%,rgba(244,114,182,0.14),transparent_22%),radial-gradient(circle_at_88%_12%,rgba(253,208,234,0.42),transparent_18%),radial-gradient(circle_at_52%_110%,rgba(255,216,231,0.7),transparent_36%)]"
        />

        <div
          className={cn(
            'relative mx-auto grid w-full max-w-[1680px] gap-4 xl:min-h-[calc(100svh-2rem)]',
            hasInspector
              ? 'xl:grid-cols-[280px_minmax(0,1fr)_380px] 2xl:grid-cols-[300px_minmax(0,1fr)_400px]'
              : 'xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]',
          )}
        >
          <aside className="flex flex-col gap-4 xl:min-h-0">
            <section className={cn(glassPanelClass, 'flex min-h-[280px] flex-col p-4 xl:min-h-0')}>
              <div className="space-y-1 px-1 pb-3">
                <p className={sectionHeadingClass}>Folder atlas</p>
                <p className="text-sm text-[color:var(--on-surface-variant)]">Library structure</p>
              </div>

              {folderTreeQuery.isPending ? (
                <div className="flex flex-1 items-center justify-center px-4 text-center">
                  <div className="space-y-2">
                    <LoaderCircle className="mx-auto size-5 animate-spin text-[color:var(--primary)]" />
                    <p className="text-sm text-[color:var(--on-surface-variant)]">
                      Loading folders…
                    </p>
                  </div>
                </div>
              ) : null}

              {folderTreeQuery.error !== null ? (
                <div
                  className="rounded-[22px] border border-[color:var(--error-container)] bg-[color:var(--error-container)] px-4 py-3 text-sm text-[color:var(--on-error-container)]"
                  role="alert"
                >
                  {folderTreeQuery.error.message}
                </div>
              ) : null}

              {folderTreeQuery.data !== undefined && selectedFolderId !== null ? (
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <FolderTree
                    tree={folderTreeQuery.data}
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={handleOpenFolder}
                  />
                </div>
              ) : null}

              <div className="mt-4 border-t border-[rgba(218,192,201,0.54)] pt-4">
                <button
                  className={cn(ghostButtonClass, 'w-full justify-center')}
                  type="button"
                  onClick={() => setIsSignOutModalOpen(true)}
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            </section>
          </aside>

          <section className="flex min-w-0 flex-col gap-4 xl:min-h-0">
            {isFolderContentsLoading ? (
              <section className={cn(glassPanelClass, 'flex min-h-[220px] items-center justify-center p-5')}>
                <div className="space-y-2 text-center">
                  <LoaderCircle className="mx-auto size-5 animate-spin text-[color:var(--primary)]" />
                  <p className="text-sm text-[color:var(--on-surface-variant)]">
                    Loading folder contents…
                  </p>
                </div>
              </section>
            ) : null}

            {folderContentsQuery.error !== null ? (
              <section className={cn(glassPanelClass, 'p-5')}>
                <div
                  className="rounded-[22px] border border-[color:var(--error-container)] bg-[color:var(--error-container)] px-4 py-3 text-sm text-[color:var(--on-error-container)]"
                  role="alert"
                >
                  {folderContentsQuery.error.message}
                </div>
              </section>
            ) : null}

            {actionErrorMessage !== null ? (
              <section className={cn(glassPanelClass, 'p-5')}>
                <div
                  className="rounded-[22px] border border-[color:var(--error-container)] bg-[color:var(--error-container)] px-4 py-3 text-sm text-[color:var(--on-error-container)]"
                  role="alert"
                >
                  {actionErrorMessage}
                </div>
              </section>
            ) : null}

            {currentContents !== null ? (
              <LibraryPanel
                busyItemId={busyItemId}
                contents={currentContents}
                inspectedFolderId={inspectedFolder?.id ?? null}
                selectedFileId={activeInspectorFile?.id ?? selectedFileId}
                onOpenCreateFolder={handleOpenCreateFolderModal}
                onOpenUpload={() => setIsUploadModalOpen(true)}
                onOpenFolder={handleOpenFolder}
                onRequestDeleteFolder={handleRequestDeleteFolder}
                onRequestDeleteFile={handleRequestDeleteFile}
                onRequestDownloadFolder={(folder) => {
                  void handleRequestDownloadFolder(folder)
                }}
                onRequestDownloadFile={(file) => {
                  void handleRequestDownloadFile(file)
                }}
                onRequestMoveFolder={handleRequestMoveFolder}
                onRequestMoveFile={handleRequestMoveFile}
                onRequestShowFolderProperties={handleRequestShowFolderProperties}
                onRequestShowFileProperties={handleRequestShowFileProperties}
                onSelectFile={handleSelectFile}
              />
            ) : null}
          </section>

          {inspectedFolder !== null ? (
            <aside className="min-w-0 xl:self-start">
              <MediaViewer
                currentFolderName={currentContents?.currentFolder.name ?? null}
                inspectedFolder={inspectedFolder}
                isPreviewLoading={false}
                mode="properties"
                previewErrorMessage={null}
                previewUrl={null}
                selectedFile={null}
                onClose={() => {
                  startTransition(() => {
                    setSelectedFileId(null)
                    setInspectorTarget(null)
                  })
                }}
              />
            </aside>
          ) : null}
        </div>
      </main>

      {activeInspectorFile !== null ? (
        <MediaViewer
          currentFolderName={currentContents?.currentFolder.name ?? null}
          inspectedFolder={null}
          isPreviewLoading={filePreview.isPending}
          mode={activeInspectorMode}
          previewErrorMessage={filePreview.error?.message ?? null}
          previewUrl={filePreview.previewUrl}
          selectedFile={activeInspectorFile}
          onClose={() => {
            startTransition(() => {
              setSelectedFileId(null)
              setInspectorTarget(null)
            })
          }}
        />
      ) : null}

      {currentContents !== null && isUploadModalOpen ? (
        <UploadPanel
          currentFolderName={currentContents.currentFolder.name}
          errorMessage={uploadFilesMutation.error?.message ?? null}
          isPending={uploadFilesMutation.isPending}
          onClose={() => setIsUploadModalOpen(false)}
          onUpload={handleUpload}
        />
      ) : null}

      <CreateFolderModal
        open={isCreateFolderModalOpen}
        folderName={newFolderName}
        errorMessage={createFolderMutation.error?.message ?? null}
        isPending={createFolderMutation.isPending}
        onChangeFolderName={setNewFolderName}
        onCancel={() => {
          setIsCreateFolderModalOpen(false)
          setNewFolderName('')
          createFolderMutation.reset()
        }}
        onConfirm={() => {
          void handleConfirmCreateFolder()
        }}
      />

      <MoveItemModal
        open={moveTarget !== null}
        destinationFolderId={moveDestinationFolderId}
        destinations={moveDestinations}
        errorMessage={moveErrorMessage}
        isPending={moveItemMutation.isPending}
        itemKind={moveTarget?.kind ?? 'file'}
        itemName={moveTarget?.name ?? ''}
        onCancel={() => {
          setMoveTarget(null)
          setMoveDestinationFolderId('')
          moveItemMutation.reset()
        }}
        onChangeDestination={setMoveDestinationFolderId}
        onConfirm={() => {
          void handleConfirmMove()
        }}
      />

      <ConfirmationModal
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === 'folder'
            ? `Delete folder “${deleteTarget.name}”?`
            : `Delete file “${deleteTarget?.name ?? ''}”?`
        }
        description={
          deleteTarget?.kind === 'folder'
            ? 'This will remove the folder and any nested files or folders from the backend after confirmation.'
            : 'This removes the file from the backend and the current library view.'
        }
        confirmLabel={deleteTarget?.kind === 'folder' ? 'Delete folder' : 'Delete file'}
        cancelLabel="Keep it"
        tone="danger"
        isPending={deleteItemMutation.isPending}
        errorMessage={deleteErrorMessage}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void handleConfirmDelete()
        }}
      />

      <ConfirmationModal
        open={isSignOutModalOpen}
        title="Sign out?"
        description="This clears the in-memory access token and falls back to the refresh cookie flow on the next load."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        tone="neutral"
        isPending={logoutMutation.isPending}
        errorMessage={logoutMutation.error?.message ?? null}
        onCancel={() => setIsSignOutModalOpen(false)}
        onConfirm={() => {
          void handleConfirmSignOut()
        }}
      />
    </>
  )
}
