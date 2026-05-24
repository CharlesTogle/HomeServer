import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import type { FolderTreeNode } from '../types/library.ts'

interface FolderTreeProps {
  tree: FolderTreeNode
  selectedFolderId: string
  onSelectFolder: (folderId: string) => void
}

interface FolderTreeBranchProps {
  node: FolderTreeNode
  collapsedFolderIds: Set<string>
  depth: number
  selectedPathIds: Set<string>
  selectedFolderId: string
  onToggleFolder: (folderId: string) => void
  onSelectFolder: (folderId: string) => void
}

function findFolderPathIds(node: FolderTreeNode, targetFolderId: string): string[] {
  if (node.folder.id === targetFolderId) {
    return [node.folder.id]
  }

  for (const childNode of node.children) {
    const childPath = findFolderPathIds(childNode, targetFolderId)

    if (childPath.length > 0) {
      return [node.folder.id, ...childPath]
    }
  }

  return []
}

function FolderTreeBranch(props: FolderTreeBranchProps): React.JSX.Element {
  const isRoot = props.depth === 0
  const isActive = props.node.folder.id === props.selectedFolderId
  const hasChildren = props.node.children.length > 0
  const isExpanded =
    hasChildren &&
    (!props.collapsedFolderIds.has(props.node.folder.id) ||
      (!isRoot && props.selectedPathIds.has(props.node.folder.id)))

  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          'relative',
          isRoot
            ? 'sticky top-0 z-20 mb-2 bg-[linear-gradient(180deg,rgba(251,249,247,0.97),rgba(251,249,247,0.94)_78%,transparent)] pb-2 backdrop-blur-sm'
            : '',
        )}
      >
        {props.depth > 0 ? (
          <div
            aria-hidden="true"
            className="absolute bottom-2 left-0 top-2 w-px rounded-full bg-[rgba(164,48,115,0.08)]"
            style={{ left: `${props.depth * 16}px` }}
          />
        ) : null}

        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-[18px] px-2 py-1.5 transition duration-200',
            isActive
              ? 'bg-[rgba(244,114,182,0.12)] text-[color:var(--primary)]'
              : 'text-[color:var(--secondary)] hover:bg-white/55',
            isRoot ? 'shadow-[0_10px_24px_rgba(164,48,115,0.08)]' : '',
          )}
          style={{ paddingInlineStart: `${8 + props.depth * 16}px` }}
        >
          <div className="flex min-w-0 items-center gap-2">
            {hasChildren ? (
              <button
                aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-current"
                type="button"
                onClick={() => props.onToggleFolder(props.node.folder.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="size-4 shrink-0" />
                ) : (
                  <ChevronRight className="size-4 shrink-0" />
                )}
              </button>
            ) : (
              <span aria-hidden="true" className="block size-5 shrink-0" />
            )}

            <button
              aria-current={isActive ? 'page' : undefined}
              className="flex min-w-0 items-center gap-2 text-left"
              type="button"
              onClick={() => props.onSelectFolder(props.node.folder.id)}
            >
              <span
                className={cn(
                  'inline-flex size-7 shrink-0 items-center justify-center rounded-[14px]',
                  isActive
                    ? 'bg-white/82 text-[color:var(--primary)]'
                    : 'bg-transparent text-[color:var(--secondary)]',
                )}
              >
                {isActive ? (
                  <FolderOpen className="size-4 shrink-0" />
                ) : (
                  <Folder className="size-4 shrink-0" />
                )}
              </span>
              <span className="truncate text-sm font-medium text-[color:var(--on-surface)]">
                {props.node.folder.name}
              </span>
            </button>
          </div>

          <span className="min-w-6 text-right text-xs font-semibold text-[color:var(--secondary)]">
            {props.node.folder.itemCount}
          </span>
        </div>
      </div>

      {hasChildren && isExpanded ? (
        <div className="space-y-0.5">
          {props.node.children.map((childNode) => (
            <FolderTreeBranch
              key={childNode.folder.id}
              node={childNode}
              collapsedFolderIds={props.collapsedFolderIds}
              depth={props.depth + 1}
              selectedPathIds={props.selectedPathIds}
              selectedFolderId={props.selectedFolderId}
              onToggleFolder={props.onToggleFolder}
              onSelectFolder={props.onSelectFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function FolderTree(props: FolderTreeProps): React.JSX.Element {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set())
  const selectedPathIds = new Set(findFolderPathIds(props.tree, props.selectedFolderId))

  function handleToggleFolder(folderId: string): void {
    setCollapsedFolderIds((currentValue) => {
      const nextValue = new Set(currentValue)

      if (nextValue.has(folderId)) {
        nextValue.delete(folderId)
      } else {
        nextValue.add(folderId)
      }

      return nextValue
    })
  }

  return (
    <div className="space-y-0.5">
      <FolderTreeBranch
        node={props.tree}
        collapsedFolderIds={collapsedFolderIds}
        depth={0}
        selectedPathIds={selectedPathIds}
        selectedFolderId={props.selectedFolderId}
        onToggleFolder={handleToggleFolder}
        onSelectFolder={props.onSelectFolder}
      />
    </div>
  )
}
