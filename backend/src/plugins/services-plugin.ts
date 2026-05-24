import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { AuthService } from '../services/auth-service.js';
import { LibraryService } from '../services/library-service.js';
import { PostgresAuthService } from '../services/postgres-auth-service.js';
import { PostgresLibraryService } from '../services/postgres-library-service.js';
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

  if (app.pgPool !== null) {
    const libraryService = new PostgresLibraryService(app.pgPool, app.storageRoot);
    const authService = new PostgresAuthService(
      app.pgPool,
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
