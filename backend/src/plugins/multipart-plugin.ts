import { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

export async function multipartPlugin(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 50 * 1024 * 1024,
      parts: 2,
    },
  });
}
