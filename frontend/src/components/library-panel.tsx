import {
  ArrowRightLeft,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Image,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  MoreHorizontal,
  Music,
  Search,
  Trash2,
  Upload,
  Video,
} from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/cn.ts'
import {
  chipClass,
  glassPanelClass,
  sectionHeadingClass,
  sectionSubtextClass,
  softCardClass,
} from '../lib/ui.ts'
import { useWorkspaceStore } from '../stores/workspace-store.ts'
import type { FileRecord, FolderContents, FolderRecord } from '../types/library.ts'
import { formatBytes, formatMediaKind, formatRelativeTime } from '../utils/format.ts'

interface LibraryPanelProps {
  contents: FolderContents
  selectedFileId: string | null
  inspectedFolderId: string | null
  busyItemId: string | null
  onOpenUpload: () => void
  onOpenCreateFolder: () => void
  onOpenFolder: (folderId: string) => void
  onSelectFile: (fileId: string) => void
  onRequestDeleteFolder: (folder: FolderRecord) => void
  onRequestDeleteFile: (file: FileRecord) => void
  onRequestDownloadFolder: (folder: FolderRecord) => void
  onRequestDownloadFile: (file: FileRecord) => void
  onRequestMoveFolder: (folder: FolderRecord) => void
  onRequestMoveFile: (file: FileRecord) => void
  onRequestShowFolderProperties: (folder: FolderRecord) => void
  onRequestShowFileProperties: (file: FileRecord) => void
}

interface ItemActionMenuProps {
  menuId: string
  openMenuId: string | null
  busy: boolean
  itemLabel: string
  onToggle: (menuId: string) => void
  onClose: () => void
  onDelete: () => void
  onDownload: () => void
  onMove: () => void
  onProperties: () => void
}

function FileIcon(props: { file: FileRecord }): React.JSX.Element {
  switch (props.file.mediaKind) {
    case 'image':
      return <Image className="size-5" />
    case 'audio':
      return <Music className="size-5" />
    case 'video':
      return <Video className="size-5" />
    default:
      return <FileText className="size-5" />
  }
}

function FileVisual(props: { file: FileRecord }): React.JSX.Element {
  return (
    <div className="flex aspect-[4/3] items-center justify-center bg-[rgba(61,0,38,0.94)] text-[color:var(--inverse-primary)]">
      <FileIcon file={props.file} />
    </div>
  )
}

function ActionMenuButton(props: {
  icon: React.JSX.Element
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sm font-medium transition duration-200',
        props.tone === 'danger'
          ? 'text-[color:var(--error)] hover:bg-[rgba(255,218,214,0.9)]'
          : 'text-[color:var(--secondary)] hover:bg-[rgba(253,242,248,0.9)]',
      )}
      role="menuitem"
      type="button"
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </button>
  )
}

function ItemActionMenu(props: ItemActionMenuProps): React.JSX.Element {
  const isOpen = props.openMenuId === props.menuId

  return (
    <div
      className={cn('relative shrink-0', isOpen ? 'z-40' : '')}
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget

        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
          props.onClose()
        }
      }}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Open actions for ${props.itemLabel}`}
        className="theme-icon-button"
        type="button"
        onClick={() => props.onToggle(props.menuId)}
        disabled={props.busy}
      >
        {props.busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-12 z-40 w-[208px] rounded-[24px] border border-[rgba(218,192,201,0.9)] bg-white/96 p-2 shadow-[0_24px_60px_rgba(84,66,73,0.14)] backdrop-blur-xl"
          role="menu"
        >
          <ActionMenuButton
            icon={<Trash2 className="size-4" />}
            label="Delete"
            onClick={props.onDelete}
            tone="danger"
          />
          <ActionMenuButton
            icon={<Download className="size-4" />}
            label="Download"
            onClick={props.onDownload}
          />
          <ActionMenuButton
            icon={<ArrowRightLeft className="size-4" />}
            label="Move"
            onClick={props.onMove}
          />
          <ActionMenuButton
            icon={<Info className="size-4" />}
            label="Properties"
            onClick={props.onProperties}
          />
        </div>
      ) : null}
    </div>
  )
}

export function LibraryPanel(props: LibraryPanelProps): React.JSX.Element {
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const { setViewMode, viewMode } = useWorkspaceStore(
    useShallow((state) => ({
      setViewMode: state.setViewMode,
      viewMode: state.viewMode,
    })),
  )
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const normalizedQuery = deferredSearchTerm.trim().toLowerCase()
  const filteredFolders =
    normalizedQuery.length === 0
      ? props.contents.folders
      : props.contents.folders.filter((folder) =>
          folder.name.toLowerCase().includes(normalizedQuery),
        )
  const filteredFiles =
    normalizedQuery.length === 0
      ? props.contents.files
      : props.contents.files.filter((file) => file.name.toLowerCase().includes(normalizedQuery))
  return (
    <section className={cn(glassPanelClass, 'p-5 sm:p-6')}>
      <div className="space-y-6">
        <header className="space-y-4 border-b border-[rgba(218,192,201,0.72)] pb-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--secondary)]">
                {props.contents.path.map((folder, index) => (
                  <span key={folder.id} className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full px-2.5 py-1 transition hover:bg-white/66 hover:text-[color:var(--on-surface)]"
                      onClick={() => props.onOpenFolder(folder.id)}
                    >
                      {folder.name}
                    </button>
                    {index < props.contents.path.length - 1 ? <span>/</span> : null}
                  </span>
                ))}
              </div>

              <p aria-live="polite" className="text-sm text-[color:var(--on-surface-variant)]">
                Showing {filteredFolders.length} folders and {filteredFiles.length} files
              </p>
            </div>

            <div className="flex items-center gap-2 self-start">
              <button className="theme-button-secondary" type="button" onClick={props.onOpenUpload}>
                <Upload className="size-4" />
                Add files
              </button>
              <button
                aria-label="Create folder"
                className="theme-icon-button"
                type="button"
                onClick={props.onOpenCreateFolder}
              >
                <FolderPlus className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full lg:max-w-[360px]" htmlFor="folder-search">
              <span className="sr-only">Search the current folder</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[color:var(--secondary)]" />
              <input
                id="folder-search"
                aria-label="Search the current folder"
                className="theme-input rounded-full pl-10 pr-4"
                placeholder="Search the current room"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.currentTarget.value)}
              />
            </label>

            <div className="inline-flex items-center rounded-full border border-[rgba(218,192,201,0.92)] bg-white/84 p-1">
              <button
                aria-label="Switch to grid view"
                className={cn(
                  'inline-flex size-10 items-center justify-center rounded-full transition duration-200',
                  viewMode === 'grid'
                    ? 'bg-[color:var(--primary)] text-white shadow-[0_14px_24px_rgba(164,48,115,0.22)]'
                    : 'text-[color:var(--secondary)] hover:bg-[rgba(253,242,248,0.9)]',
                )}
                type="button"
                  onClick={() => setViewMode('grid')}
                >
                  <LayoutGrid className="size-4" />
                </button>
              <button
                aria-label="Switch to list view"
                className={cn(
                  'inline-flex size-10 items-center justify-center rounded-full transition duration-200',
                  viewMode === 'list'
                    ? 'bg-[color:var(--primary)] text-white shadow-[0_14px_24px_rgba(164,48,115,0.22)]'
                    : 'text-[color:var(--secondary)] hover:bg-[rgba(253,242,248,0.9)]',
                )}
                type="button"
                  onClick={() => setViewMode('list')}
                >
                  <List className="size-4" />
                </button>
            </div>
          </div>
        </header>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className={sectionHeadingClass}>Folders</p>
            <p className={sectionSubtextClass}>
              Open a nested room, or use the action menu for safe move, download, and property
              flows.
            </p>
          </div>

          {filteredFolders.length > 0 ? (
            viewMode === 'grid' ? (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {filteredFolders.map((folder) => {
                  const isInspected = props.inspectedFolderId === folder.id
                  const isBusy = props.busyItemId === folder.id
                  const menuId = `folder:${folder.id}`
                  const isMenuOpen = openMenuId === menuId

                  return (
                    <article
                      key={folder.id}
                      className={cn(
                        softCardClass,
                        'relative p-4 transition duration-200 hover:-translate-y-0.5',
                        isMenuOpen ? 'z-30' : '',
                        isInspected
                          ? 'ring-4 ring-[rgba(255,216,231,0.92)] shadow-[0_22px_42px_rgba(164,48,115,0.16)]'
                          : '',
                      )}
                    >
                      <div
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_top,rgba(244,114,182,0.16),transparent_70%)]"
                      />

                      <div className="relative flex items-start justify-between gap-3">
                        <span className="inline-flex size-12 items-center justify-center rounded-[18px] border border-[rgba(218,192,201,0.92)] bg-white/80 text-[color:var(--primary)]">
                          <Folder className="size-5" />
                        </span>
                        <ItemActionMenu
                          menuId={menuId}
                          openMenuId={openMenuId}
                          busy={isBusy}
                          itemLabel={folder.name}
                          onToggle={(menuId) => {
                            setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                          }}
                          onClose={() => setOpenMenuId(null)}
                          onDelete={() => {
                            setOpenMenuId(null)
                            props.onRequestDeleteFolder(folder)
                          }}
                          onDownload={() => {
                            setOpenMenuId(null)
                            props.onRequestDownloadFolder(folder)
                          }}
                          onMove={() => {
                            setOpenMenuId(null)
                            props.onRequestMoveFolder(folder)
                          }}
                          onProperties={() => {
                            setOpenMenuId(null)
                            props.onRequestShowFolderProperties(folder)
                          }}
                        />
                      </div>

                      <button
                        className="relative mt-5 flex w-full flex-col items-start gap-2 text-left"
                        type="button"
                        onClick={() => props.onOpenFolder(folder.id)}
                      >
                        <span className={sectionHeadingClass}>Nested room</span>
                        <h3 className="text-base font-semibold text-[color:var(--on-surface)]">
                          {folder.name}
                        </h3>
                        <p className="text-sm leading-6 text-[color:var(--on-surface-variant)]">
                          Created {formatRelativeTime(folder.createdAt)} with {folder.itemCount}{' '}
                          direct items.
                        </p>
                      </button>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="divide-y divide-[rgba(218,192,201,0.54)]">
                {filteredFolders.map((folder) => {
                  const isInspected = props.inspectedFolderId === folder.id
                  const isBusy = props.busyItemId === folder.id
                  const menuId = `folder:${folder.id}`
                  const isMenuOpen = openMenuId === menuId

                  return (
                    <article
                      key={folder.id}
                      className={cn(
                        'relative flex items-center gap-3 py-2.5 transition duration-200',
                        isMenuOpen ? 'z-30' : '',
                        isInspected
                          ? 'border-l-2 border-[rgba(164,48,115,0.72)] pl-3'
                          : '',
                      )}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        type="button"
                        onClick={() => props.onOpenFolder(folder.id)}
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center text-[color:var(--primary)]">
                          <Folder className="size-[18px]" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-[color:var(--on-surface)]">
                            {folder.name}
                          </h3>
                          <p className="truncate text-sm text-[color:var(--on-surface-variant)]">
                            Created {formatRelativeTime(folder.createdAt)}
                          </p>
                        </div>

                        <div className="hidden shrink-0 text-right md:block">
                          <p className="text-sm font-medium text-[color:var(--secondary)]">Folder</p>
                          <p className="text-sm text-[color:var(--secondary)]">
                            {folder.itemCount} items
                          </p>
                        </div>
                      </button>

                      <ItemActionMenu
                        menuId={menuId}
                        openMenuId={openMenuId}
                        busy={isBusy}
                        itemLabel={folder.name}
                        onToggle={(menuId) => {
                          setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                        }}
                        onClose={() => setOpenMenuId(null)}
                        onDelete={() => {
                          setOpenMenuId(null)
                          props.onRequestDeleteFolder(folder)
                        }}
                        onDownload={() => {
                          setOpenMenuId(null)
                          props.onRequestDownloadFolder(folder)
                        }}
                        onMove={() => {
                          setOpenMenuId(null)
                          props.onRequestMoveFolder(folder)
                        }}
                        onProperties={() => {
                          setOpenMenuId(null)
                          props.onRequestShowFolderProperties(folder)
                        }}
                      />
                    </article>
                  )
                })}
              </div>
            )
          ) : (
            <div className="flex min-h-[150px] items-center justify-center rounded-[28px] border border-dashed border-[rgba(218,192,201,0.88)] bg-white/44 px-6 py-8 text-center">
              <div className="space-y-2">
                <Folder className="mx-auto size-5 text-[color:var(--primary)]" />
                <p className="text-sm leading-6 text-[color:var(--on-surface-variant)]">
                  No matching folders in this room.
                </p>
              </div>
            </div>
          )}
        </div>

        {filteredFiles.length > 0 ? (
          <div className="space-y-5">
            <p className={sectionHeadingClass}>Files</p>

            {viewMode === 'grid' ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {filteredFiles.map((file) => {
                  const isSelected = props.selectedFileId === file.id
                  const isBusy = props.busyItemId === file.id
                  const menuId = `file:${file.id}`
                  const isMenuOpen = openMenuId === menuId

                  return (
                    <article
                      key={file.id}
                      className={cn(
                        softCardClass,
                        'relative p-3 transition duration-200 hover:-translate-y-0.5',
                        isMenuOpen ? 'z-30' : '',
                        isSelected
                          ? 'ring-4 ring-[rgba(255,216,231,0.92)] shadow-[0_22px_42px_rgba(164,48,115,0.16)]'
                          : '',
                      )}
                    >
                      <button
                        className="flex w-full flex-col gap-4 text-left"
                        type="button"
                        onClick={() => props.onSelectFile(file.id)}
                      >
                        <div className="overflow-hidden rounded-[24px] border border-[rgba(218,192,201,0.92)] bg-[rgba(61,0,38,0.94)]">
                          <FileVisual file={file} />
                        </div>

                        <div className="space-y-3 px-1">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[color:var(--primary)]">
                              <FileIcon file={file} />
                              <span className="truncate text-sm font-semibold text-[color:var(--on-surface)]">
                                {file.name}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-[color:var(--on-surface-variant)]">
                              {file.description}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className={chipClass}>{formatMediaKind(file.mediaKind)}</span>
                            <span className={chipClass}>{formatBytes(file.sizeBytes)}</span>
                          </div>
                        </div>
                      </button>

                      <div className="mt-4 flex items-center justify-between gap-3 px-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--secondary)]">
                          Added {formatRelativeTime(file.createdAt)}
                        </span>
                        <ItemActionMenu
                          menuId={menuId}
                          openMenuId={openMenuId}
                          busy={isBusy}
                          itemLabel={file.name}
                          onToggle={(menuId) => {
                            setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                          }}
                          onClose={() => setOpenMenuId(null)}
                          onDelete={() => {
                            setOpenMenuId(null)
                            props.onRequestDeleteFile(file)
                          }}
                          onDownload={() => {
                            setOpenMenuId(null)
                            props.onRequestDownloadFile(file)
                          }}
                          onMove={() => {
                            setOpenMenuId(null)
                            props.onRequestMoveFile(file)
                          }}
                          onProperties={() => {
                            setOpenMenuId(null)
                            props.onRequestShowFileProperties(file)
                          }}
                        />
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="divide-y divide-[rgba(218,192,201,0.54)]">
                {filteredFiles.map((file) => {
                  const isSelected = props.selectedFileId === file.id
                  const isBusy = props.busyItemId === file.id
                  const menuId = `file:${file.id}`
                  const isMenuOpen = openMenuId === menuId

                  return (
                    <article
                      key={file.id}
                      className={cn(
                        'relative flex items-center gap-4 py-2.5 transition duration-200',
                        isMenuOpen ? 'z-30' : '',
                        isSelected
                          ? 'border-l-2 border-[rgba(164,48,115,0.72)] pl-3'
                          : '',
                      )}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                        type="button"
                        onClick={() => props.onSelectFile(file.id)}
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[rgba(61,0,38,0.94)] text-[color:var(--inverse-primary)]">
                          <FileVisual file={file} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-[color:var(--on-surface)]">
                            {file.name}
                          </h3>
                          <p className="mt-1 truncate text-sm text-[color:var(--on-surface-variant)]">
                            {file.description}
                          </p>
                        </div>

                        <div className="hidden shrink-0 text-right lg:block">
                          <p className="text-sm font-medium text-[color:var(--secondary)]">
                            {formatMediaKind(file.mediaKind)}
                          </p>
                          <p className="mt-1 text-sm text-[color:var(--secondary)]">
                            {formatBytes(file.sizeBytes)}
                          </p>
                        </div>
                      </button>

                      <ItemActionMenu
                        menuId={menuId}
                        openMenuId={openMenuId}
                        busy={isBusy}
                        itemLabel={file.name}
                        onToggle={(menuId) => {
                          setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                        }}
                        onClose={() => setOpenMenuId(null)}
                        onDelete={() => {
                          setOpenMenuId(null)
                          props.onRequestDeleteFile(file)
                        }}
                        onDownload={() => {
                          setOpenMenuId(null)
                          props.onRequestDownloadFile(file)
                        }}
                        onMove={() => {
                          setOpenMenuId(null)
                          props.onRequestMoveFile(file)
                        }}
                        onProperties={() => {
                          setOpenMenuId(null)
                          props.onRequestShowFileProperties(file)
                        }}
                      />
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
