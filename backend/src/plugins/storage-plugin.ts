import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { type FastifyInstance } from 'fastify';

import { getServerConfig } from '../utils/env.js';

export async function storagePlugin(app: FastifyInstance): Promise<void> {
  const { storageRoot } = getServerConfig();

  await mkdir(path.join(storageRoot, 'users'), { recursive: true });
  app.decorate('storageRoot', storageRoot);
}
