import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Pool } from 'pg';

const databasePluginImpl: FastifyPluginAsync = async function databasePlugin(
  app,
): Promise<void> {
  const config = app.serverConfig;

  if (config.persistenceMode === 'test-memory') {
    app.decorate('database', {
      mode: 'test-memory',
    });
    app.decorate('pgPool', null);

    return;
  }

  if (config.databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for durable PostgreSQL mode.');
  }

  const pgPool = new Pool({
    connectionString: config.databaseUrl,
  });

  await pgPool.query('SELECT 1');

  app.decorate('database', {
    mode: 'postgresql',
  });
  app.decorate('pgPool', pgPool);

  app.addHook('onClose', async () => {
    await pgPool.end();
  });
};

export const databasePlugin = fp(databasePluginImpl, {
  name: 'database-plugin',
});
