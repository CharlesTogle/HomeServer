import dotenv from 'dotenv';
import { type FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { getServerConfig } from './utils/env.js';

dotenv.config();

async function start(): Promise<void> {
  let app: FastifyInstance | null = null;

  try {
    const config = getServerConfig();
    app = buildApp({ config });

    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    if (app === null) {
      console.error(error);
      process.exitCode = 1;
      return;
    }

    app.log.error(error);
    process.exitCode = 1;
    await app.close();
  }
}

void start();
