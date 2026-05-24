import { useSessionStore } from '../stores/session-store.ts'
import { useWorkspaceStore } from '../stores/workspace-store.ts'

type ApiBody = BodyInit | null | undefined
type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: ApiBody
  json?: JsonValue | Record<string, unknown>
  skipAuthRefresh?: boolean
}

interface BackendAuthResponse {
  accessToken: string
  user: {
    email: string
    id: string
  }
}

export class ApiError extends Error {
  public readonly statusCode: number

  public constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
  }
}

let refreshPromise: Promise<string | null> | null = null

function deriveDisplayName(email: string): string {
  const [namePart] = email.split('@')

  return namePart
    .split(/[.\-_]/g)
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function clearClientSession(): void {
  useSessionStore.getState().clearSession()
  useWorkspaceStore.getState().reset()
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === 'string' ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
}

function buildRequestInit(
  accessToken: string | null,
  options: ApiRequestOptions,
): RequestInit {
  const headers = new Headers(options.headers)

  if (accessToken !== null && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${accessToken}`)
  }

  let body = options.body

  if (options.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(options.json)
  } else if (body !== undefined && body !== null && !isBodyInit(body)) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(body)
  }

  return {
    ...options,
    body,
    credentials: options.credentials ?? 'include',
    headers,
  }
}

async function getErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const data = (await response.json().catch(() => null)) as
      | { message?: string }
      | null

    if (data?.message !== undefined && data.message.trim() !== '') {
      return data.message
    }
  }

  const fallbackText = await response.text().catch(() => '')

  return fallbackText.trim() || `Request failed with status ${response.status}.`
}

function setSessionFromAuthResponse(response: BackendAuthResponse): void {
  useSessionStore.getState().setSession({
    accessToken: response.accessToken,
    user: {
      email: response.user.email,
      id: response.user.id,
      name: deriveDisplayName(response.user.email) || 'HomeServer User',
    },
  })
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise !== null) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const response = await fetch('/api/auth/refresh', {
      credentials: 'include',
      method: 'POST',
    })

    if (!response.ok) {
      clearClientSession()
      return null
    }

    const payload = (await response.json()) as BackendAuthResponse

    setSessionFromAuthResponse(payload)

    return payload.accessToken
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

async function apiRequest(
  input: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const accessToken = useSessionStore.getState().accessToken
  const requestInit = buildRequestInit(accessToken, options)
  let response = await fetch(input, requestInit)

  if (response.status !== 401 || options.skipAuthRefresh) {
    return response
  }

  const refreshedAccessToken = await refreshAccessToken()

  if (refreshedAccessToken === null) {
    return response
  }

  response = await fetch(input, buildRequestInit(refreshedAccessToken, options))

  if (response.status === 401) {
    clearClientSession()
  }

  return response
}

export async function apiJson<T>(
  input: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const response = await apiRequest(input, options)

  if (!response.ok) {
    throw new ApiError(response.status, await getErrorMessage(response))
  }

  return (await response.json()) as T
}

export async function apiBlob(
  input: string,
  options?: ApiRequestOptions,
): Promise<Blob> {
  const response = await apiRequest(input, options)

  if (!response.ok) {
    throw new ApiError(response.status, await getErrorMessage(response))
  }

  return await response.blob()
}

export async function apiResponse(
  input: string,
  options?: ApiRequestOptions,
): Promise<Response> {
  const response = await apiRequest(input, options)

  if (!response.ok) {
    throw new ApiError(response.status, await getErrorMessage(response))
  }

  return response
}

export { clearClientSession, deriveDisplayName, setSessionFromAuthResponse }
