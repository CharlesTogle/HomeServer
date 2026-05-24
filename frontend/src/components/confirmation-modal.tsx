import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import {
  dangerButtonClass,
  ghostButtonClass,
  glassPanelClass,
  iconButtonClass,
  pillClass,
  primaryButtonClass,
} from '../lib/ui.ts'

interface ConfirmationModalProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  tone: 'danger' | 'neutral'
  isPending: boolean
  errorMessage: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationModal(props: ConfirmationModalProps): React.JSX.Element | null {
  if (!props.open) {
    return null
  }

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
        aria-labelledby="dialog-title"
        className={cn(glassPanelClass, 'w-full max-w-[520px] p-6 sm:p-7')}
      >
        <div onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <span className={pillClass}>
                <AlertTriangle className="size-4" />
                Confirmation
              </span>
              <div className="space-y-2">
                <h2
                  className="text-2xl font-semibold tracking-[-0.03em] text-[color:var(--on-surface)]"
                  id="dialog-title"
                >
                  {props.title}
                </h2>
                <p className="text-sm leading-7 text-[color:var(--on-surface-variant)]">
                  {props.description}
                </p>
              </div>
            </div>

            <button
              aria-label="Close dialog"
              className={iconButtonClass}
              type="button"
              onClick={props.onCancel}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-5 rounded-[24px] bg-white/58 p-4 text-sm leading-7 text-[color:var(--secondary)]">
            {props.tone === 'danger'
              ? 'Destructive actions stay confirmation-gated so the future backend flow does not encourage accidental loss.'
              : 'The current mock session lives in memory only and resets the visible workspace when it ends.'}
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
              {props.cancelLabel}
            </button>
            <button
              className={cn(
                props.tone === 'danger' ? dangerButtonClass : primaryButtonClass,
                'w-full sm:w-auto',
              )}
              type="button"
              onClick={props.onConfirm}
              disabled={props.isPending}
            >
              {props.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
              {props.confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
