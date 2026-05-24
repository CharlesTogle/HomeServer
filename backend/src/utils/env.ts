import path from 'node:path';

import { z } from 'zod';

export interface ServerConfig {
  accessTokenTtlSeconds: number;
  authTokenSecret: string;
  databaseUrl?: string;
  host: string;
  port: number;
  refreshTokenTtlSeconds: number;
  storageRoot: string;
}

export function getServerConfig(): ServerConfig {
  const envSchema = z.object({
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    AUTH_TOKEN_SECRET: z
      .string()
      .min(1)
      .default('homeserver-dev-secret-change-me'),
    DATABASE_URL: z.string().min(1).optional(),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30),
    STORAGE_ROOT: z
      .string()
      .min(1)
      .default(path.resolve(process.cwd(), '../storage')),
  });
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    throw new Error(parsedEnv.error.issues.map((issue) => issue.message).join('; '));
  }

  return {
    accessTokenTtlSeconds: parsedEnv.data.ACCESS_TOKEN_TTL_SECONDS,
    authTokenSecret: parsedEnv.data.AUTH_TOKEN_SECRET,
    databaseUrl: parsedEnv.data.DATABASE_URL,
    host: parsedEnv.data.HOST,
    port: parsedEnv.data.PORT,
    refreshTokenTtlSeconds: parsedEnv.data.REFRESH_TOKEN_TTL_SECONDS,
    storageRoot: parsedEnv.data.STORAGE_ROOT,
  };
}
