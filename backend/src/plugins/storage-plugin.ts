import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const storagePluginImpl: FastifyPluginAsync = async function storagePlugin(
  app,
): Promise<void> {
  const { storageRoot } = app.serverConfig;

  await mkdir(path.join(storageRoot, 'users'), { recursive: true });
  app.decorate('storageRoot', storageRoot);
};

export const storagePlugin = fp(storagePluginImpl, {
  name: 'storage-plugin',
});
