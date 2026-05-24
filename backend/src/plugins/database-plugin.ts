import { type FastifyPluginAsync } from 'fastify';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';

const databasePluginImpl: FastifyPluginAsync = async function databasePlugin(
  app,
): Promise<void> {
  const config = app.serverConfig;

  if (config.persistenceMode === 'test-memory') {
    app.decorate('database', {
      mode: 'test-memory',
    });
    app.decorate('prisma', null);

    return;
  }

  if (config.databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for durable PostgreSQL mode.');
  }

  const adapter = new PrismaPg(config.databaseUrl);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  app.decorate('database', {
    mode: 'postgresql',
  });
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export const databasePlugin = fp(databasePluginImpl, {
  name: 'database-plugin',
});
