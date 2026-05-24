import { type FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import fp from 'fastify-plugin';

const multipartPluginImpl: FastifyPluginAsync = async function multipartPlugin(
  app,
): Promise<void> {
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 50 * 1024 * 1024,
      parts: 2,
    },
  });
};

export const multipartPlugin = fp(multipartPluginImpl, {
  name: 'multipart-plugin',
});
