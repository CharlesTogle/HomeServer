import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import type {
  AuthServiceConfig,
  AuthServiceContract,
  AuthTokens,
} from './contracts.js';
import { PostgresLibraryService } from './postgres-library-service.js';
import {
  SESSION_SELECT_COLUMNS,
  USER_SELECT_COLUMNS,
  type SessionRow,
  type UserRow,
  toSessionRecord,
  toUserRecord,
} from './postgres-mappers.js';
import {
  isUniqueConstraintViolation,
  queryOptionalRow,
  type PostgresDatabaseClient,
  withPostgresTransaction,
} from './postgres-support.js';
import type { AuthenticatedSession, SessionRecord, UserRecord } from '../types/domain.js';
import {
  hashPassword,
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from '../utils/auth-crypto.js';
import { ConflictError, UnauthorizedError } from '../utils/http-errors.js';

export class PostgresAuthService implements AuthServiceContract {
  private readonly config: AuthServiceConfig;
  private readonly libraryService: PostgresLibraryService;
  private readonly pool: Pool;

  public constructor(
    pool: Pool,
    libraryService: PostgresLibraryService,
    config: AuthServiceConfig,
  ) {
    this.pool = pool;
    this.libraryService = libraryService;
    this.config = config;
  }

  public async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const payload = verifyAccessToken(accessToken, this.config.authTokenSecret);
    const sessionRow = await queryOptionalRow<SessionRow>(
      this.pool,
      `
        SELECT ${SESSION_SELECT_COLUMNS}
        FROM sessions
        WHERE id = $1
      `,
      [payload.sessionId],
    );

    if (sessionRow === null || sessionRow.userId !== payload.userId) {
      throw new UnauthorizedError('Invalid access token.');
    }

    const session = toSessionRecord(sessionRow);
    this.assertSessionIsActive(session);

    const user = await this.getUserById(payload.userId);

    return {
      email: user.email,
      sessionId: session.id,
      userId: user.id,
    };
  }

  public async getUserById(userId: string): Promise<UserRecord> {
    const userRow = await queryOptionalRow<UserRow>(
      this.pool,
      `
        SELECT ${USER_SELECT_COLUMNS}
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    if (userRow === null) {
      throw new UnauthorizedError('User not found.');
    }

    return toUserRecord(userRow);
  }

  public async login(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    const userRow = await queryOptionalRow<UserRow>(
      this.pool,
      `
        SELECT ${USER_SELECT_COLUMNS}
        FROM users
        WHERE email = $1
      `,
      [normalizedEmail],
    );

    if (
      userRow === null ||
      !(await verifyPassword(password, userRow.passwordHash))
    ) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    return this.issueTokensForUser(toUserRecord(userRow));
  }

  public async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void> {
    if (refreshToken !== undefined) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const sessionRow = await queryOptionalRow<SessionRow>(
        this.pool,
        `
          SELECT ${SESSION_SELECT_COLUMNS}
          FROM sessions
          WHERE refresh_token_hash = $1
        `,
        [refreshTokenHash],
      );

      if (sessionRow !== null) {
        await this.revokeSession(sessionRow.id);
        return;
      }
    }

    if (accessToken !== undefined) {
      const auth = await this.authenticate(accessToken);
      await this.revokeSession(auth.sessionId);
    }
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const sessionRow = await queryOptionalRow<SessionRow>(
      this.pool,
      `
        SELECT ${SESSION_SELECT_COLUMNS}
        FROM sessions
        WHERE refresh_token_hash = $1
      `,
      [refreshTokenHash],
    );

    if (sessionRow === null) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const session = toSessionRecord(sessionRow);
    this.assertSessionIsActive(session);

    const user = await this.getUserById(session.userId);

    return this.issueTokensForUser(user, session);
  }

  public async provisionUser(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    let createdRootStorageRelPath: string | null = null;

    try {
      return await withPostgresTransaction(this.pool, async (client) => {
        const now = new Date();
        const userId = randomUUID();
        const userRow = await queryOptionalRow<UserRow>(
          client,
          `
            INSERT INTO users (
              id,
              email,
              password_hash,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING ${USER_SELECT_COLUMNS}
          `,
          [userId, normalizedEmail, passwordHash, now, now],
        );

        if (userRow === null) {
          throw new Error('Failed to create user.');
        }

        createdRootStorageRelPath =
          await this.libraryService.createUserRootFolderInTransaction(
            client,
            userRow.id,
            now,
          );

        return this.issueTokensForUser(toUserRecord(userRow), undefined, client);
      });
    } catch (error) {
      await this.libraryService.cleanupDirectoryAfterFailedFolderWrite(
        createdRootStorageRelPath,
      );

      if (isUniqueConstraintViolation(error, 'users_email_unique_idx')) {
        throw new ConflictError('A user with that email already exists.');
      }

      throw error;
    }
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
    const expiresAtSeconds =
      Math.floor(Date.now() / 1000) + this.config.accessTokenTtlSeconds;

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

  private async issueTokensForUser(
    user: UserRecord,
    existingSession?: SessionRecord,
    client: PostgresDatabaseClient = this.pool,
  ): Promise<AuthTokens> {
    const session = existingSession ?? this.issueSessionRecord(user.id);
    const refreshToken = issueRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.refreshTokenTtlSeconds * 1000,
    );
    let sessionRow: SessionRow | null;

    if (existingSession === undefined) {
      sessionRow = await queryOptionalRow<SessionRow>(
        client,
        `
          INSERT INTO sessions (
            id,
            user_id,
            refresh_token_hash,
            expires_at,
            revoked_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING ${SESSION_SELECT_COLUMNS}
        `,
        [
          session.id,
          user.id,
          refreshTokenHash,
          expiresAt,
          null,
          session.createdAt,
          now,
        ],
      );
    } else {
      sessionRow = await queryOptionalRow<SessionRow>(
        client,
        `
          UPDATE sessions
          SET
            expires_at = $2,
            refresh_token_hash = $3,
            revoked_at = $4,
            updated_at = $5
          WHERE id = $1
          RETURNING ${SESSION_SELECT_COLUMNS}
        `,
        [session.id, expiresAt, refreshTokenHash, null, now],
      );
    }

    if (sessionRow === null) {
      throw new UnauthorizedError('Session could not be issued.');
    }

    const persistedSession = toSessionRecord(sessionRow);

    return {
      accessToken: this.createAccessToken(user, persistedSession),
      refreshToken,
      user,
    };
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE sessions
        SET
          revoked_at = $2,
          updated_at = $2
        WHERE id = $1
      `,
      [sessionId, new Date()],
    );
  }
}
