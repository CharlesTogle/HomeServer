import { FileText, Image, Info, LoaderCircle, Music, Video, X } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import {
  chipClass,
  darkPanelClass,
  glassPanelClass,
  iconButtonClass,
  pillClass,
  sectionSubtextClass,
  softCardClass,
} from '../lib/ui.ts'
import type { FileRecord, FolderRecord } from '../types/library.ts'
import {
  formatBytes,
  formatMediaKind,
  formatRelativeTime,
  formatTimestamp,
} from '../utils/format.ts'

interface MediaViewerProps {
  currentFolderName: string | null
  inspectedFolder: FolderRecord | null
  isPreviewLoading: boolean
  mode: 'preview' | 'properties'
  previewErrorMessage: string | null
  previewUrl: string | null
  selectedFile: FileRecord | null
  onClose: () => void
}

const emptyCaptionTrack = 'data:text/vtt;charset=UTF-8,WEBVTT'

function ViewerStage(props: {
  file: FileRecord
  isPreviewLoading: boolean
  previewErrorMessage: string | null
  previewUrl: string | null
}): React.JSX.Element {
  if (props.previewErrorMessage !== null) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-[24px] border border-dashed border-white/18 bg-white/8 p-6 text-center text-white/76">
        <div className="space-y-3">
          <FileText className="mx-auto size-6 text-[color:var(--inverse-primary)]" />
          <h3 className="text-lg font-semibold text-white">{props.file.name}</h3>
          <p className="max-w-[32ch] text-sm leading-6">{props.previewErrorMessage}</p>
        </div>
      </div>
    )
  }

  if (props.isPreviewLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-[24px] border border-dashed border-white/18 bg-white/8 p-6 text-center text-white/76">
        <div className="space-y-3">
          <LoaderCircle className="mx-auto size-6 animate-spin text-[color:var(--inverse-primary)]" />
          <h3 className="text-lg font-semibold text-white">Preparing preview</h3>
          <p className="max-w-[32ch] text-sm leading-6">
            Fetching the protected media bytes from the backend.
          </p>
        </div>
      </div>
    )
  }

  switch (props.file.mediaKind) {
    case 'image':
      if (props.previewUrl !== null) {
        return (
          <img
            src={props.previewUrl}
            alt={`Preview of ${props.file.name}`}
            className="max-h-[360px] w-full rounded-[24px] object-cover"
          />
        )
      }
      break
    case 'audio':
      if (props.previewUrl !== null) {
        return (
          <audio
            controls
            aria-label={`Audio preview for ${props.file.name}`}
            className="w-full"
            src={props.previewUrl}
          >
            <track
              kind="captions"
              label="No captions available"
              src={emptyCaptionTrack}
              srcLang="en"
            />
          </audio>
        )
      }
      break
    case 'video':
      if (props.previewUrl !== null) {
        return (
          <video
            controls
            playsInline
            aria-label={`Video preview for ${props.file.name}`}
            className="max-h-[360px] w-full rounded-[24px] object-cover"
          >
            <source src={props.previewUrl} type={props.file.mimeType} />
            <track
              kind="captions"
              label="No captions available"
              src={emptyCaptionTrack}
              srcLang="en"
            />
          </video>
        )
      }
      break
    default:
      break
  }

  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-[24px] border border-dashed border-white/18 bg-white/8 p-6 text-center text-white/76">
      <div className="space-y-3">
        {props.file.mediaKind === 'video' ? (
          <Video className="mx-auto size-6 text-[color:var(--inverse-primary)]" />
        ) : (
          <FileText className="mx-auto size-6 text-[color:var(--inverse-primary)]" />
        )}
        <h3 className="text-lg font-semibold text-white">{props.file.name}</h3>
        <p className="max-w-[28ch] text-sm leading-6">
          {props.file.mediaKind === 'video'
            ? 'Video playback will appear here after the preview bytes finish loading.'
            : 'This file type does not expose an inline preview yet, but download works.'}
        </p>
      </div>
    </div>
  )
}

function ViewerIcon(props: { file: FileRecord }): React.JSX.Element {
  switch (props.file.mediaKind) {
    case 'image':
      return <Image className="size-4" />
    case 'audio':
      return <Music className="size-4" />
    case 'video':
      return <Video className="size-4" />
    default:
      return <FileText className="size-4" />
  }
}

function MetadataRow(props: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-[22px] bg-white/64 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-[color:var(--secondary)]">{props.label}</span>
      <strong className="text-sm font-semibold text-[color:var(--on-surface)]">
        {props.value}
      </strong>
    </div>
  )
}

export function MediaViewer(props: MediaViewerProps): React.JSX.Element {
  const inspectedFolderCreatedAt = props.inspectedFolder?.createdAt ?? null
  const inspectorPanelClass = cn(
    glassPanelClass,
    'space-y-5 p-5 sm:p-6 xl:sticky xl:top-4 xl:h-[calc(100svh-2rem)] xl:overflow-y-auto',
  )

  if (props.selectedFile === null && props.inspectedFolder === null) {
    return <></>
  }

  if (props.selectedFile !== null) {
    return (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-[rgba(84,66,73,0.32)] px-4 py-6 backdrop-blur-md"
        role="presentation"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            props.onClose()
          }
        }}
        onMouseDown={props.onClose}
      >
        <dialog
          open
          aria-labelledby="file-preview-title"
          className={cn(glassPanelClass, 'static m-0 w-full max-w-[1040px] p-5 sm:p-6')}
        >
          <div className="space-y-5" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <span className={pillClass}>
                  {props.mode === 'properties' ? (
                    <Info className="size-4" />
                  ) : (
                    <ViewerIcon file={props.selectedFile} />
                  )}
                  {props.mode === 'properties'
                    ? 'File properties'
                    : `${formatMediaKind(props.selectedFile.mediaKind)} preview`}
                </span>
                <div className="space-y-2">
                  <h2
                    className="text-3xl font-semibold tracking-[-0.03em] text-[color:var(--on-surface)]"
                    id="file-preview-title"
                  >
                    {props.selectedFile.name}
                  </h2>
                  <p className={sectionSubtextClass}>{props.selectedFile.description}</p>
                </div>
              </div>

              <button
                aria-label="Close file preview"
                className={iconButtonClass}
                type="button"
                onClick={props.onClose}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_320px]">
              <div className={cn(darkPanelClass, 'space-y-4 p-4')}>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/12 pb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{props.selectedFile.name}</h3>
                    <p className="mt-1 text-sm text-white/72">
                      {props.mode === 'properties'
                        ? 'Structured metadata for the current backend-backed file.'
                        : `${formatMediaKind(props.selectedFile.mediaKind)} preview stage`}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/84">
                      {props.selectedFile.mimeType}
                    </span>
                    <span className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/84">
                      {formatBytes(props.selectedFile.sizeBytes)}
                    </span>
                  </div>
                </div>

                <ViewerStage
                  file={props.selectedFile}
                  isPreviewLoading={props.isPreviewLoading}
                  previewErrorMessage={props.previewErrorMessage}
                  previewUrl={props.previewUrl}
                />
              </div>

              <div className="space-y-4">
                <div className={cn(softCardClass, 'space-y-3 p-4')}>
                  <MetadataRow label="Created" value={formatTimestamp(props.selectedFile.createdAt)} />
                  <MetadataRow label="Added" value={formatRelativeTime(props.selectedFile.createdAt)} />
                  <MetadataRow
                    label="Location"
                    value={props.currentFolderName ?? 'Loading current folder'}
                  />
                  <MetadataRow label="Status" value={props.selectedFile.status} />
                </div>

                <div className={cn(softCardClass, 'space-y-3 p-5')}>
                  <strong className="block text-base font-semibold text-[color:var(--on-surface)]">
                    {props.mode === 'properties' ? 'Inspector notes' : 'Preview notes'}
                  </strong>
                  <p className={sectionSubtextClass}>
                    {props.mode === 'properties'
                      ? 'The inspector now reflects real backend metadata, even when the media preview is fetched on demand.'
                      : 'Preview bytes are fetched only when you open the file, so the library grid stays lightweight.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className={chipClass}>Inline image</span>
                    <span className={chipClass}>Audio controls</span>
                    <span className={chipClass}>Range-ready video</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </dialog>
      </div>
    )
  }

  return (
    <section className={inspectorPanelClass}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <span className={pillClass}>
            <Info className="size-4" />
            Folder properties
          </span>
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-[color:var(--on-surface)]">
              {props.inspectedFolder?.name}
            </h2>
            <p className={sectionSubtextClass}>
              Review this folder before moving, downloading, or deleting it.
            </p>
          </div>
        </div>

        <button
          aria-label="Close inspector"
          className={iconButtonClass}
          type="button"
          onClick={props.onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className={cn(softCardClass, 'space-y-3 p-4')}>
        <MetadataRow
          label="Created"
          value={
            inspectedFolderCreatedAt === null
              ? 'Not available'
              : formatTimestamp(inspectedFolderCreatedAt)
          }
        />
        <MetadataRow
          label="Added"
          value={
            inspectedFolderCreatedAt === null
              ? 'Not available'
              : formatRelativeTime(inspectedFolderCreatedAt)
          }
        />
        <MetadataRow label="Direct items" value={props.inspectedFolder?.itemCount ?? 0} />
        <MetadataRow
          label="Parent view"
          value={props.currentFolderName ?? 'Loading current folder'}
        />
      </div>
    </section>
  )
}
