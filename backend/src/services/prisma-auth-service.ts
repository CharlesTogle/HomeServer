import { randomUUID } from 'node:crypto';

import type { PrismaClient, Session, User } from '@prisma/client';

import type {
  AuthServiceConfig,
  AuthServiceContract,
  AuthTokens,
  LibraryServiceContract,
} from './contracts.js';
import { toSessionRecord, toUserRecord } from './prisma-mappers.js';
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

export class PrismaAuthService implements AuthServiceContract {
  private readonly config: AuthServiceConfig;
  private readonly libraryService: LibraryServiceContract;
  private readonly prisma: PrismaClient;

  public constructor(
    prisma: PrismaClient,
    libraryService: LibraryServiceContract,
    config: AuthServiceConfig,
  ) {
    this.prisma = prisma;
    this.libraryService = libraryService;
    this.config = config;
  }

  public async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const payload = verifyAccessToken(accessToken, this.config.authTokenSecret);
    const session = await this.prisma.session.findUnique({
      include: {
        user: true,
      },
      where: {
        id: payload.sessionId,
      },
    });

    if (session === null || session.userId !== payload.userId) {
      throw new UnauthorizedError('Invalid access token.');
    }

    this.assertSessionIsActive(toSessionRecord(session));

    return {
      email: session.user.email,
      sessionId: session.id,
      userId: session.user.id,
    };
  }

  public async getUserById(userId: string): Promise<UserRecord> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (user === null) {
      throw new UnauthorizedError('User not found.');
    }

    return toUserRecord(user);
  }

  public async login(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (
      user === null ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    return this.issueTokensForUser(toUserRecord(user));
  }

  public async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void> {
    if (refreshToken !== undefined) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const session = await this.prisma.session.findUnique({
        where: {
          refreshTokenHash,
        },
      });

      if (session !== null) {
        await this.revokeSession(session.id);
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
    const session = await this.prisma.session.findUnique({
      include: {
        user: true,
      },
      where: {
        refreshTokenHash,
      },
    });

    if (session === null) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    this.assertSessionIsActive(toSessionRecord(session));

    return this.issueTokensForUser(
      toUserRecord(session.user),
      toSessionRecord(session),
    );
  }

  public async register(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
        },
      });

      await this.libraryService.ensureUserRootFolder(user.id);

      return this.issueTokensForUser(toUserRecord(user));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
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
  ): Promise<AuthTokens> {
    const session = existingSession ?? this.issueSessionRecord(user.id);
    const refreshToken = issueRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.refreshTokenTtlSeconds * 1000,
    );

    let persistedSession: Session | null = null;

    if (existingSession === undefined) {
      persistedSession = await this.prisma.session.create({
        data: {
          createdAt: session.createdAt,
          expiresAt,
          id: session.id,
          refreshTokenHash,
          revokedAt: null,
          updatedAt: now,
          userId: user.id,
        },
      });
    } else {
      persistedSession = await this.prisma.session.update({
        data: {
          expiresAt,
          refreshTokenHash,
          revokedAt: null,
          updatedAt: now,
        },
        where: {
          id: session.id,
        },
      });
    }

    const sessionRecord = toSessionRecord(persistedSession);

    return {
      accessToken: this.createAccessToken(user, sessionRecord),
      refreshToken,
      user,
    };
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      data: {
        revokedAt: new Date(),
        updatedAt: new Date(),
      },
      where: {
        id: sessionId,
      },
    });
  }
}
