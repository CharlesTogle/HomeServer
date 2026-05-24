import { create } from 'zustand'
import type { AuthSession, SessionUser } from '../types/auth.ts'

interface SessionStore {
  accessToken: string | null
  sessionUser: SessionUser | null
  setSession: (session: AuthSession) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  accessToken: null,
  sessionUser: null,
  setSession: (session) => {
    set({
      accessToken: session.accessToken,
      sessionUser: session.user,
    })
  },
  clearSession: () => {
    set({
      accessToken: null,
      sessionUser: null,
    })
  },
}))
