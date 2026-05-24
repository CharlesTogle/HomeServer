import {
  ApiError,
  apiJson,
  apiResponse,
  clearClientSession,
  deriveDisplayName,
  setSessionFromAuthResponse,
} from './api-client.ts'
import type { AuthSession, LoginInput } from '../types/auth.ts'

interface BackendAuthResponse {
  accessToken: string
  user: {
    email: string
    id: string
  }
}

function toAuthSession(response: BackendAuthResponse): AuthSession {
  return {
    accessToken: response.accessToken,
    user: {
      email: response.user.email,
      id: response.user.id,
      name: deriveDisplayName(response.user.email) || 'HomeServer User',
    },
  }
}

export async function loginWithPassword(input: LoginInput): Promise<AuthSession> {
  const response = await apiJson<BackendAuthResponse>('/api/auth/login', {
    json: {
      email: input.email.trim().toLowerCase(),
      password: input.password,
    },
    method: 'POST',
    skipAuthRefresh: true,
  })

  setSessionFromAuthResponse(response)

  return toAuthSession(response)
}

export async function restoreSession(): Promise<AuthSession> {
  const response = await apiJson<BackendAuthResponse>('/api/auth/refresh', {
    method: 'POST',
    skipAuthRefresh: true,
  })

  setSessionFromAuthResponse(response)

  return toAuthSession(response)
}

export async function logoutSession(): Promise<void> {
  try {
    await apiResponse('/api/auth/logout', {
      method: 'POST',
      skipAuthRefresh: true,
    })
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 401) {
      throw error
    }
  } finally {
    clearClientSession()
  }
}
