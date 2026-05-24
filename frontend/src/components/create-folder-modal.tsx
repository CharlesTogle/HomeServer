import { FolderPlus, LoaderCircle, X } from "lucide-react";
import { cn } from "../lib/cn.ts";
import {
  fieldInputClass,
  fieldLabelClass,
  ghostButtonClass,
  glassPanelClass,
  iconButtonClass,
  pillClass,
  primaryButtonClass,
} from "../lib/ui.ts";

interface CreateFolderModalProps {
  open: boolean;
  folderName: string;
  isPending: boolean;
  errorMessage: string | null;
  onChangeFolderName: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CreateFolderModal(
  props: CreateFolderModalProps,
): React.JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(84,66,73,0.32)] px-4 py-6 backdrop-blur-md"
      role="presentation"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          props.onCancel();
        }
      }}
      onMouseDown={props.onCancel}
    >
      <dialog
        open
        aria-labelledby="create-folder-title"
        className={cn(
          glassPanelClass,
          "static m-0 w-full max-w-[520px] p-6 sm:p-7",
        )}
      >
        <div onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <span className={pillClass}>
                <FolderPlus className="size-4" />
                Create folder
              </span>
              <div className="space-y-2">
                <h2
                  className="text-2xl font-semibold tracking-[-0.03em] text-[color:var(--on-surface)]"
                  id="create-folder-title"
                >
                  Add a nested room
                </h2>
                <p className="text-sm leading-7 text-[color:var(--on-surface-variant)]">
                  Name the folder and open it immediately after creation.
                </p>
              </div>
            </div>

            <button
              aria-label="Close create folder dialog"
              className={iconButtonClass}
              type="button"
              onClick={props.onCancel}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-6 space-y-2">
            <label className={fieldLabelClass} htmlFor="create-folder-name">
              Folder name
            </label>
            <input
              id="create-folder-name"
              type="text"
              aria-label="Folder name"
              className={fieldInputClass}
              value={props.folderName}
              onChange={(event) =>
                props.onChangeFolderName(event.currentTarget.value)
              }
            />
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
              className={cn(ghostButtonClass, "w-full sm:w-auto")}
              type="button"
              onClick={props.onCancel}
            >
              Cancel
            </button>
            <button
              className={cn(primaryButtonClass, "w-full sm:w-auto")}
              type="button"
              onClick={props.onConfirm}
              disabled={props.isPending}
            >
              {props.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FolderPlus className="size-4" />
              )}
              Create and open
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
