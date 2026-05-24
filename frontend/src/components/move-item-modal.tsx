import { ArrowRightLeft, LoaderCircle, X } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import {
  fieldInputClass,
  fieldLabelClass,
  ghostButtonClass,
  glassPanelClass,
  iconButtonClass,
  pillClass,
  primaryButtonClass,
} from '../lib/ui.ts'
import type { LibraryItemKind } from '../types/library.ts'

export interface MoveDestinationOption {
  id: string
  label: string
  disabled: boolean
}

interface MoveItemModalProps {
  open: boolean
  itemKind: LibraryItemKind
  itemName: string
  destinationFolderId: string
  destinations: MoveDestinationOption[]
  isPending: boolean
  errorMessage: string | null
  onChangeDestination: (folderId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function MoveItemModal(props: MoveItemModalProps): React.JSX.Element | null {
  if (!props.open) {
    return null
  }

  const hasValidDestination = props.destinations.some(
    (destination) => destination.id === props.destinationFolderId && !destination.disabled,
  )

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(84,66,73,0.32)] px-4 py-6 backdrop-blur-md"
      role="presentation"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          props.onCancel()
        }
      }}
      onMouseDown={props.onCancel}
    >
      <dialog
        open
        aria-labelledby="move-dialog-title"
        className={cn(glassPanelClass, 'w-full max-w-[560px] p-6 sm:p-7')}
      >
        <div onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <span className={pillClass}>
                <ArrowRightLeft className="size-4" />
                Move {props.itemKind}
              </span>
              <div className="space-y-2">
                <h2
                  className="text-2xl font-semibold tracking-[-0.03em] text-[color:var(--on-surface)]"
                  id="move-dialog-title"
                >
                  Move “{props.itemName}”
                </h2>
                <p className="text-sm leading-7 text-[color:var(--on-surface-variant)]">
                  Re-home this item into another folder while keeping the existing mock action wired
                  to backend-shaped behavior.
                </p>
              </div>
            </div>

            <button
              aria-label="Close move dialog"
              className={iconButtonClass}
              type="button"
              onClick={props.onCancel}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-5 rounded-[24px] bg-white/60 p-4 text-sm leading-7 text-[color:var(--secondary)]">
            Disabled destinations prevent moving a folder into itself, into a child, or back into
            the same parent.
          </div>

          <div className="mt-6 space-y-2">
            <label className={fieldLabelClass} htmlFor="move-destination">
              Destination folder
            </label>
            <select
              id="move-destination"
              className={fieldInputClass}
              value={props.destinationFolderId}
              onChange={(event) => props.onChangeDestination(event.currentTarget.value)}
            >
              {props.destinations.map((destination) => (
                <option key={destination.id} value={destination.id} disabled={destination.disabled}>
                  {destination.label}
                </option>
              ))}
            </select>
          </div>

          {props.errorMessage !== null ? (
            <div
              className="mt-5 rounded-[22px] border border-[color:var(--error-container)] bg-[color:var(--error-container)] px-4 py-3 text-sm text-[color:var(--on-error-container)]"
              role="alert"
            >
              {props.errorMessage}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              className={cn(ghostButtonClass, 'w-full sm:w-auto')}
              type="button"
              onClick={props.onCancel}
            >
              Cancel
            </button>
            <button
              className={cn(primaryButtonClass, 'w-full sm:w-auto')}
              type="button"
              onClick={props.onConfirm}
              disabled={props.isPending || !hasValidDestination}
            >
              {props.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="size-4" />
              )}
              Move item
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
