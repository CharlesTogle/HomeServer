import { ROOT_FOLDER_ID } from '../constants/library.ts'
import type { FileRecord, FolderRecord } from '../types/library.ts'

export type StoredFolder = Omit<FolderRecord, 'itemCount'>

export type StoredFile = FileRecord

interface FolderSeedNode {
  id: string
  name: string
  createdAt: string
  children?: FolderSeedNode[]
}

function createArtworkDataUrl(
  title: string,
  subtitle: string,
  fromColor: string,
  toColor: string,
): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${fromColor}" />
          <stop offset="100%" stop-color="${toColor}" />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#g)" />
      <circle cx="1280" cy="200" r="220" fill="rgba(255,255,255,0.16)" />
      <circle cx="360" cy="740" r="260" fill="rgba(255,255,255,0.12)" />
      <rect x="112" y="112" width="1376" height="676" rx="42" fill="rgba(14,24,22,0.16)" />
      <text x="140" y="520" fill="white" font-family="Georgia,serif" font-size="108" font-weight="700">
        ${title}
      </text>
      <text x="140" y="610" fill="rgba(255,255,255,0.9)" font-family="Arial,sans-serif" font-size="44">
        ${subtitle}
      </text>
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function createToneDataUrl(): string {
  const sampleRate = 8_000
  const durationSeconds = 1.3
  const sampleCount = Math.floor(sampleRate * durationSeconds)
  const headerSize = 44
  const bytes = new Uint8Array(headerSize + sampleCount * 2)
  const view = new DataView(bytes.buffer)

  function writeAscii(offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, sampleCount * 2, true)

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate
    const envelope = Math.exp(-time * 2.8)
    const value =
      Math.sin(time * Math.PI * 2 * 220) * 0.45 +
      Math.sin(time * Math.PI * 2 * 330) * 0.2
    const sample = Math.max(-1, Math.min(1, value * envelope))
    view.setInt16(headerSize + index * 2, sample * 32_000, true)
  }

  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return `data:audio/wav;base64,${btoa(binary)}`
}

const harborArtwork = createArtworkDataUrl(
  'Golden Harbor',
  'Mock image preview with backend-ready route boundaries',
  '#b66f42',
  '#1f4d55',
)

const rooftopsArtwork = createArtworkDataUrl(
  'Rooftop Cut',
  'Video card placeholder until Fastify range streaming is wired',
  '#4b6d63',
  '#243833',
)

const documentArtwork = createArtworkDataUrl(
  'Server Notes',
  'Documents stay visible in the UI, but real bytes will come later',
  '#886b4f',
  '#40574e',
)

const audioArtwork = createArtworkDataUrl(
  'Night Session',
  'Audio playback already works through a local demo source',
  '#8d6940',
  '#35514a',
)

export const initialFolderTreeSeed: FolderSeedNode = {
  id: ROOT_FOLDER_ID,
  name: 'Private Library',
  createdAt: '2026-05-24T08:00:00.000Z',
  children: [
    {
      id: 'folder-gallery',
      name: 'Gallery',
      createdAt: '2026-05-23T08:00:00.000Z',
      children: [
        {
          id: 'folder-japan-trip',
          name: 'Japan Trip',
          createdAt: '2026-05-22T09:30:00.000Z',
        },
      ],
    },
    {
      id: 'folder-manuals',
      name: 'Manuals',
      createdAt: '2026-05-19T10:00:00.000Z',
    },
    {
      id: 'folder-projects',
      name: 'Projects',
      createdAt: '2026-05-22T07:00:00.000Z',
      children: [
        {
          id: 'folder-board-mixes',
          name: 'Board Mixes',
          createdAt: '2026-05-22T12:00:00.000Z',
        },
        {
          id: 'folder-rough-cuts',
          name: 'Rough Cuts',
          createdAt: '2026-05-20T12:00:00.000Z',
        },
      ],
    },
  ],
}

function flattenFolderTree(node: FolderSeedNode, parentId: string | null): StoredFolder[] {
  const currentFolder: StoredFolder = {
    id: node.id,
    name: node.name,
    parentId,
    createdAt: node.createdAt,
  }
  const childFolders = (node.children ?? []).flatMap((childNode) =>
    flattenFolderTree(childNode, node.id),
  )

  return [currentFolder, ...childFolders]
}

export const initialFolders: StoredFolder[] = flattenFolderTree(initialFolderTreeSeed, null)

export const initialFiles: StoredFile[] = [
  {
    id: 'file-harbor-image',
    name: 'golden-harbor.png',
    folderId: 'folder-japan-trip',
    mimeType: 'image/png',
    sizeBytes: 284_512,
    mediaKind: 'image',
    createdAt: '2026-05-24T09:00:00.000Z',
    viewerUrl: harborArtwork,
    posterUrl: harborArtwork,
    description: 'A demo still image to show the final image viewer layout.',
    source: 'mock',
  },
  {
    id: 'file-night-session',
    name: 'night-session.wav',
    folderId: 'folder-board-mixes',
    mimeType: 'audio/wav',
    sizeBytes: 20_844,
    mediaKind: 'audio',
    createdAt: '2026-05-24T09:15:00.000Z',
    viewerUrl: createToneDataUrl(),
    posterUrl: audioArtwork,
    description: 'A generated tone so the audio player is already interactive.',
    source: 'mock',
  },
  {
    id: 'file-rooftop-video',
    name: 'rooftop-cut.mp4',
    folderId: 'folder-rough-cuts',
    mimeType: 'video/mp4',
    sizeBytes: 512_440_320,
    mediaKind: 'video',
    createdAt: '2026-05-21T18:05:00.000Z',
    viewerUrl: null,
    posterUrl: rooftopsArtwork,
    description: 'A placeholder video entry for the future Fastify byte-range endpoint.',
    source: 'mock',
  },
  {
    id: 'file-server-notes',
    name: 'server-notes.pdf',
    folderId: 'folder-manuals',
    mimeType: 'application/pdf',
    sizeBytes: 148_220,
    mediaKind: 'document',
    createdAt: '2026-05-20T17:30:00.000Z',
    viewerUrl: null,
    posterUrl: documentArtwork,
    description: 'Document preview card ready for a backend download or inline viewer route.',
    source: 'mock',
  },
]

export function createFallbackPoster(title: string, subtitle: string): string {
  return createArtworkDataUrl(title, subtitle, '#5d7c71', '#253833')
}
