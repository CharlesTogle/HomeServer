import Fastify, { type FastifyInstance } from 'fastify';
import { MulterError } from 'multer';

import { registerPlugins } from './plugins/index.js';
import { registerRoutes } from './routes/index.js';
import { getLoggerOptions } from './utils/logger.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: getLoggerOptions(),
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MulterError) {
      const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

      void reply.status(statusCode).send({ message: error.message });
      return;
    }

    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message =
      statusCode >= 500
        ? 'Internal server error'
        : error instanceof Error
          ? error.message
          : 'Unexpected error';

    void reply.status(statusCode).send({ message });
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.warn(
      {
        method: request.method,
        url: request.url,
      },
      'Route not found',
    );

    void reply.status(404).send({ message: 'Route not found' });
  });

  app.register(async function homeServer(appInstance): Promise<void> {
    await registerPlugins(appInstance);
    await registerRoutes(appInstance);
  });

  return app;
}
