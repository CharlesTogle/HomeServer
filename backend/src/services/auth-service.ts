import { randomUUID } from 'node:crypto';

import type {
  AuthServiceConfig,
  AuthServiceContract,
  AuthTokens,
} from './contracts.js';
import type { LibraryServiceContract } from './contracts.js';
import { InMemoryHomeServerStore } from '../store/in-memory-store.js';
import type {
  AuthenticatedSession,
  SessionRecord,
  UserRecord,
} from '../types/domain.js';
import {
  hashPassword,
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from '../utils/auth-crypto.js';
import {
  ConflictError,
  UnauthorizedError,
} from '../utils/http-errors.js';

export class AuthService implements AuthServiceContract {
  private readonly config: AuthServiceConfig;
  private readonly libraryService: LibraryServiceContract;
  private readonly store: InMemoryHomeServerStore;

  public constructor(
    store: InMemoryHomeServerStore,
    libraryService: LibraryServiceContract,
    config: AuthServiceConfig,
  ) {
    this.store = store;
    this.libraryService = libraryService;
    this.config = config;
  }

  public async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const payload = verifyAccessToken(accessToken, this.config.authTokenSecret);
    const session = this.store.sessions.get(payload.sessionId);

    if (session === undefined || session.userId !== payload.userId) {
      throw new UnauthorizedError('Invalid access token.');
    }

    this.assertSessionIsActive(session);

    const user = this.store.users.get(payload.userId);

    if (user === undefined) {
      throw new UnauthorizedError('Invalid access token.');
    }

    return {
      email: user.email,
      sessionId: session.id,
      userId: user.id,
    };
  }

  public async getUserById(userId: string): Promise<UserRecord> {
    const user = this.store.users.get(userId);

    if (user === undefined) {
      throw new UnauthorizedError('User not found.');
    }

    return user;
  }

  public async login(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    const userId = this.store.userIdByEmail.get(normalizedEmail);

    if (userId === undefined) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    const user = this.store.users.get(userId);

    if (
      user === undefined ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    return this.issueTokensForUser(user);
  }

  public async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void> {
    if (refreshToken !== undefined) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const sessionId = this.store.sessionByRefreshTokenHash.get(refreshTokenHash);

      if (sessionId !== undefined) {
        const session = this.store.sessions.get(sessionId);

        if (session !== undefined) {
          this.revokeSession(session);
        }

        return;
      }
    }

    if (accessToken !== undefined) {
      const auth = await this.authenticate(accessToken);
      const session = this.store.sessions.get(auth.sessionId);

      if (session !== undefined) {
        this.revokeSession(session);
      }
    }
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const sessionId = this.store.sessionByRefreshTokenHash.get(refreshTokenHash);

    if (sessionId === undefined) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const session = this.store.sessions.get(sessionId);

    if (session === undefined) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    this.assertSessionIsActive(session);

    const user = this.store.users.get(session.userId);

    if (user === undefined) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    this.store.sessionByRefreshTokenHash.delete(session.refreshTokenHash);

    return this.issueTokensForUser(user, session);
  }

  public async provisionUser(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();

    if (this.store.userIdByEmail.has(normalizedEmail)) {
      throw new ConflictError('A user with that email already exists.');
    }

    const now = new Date();
    const user: UserRecord = {
      createdAt: now,
      email: normalizedEmail,
      id: randomUUID(),
      passwordHash: await hashPassword(password),
      updatedAt: now,
    };

    this.store.users.set(user.id, user);
    this.store.userIdByEmail.set(normalizedEmail, user.id);
    await this.libraryService.ensureUserRootFolder(user.id);

    return this.issueTokensForUser(user);
  }

  private assertSessionIsActive(session: SessionRecord): void {
    if (session.revokedAt !== null) {
      throw new UnauthorizedError('Session has been revoked.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Session has expired.');
    }
  }

  private createAccessToken(user: UserRecord, session: SessionRecord): string {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + this.config.accessTokenTtlSeconds;

    return issueAccessToken(
      {
        email: user.email,
        exp: expiresAtSeconds,
        sessionId: session.id,
        userId: user.id,
      },
      this.config.authTokenSecret,
    );
  }

  private issueSessionRecord(userId: string): SessionRecord {
    const now = new Date();

    return {
      createdAt: now,
      expiresAt: new Date(
        now.getTime() + this.config.refreshTokenTtlSeconds * 1000,
      ),
      id: randomUUID(),
      refreshTokenHash: '',
      revokedAt: null,
      updatedAt: now,
      userId,
    };
  }

  private issueTokensForUser(
    user: UserRecord,
    existingSession?: SessionRecord,
  ): AuthTokens {
    const session = existingSession ?? this.issueSessionRecord(user.id);
    const refreshToken = issueRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const now = new Date();

    session.refreshTokenHash = refreshTokenHash;
    session.updatedAt = now;
    session.expiresAt = new Date(
      now.getTime() + this.config.refreshTokenTtlSeconds * 1000,
    );
    session.revokedAt = null;

    this.store.sessions.set(session.id, session);
    this.store.sessionByRefreshTokenHash.set(refreshTokenHash, session.id);

    return {
      accessToken: this.createAccessToken(user, session),
      refreshToken,
      user,
    };
  }

  private revokeSession(session: SessionRecord): void {
    session.revokedAt = new Date();
    session.updatedAt = new Date();
    this.store.sessionByRefreshTokenHash.delete(session.refreshTokenHash);
  }
}
