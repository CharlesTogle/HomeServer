import { HardDrive, LoaderCircle, Upload, X } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { cn } from "../lib/cn.ts";
import {
  fieldLabelClass,
  glassPanelClass,
  iconButtonClass,
  pillClass,
  primaryButtonClass,
  sectionHeadingClass,
  sectionSubtextClass,
  softCardClass,
} from "../lib/ui.ts";
import { formatBytes } from "../utils/format.ts";

interface UploadPanelProps {
  currentFolderName: string;
  isPending: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onUpload: (files: File[]) => Promise<void>;
}

export function UploadPanel(props: UploadPanelProps): React.JSX.Element {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setSelectedFiles(Array.from(event.currentTarget.files ?? []));
  }

  async function handleSubmit(): Promise<void> {
    if (selectedFiles.length === 0) {
      return;
    }

    await props.onUpload(selectedFiles);
    setSelectedFiles([]);
    setInputKey((value) => value + 1);
    props.onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(84,66,73,0.32)] px-4 py-6 backdrop-blur-md"
      role="presentation"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          props.onClose();
        }
      }}
      onMouseDown={props.onClose}
    >
      <dialog
        open
        aria-labelledby="upload-dialog-title"
        className={cn(
          glassPanelClass,
          "static m-0 w-full max-w-[1120px] p-5 sm:p-6",
        )}
      >
        <div onMouseDown={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="space-y-2">
              <span className={pillClass}>
                <Upload className="size-4" />
                Upload
              </span>
              <p className="text-sm leading-6 text-[color:var(--on-surface-variant)]">
                Add files to{" "}
                <strong className="font-semibold text-[color:var(--on-surface)]">
                  {props.currentFolderName}
                </strong>
                .
              </p>
            </div>

            <button
              aria-label="Close upload modal"
              className={iconButtonClass}
              type="button"
              onClick={props.onClose}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className={cn(softCardClass, "flex flex-col gap-4 p-6")}>
              <div className="space-y-2">
                <p className={sectionHeadingClass}>Current destination</p>
                <h2
                  className="text-[clamp(2.2rem,3vw,3.15rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-[color:var(--on-surface)]"
                  id="upload-dialog-title"
                >
                  Stage files into {props.currentFolderName}
                </h2>
                <p className={sectionSubtextClass}>
                  This preview keeps the upload flow immediate so the final
                  backend stream can slot into the same interface.
                </p>
              </div>

              <div className="rounded-[24px] bg-white/60 p-5">
                <HardDrive className="size-5 text-[color:var(--primary)]" />
                <p className="mt-4 text-sm font-semibold text-[color:var(--on-surface)]">
                  What you are testing
                </p>
                <p className="mt-2 text-sm leading-7 text-[color:var(--on-surface-variant)]">
                  Folder targeting, immediate library refresh, and a modal
                  surface that can later wrap real multipart progress.
                </p>
              </div>

              <button
                className={cn(primaryButtonClass, "mt-auto w-full")}
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={props.isPending || selectedFiles.length === 0}
              >
                {props.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Add to folder
              </button>
            </div>

            <div className="flex min-h-[360px] flex-col gap-4">
              <div className="rounded-[28px] border border-dashed border-[rgba(218,192,201,0.9)] bg-white/66 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.84)]">
                <div className="space-y-3">
                  <span className={fieldLabelClass}>Choose files</span>
                  <input
                    ref={fileInputRef}
                    key={inputKey}
                    id="upload-input"
                    multiple
                    type="file"
                    aria-label="Choose files to upload"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="flex min-h-[188px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[rgba(218,192,201,0.95)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(253,242,248,0.82))] px-6 text-center">
                    <Upload className="size-8 text-[color:var(--primary)]" />
                    <strong className="mt-5 text-[clamp(1.55rem,2vw,2rem)] font-semibold tracking-[-0.03em] text-[color:var(--on-surface)]">
                      Select one or more files
                    </strong>
                    <span className="mt-3 max-w-[30ch] text-base leading-8 text-[color:var(--on-surface-variant)]">
                      Uploaded items stay within this mock session and appear in
                      the collection immediately.
                    </span>
                    <button
                      className={cn(primaryButtonClass, "mt-6")}
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="size-4" />
                      Choose files
                    </button>
                  </div>
                </div>
              </div>

              {props.errorMessage !== null ? (
                <div
                  className="rounded-[22px] border border-[color:var(--error-container)] bg-[color:var(--error-container)] px-4 py-3 text-sm text-[color:var(--on-error-container)]"
                  role="alert"
                >
                  {props.errorMessage}
                </div>
              ) : null}

              {selectedFiles.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {selectedFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.lastModified}`}
                      className="rounded-[22px] border border-[rgba(218,192,201,0.9)] bg-white/78 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <strong className="block truncate text-sm font-semibold text-[color:var(--on-surface)]">
                            {file.name}
                          </strong>
                          <span className="mt-1 block truncate text-sm text-[color:var(--on-surface-variant)]">
                            {file.type || "application/octet-stream"}
                          </span>
                        </div>
                        <span className="rounded-full bg-[rgba(244,114,182,0.12)] px-2.5 py-1 text-xs font-semibold text-[color:var(--primary)]">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-[28px] border border-dashed border-[rgba(218,192,201,0.88)] bg-white/40 px-6 py-10 text-center">
                  <div className="space-y-2">
                    <Upload className="mx-auto size-5 text-[color:var(--primary)]" />
                    <p className="text-sm leading-6 text-[color:var(--on-surface-variant)]">
                      Choose files to see them staged here before adding them to
                      the folder.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
