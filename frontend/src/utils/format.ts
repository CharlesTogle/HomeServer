import type { MediaKind } from '../types/library.ts'

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = sizeBytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatTimestamp(value: string): string {
  return timestampFormatter.format(new Date(value))
}

export function formatRelativeTime(value: string): string {
  const targetTime = new Date(value).getTime()
  const now = Date.now()
  const diffMs = targetTime - now
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (Math.abs(diffMs) < hour) {
    return relativeTimeFormatter.format(Math.round(diffMs / minute), 'minute')
  }

  if (Math.abs(diffMs) < day) {
    return relativeTimeFormatter.format(Math.round(diffMs / hour), 'hour')
  }

  return relativeTimeFormatter.format(Math.round(diffMs / day), 'day')
}

export function formatMediaKind(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'Image'
    case 'audio':
      return 'Music'
    case 'video':
      return 'Video'
    case 'document':
      return 'Document'
    case 'archive':
      return 'Archive'
    default:
      return 'File'
  }
}
