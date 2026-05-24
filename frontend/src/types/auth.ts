export interface SessionUser {
  id: string
  name: string
  email: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface AuthSession {
  accessToken: string
  user: SessionUser
}
