import { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { getServerConfig } from '../utils/env.js';

export async function databasePlugin(app: FastifyInstance): Promise<void> {
  const config = getServerConfig();

  if (config.databaseUrl === undefined) {
    app.decorate('database', {
      mode: 'memory',
    });
    app.decorate('prisma', null);

    return;
  }

  const prisma = new PrismaClient({
    datasourceUrl: config.databaseUrl,
  });

  await prisma.$connect();

  app.decorate('database', {
    mode: 'mariadb',
  });
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}
