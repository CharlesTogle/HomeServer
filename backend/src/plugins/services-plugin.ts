import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { AuthService } from '../services/auth-service.js';
import { LibraryService } from '../services/library-service.js';
import { PrismaAuthService } from '../services/prisma-auth-service.js';
import { PrismaLibraryService } from '../services/prisma-library-service.js';
import { InMemoryHomeServerStore } from '../store/in-memory-store.js';

const servicesPluginImpl: FastifyPluginAsync = async function servicesPlugin(
  app,
): Promise<void> {
  const config = app.serverConfig;
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
};

export const servicesPlugin = fp(servicesPluginImpl, {
  dependencies: ['database-plugin', 'storage-plugin'],
  name: 'services-plugin',
});
