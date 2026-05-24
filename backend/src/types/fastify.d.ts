import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type {
  AuthServiceContract,
  LibraryServiceContract,
} from '../services/contracts.js';
import type { InMemoryHomeServerStore } from '../store/in-memory-store.js';
import type {
  AuthenticatedSession,
  DatabaseConnectionState,
} from './domain.js';
import type { ServerConfig } from '../utils/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authService: AuthServiceContract;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    database: DatabaseConnectionState;
    libraryService: LibraryServiceContract;
    pgPool: Pool | null;
    serverConfig: ServerConfig;
    store: InMemoryHomeServerStore | null;
    storageRoot: string;
  }

  interface FastifyRequest {
    auth: AuthenticatedSession | null;
  }
}
