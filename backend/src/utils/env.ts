import path from 'node:path';

import { z } from 'zod';

export type PersistenceMode = 'durable' | 'test-memory';
export type RuntimeMode = 'development' | 'production' | 'test';

export interface ServerConfig {
  accessTokenTtlSeconds: number;
  authTokenSecret: string;
  databaseUrl?: string;
  host: string;
  persistenceMode: PersistenceMode;
  port: number;
  refreshTokenTtlSeconds: number;
  runtimeMode: RuntimeMode;
  storageRoot: string;
}

export interface InMemoryTestServerConfigOptions {
  accessTokenTtlSeconds?: number;
  authTokenSecret?: string;
  host?: string;
  port?: number;
  refreshTokenTtlSeconds?: number;
  storageRoot: string;
}

interface RawServerConfig {
  accessTokenTtlSeconds: number;
  authTokenSecret?: string;
  databaseUrl?: string;
  host: string;
  persistenceMode: PersistenceMode;
  port: number;
  refreshTokenTtlSeconds: number;
  runtimeMode: RuntimeMode;
  storageRoot?: string;
}

const envSchema = z.object({
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_TOKEN_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  HOMESERVER_TEST_MODE: z.enum(['true', 'false']).optional(),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  STORAGE_ROOT: z.string().optional(),
});

export function getServerConfig(): ServerConfig {
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    throw new Error(parsedEnv.error.issues.map((issue) => issue.message).join('; '));
  }

  if (
    parsedEnv.data.HOMESERVER_TEST_MODE === 'true' &&
    parsedEnv.data.NODE_ENV !== 'test'
  ) {
    throw new Error(
      'HOMESERVER_TEST_MODE can only be enabled when NODE_ENV=test.',
    );
  }

  const isExplicitTestMemoryMode =
    parsedEnv.data.NODE_ENV === 'test' &&
    parsedEnv.data.HOMESERVER_TEST_MODE === 'true';

  return createServerConfig({
    accessTokenTtlSeconds: parsedEnv.data.ACCESS_TOKEN_TTL_SECONDS,
    authTokenSecret: parsedEnv.data.AUTH_TOKEN_SECRET,
    databaseUrl: parsedEnv.data.DATABASE_URL,
    host: parsedEnv.data.HOST,
    persistenceMode: isExplicitTestMemoryMode ? 'test-memory' : 'durable',
    port: parsedEnv.data.PORT,
    refreshTokenTtlSeconds: parsedEnv.data.REFRESH_TOKEN_TTL_SECONDS,
    runtimeMode: parsedEnv.data.NODE_ENV,
    storageRoot: parsedEnv.data.STORAGE_ROOT,
  });
}

export function createInMemoryTestServerConfig(
  options: InMemoryTestServerConfigOptions,
): ServerConfig {
  return createServerConfig({
    accessTokenTtlSeconds: options.accessTokenTtlSeconds ?? 900,
    authTokenSecret: options.authTokenSecret ?? 'homeserver-test-secret',
    host: options.host ?? '127.0.0.1',
    persistenceMode: 'test-memory',
    port: options.port ?? 3999,
    refreshTokenTtlSeconds: options.refreshTokenTtlSeconds ?? 60 * 60 * 24 * 30,
    runtimeMode: 'test',
    storageRoot: options.storageRoot,
  });
}

function createServerConfig(input: RawServerConfig): ServerConfig {
  const authTokenSecret = getRequiredString(
    input.authTokenSecret,
    'AUTH_TOKEN_SECRET is required.',
  );
  const storageRoot = path.resolve(
    getRequiredString(input.storageRoot, 'STORAGE_ROOT is required.'),
  );

  if (input.persistenceMode === 'test-memory') {
    if (input.runtimeMode !== 'test') {
      throw new Error(
        'In-memory mode is test-only. Set NODE_ENV=test and HOMESERVER_TEST_MODE=true.',
      );
    }

    return {
      accessTokenTtlSeconds: input.accessTokenTtlSeconds,
      authTokenSecret,
      host: input.host,
      persistenceMode: input.persistenceMode,
      port: input.port,
      refreshTokenTtlSeconds: input.refreshTokenTtlSeconds,
      runtimeMode: input.runtimeMode,
      storageRoot,
    };
  }

  return {
    accessTokenTtlSeconds: input.accessTokenTtlSeconds,
    authTokenSecret,
    databaseUrl: getRequiredString(input.databaseUrl, 'DATABASE_URL is required.'),
    host: input.host,
    persistenceMode: input.persistenceMode,
    port: input.port,
    refreshTokenTtlSeconds: input.refreshTokenTtlSeconds,
    runtimeMode: input.runtimeMode,
    storageRoot,
  };
}

function getRequiredString(
  value: string | undefined,
  errorMessage: string,
): string {
  if (value === undefined) {
    throw new Error(errorMessage);
  }

  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}
