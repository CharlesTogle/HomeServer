import { type FastifyInstance } from 'fastify';

import { authPlugin } from './auth-plugin.js';
import { databasePlugin } from './database-plugin.js';
import { multipartPlugin } from './multipart-plugin.js';
import { servicesPlugin } from './services-plugin.js';
import { storagePlugin } from './storage-plugin.js';

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(multipartPlugin);
  await app.register(databasePlugin);
  await app.register(storagePlugin);
  await app.register(servicesPlugin);
  await app.register(authPlugin);
}
