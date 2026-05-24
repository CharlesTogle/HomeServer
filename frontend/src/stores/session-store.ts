import { create } from 'zustand'
import type { AuthSession, SessionUser } from '../types/auth.ts'

interface SessionStore {
  accessToken: string | null
  expiresAt: string | null
  sessionUser: SessionUser | null
  setSession: (session: AuthSession) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  accessToken: null,
  expiresAt: null,
  sessionUser: null,
  setSession: (session) => {
    set({
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      sessionUser: session.user,
    })
  },
  clearSession: () => {
    set({
      accessToken: null,
      expiresAt: null,
      sessionUser: null,
    })
  },
}))
