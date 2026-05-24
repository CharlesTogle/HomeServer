import dotenv from 'dotenv';

import { buildApp } from './app.js';
import { getServerConfig } from './utils/env.js';

dotenv.config();

const app = buildApp();

async function start(): Promise<void> {
  try {
    const config = getServerConfig();

    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    await app.close();
  }
}

void start();
