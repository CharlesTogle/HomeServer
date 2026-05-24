import { type FastifyInstance } from 'fastify';

import { AuthService } from '../services/auth-service.js';
import { LibraryService } from '../services/library-service.js';
import { PrismaAuthService } from '../services/prisma-auth-service.js';
import { PrismaLibraryService } from '../services/prisma-library-service.js';
import { InMemoryHomeServerStore } from '../store/in-memory-store.js';
import { getServerConfig } from '../utils/env.js';

export async function servicesPlugin(app: FastifyInstance): Promise<void> {
  const config = getServerConfig();
  const authConfig = {
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    authTokenSecret: config.authTokenSecret,
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
  };

  if (app.prisma !== null) {
    const libraryService = new PrismaLibraryService(app.prisma, app.storageRoot);
    const authService = new PrismaAuthService(
      app.prisma,
      libraryService,
      authConfig,
    );

    app.decorate('store', null);
    app.decorate('libraryService', libraryService);
    app.decorate('authService', authService);

    return;
  }

  const store = new InMemoryHomeServerStore();
  const libraryService = new LibraryService(store, app.storageRoot);
  const authService = new AuthService(store, libraryService, authConfig);

  app.decorate('store', store);
  app.decorate('libraryService', libraryService);
  app.decorate('authService', authService);
}
