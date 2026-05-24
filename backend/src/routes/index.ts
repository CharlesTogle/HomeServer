import { type FastifyInstance } from 'fastify';

import { authRoutes } from './auth-routes.js';
import { fileRoutes } from './file-routes.js';
import { folderRoutes } from './folder-routes.js';
import { healthRoutes } from './health-routes.js';
import { uploadRoutes } from './upload-routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(folderRoutes);
  await app.register(fileRoutes);
  await app.register(uploadRoutes);
}
