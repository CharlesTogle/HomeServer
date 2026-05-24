import {
  type FastifyPluginAsync,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import { UnauthorizedError } from '../utils/http-errors.js';

const authPluginImpl: FastifyPluginAsync = async function authPlugin(
  app,
): Promise<void> {
  app.decorateRequest('auth', null);
  app.decorate(
    'authenticate',
    async function authenticate(
      request: FastifyRequest,
      _reply: FastifyReply,
    ): Promise<void> {
      const authorizationHeader = request.headers.authorization;

      if (authorizationHeader === undefined) {
        throw new UnauthorizedError('Missing access token.');
      }

      const accessToken = getBearerToken(authorizationHeader);
      request.auth = await app.authService.authenticate(accessToken);
    },
  );
};

export const authPlugin = fp(authPluginImpl, {
  dependencies: ['services-plugin'],
  name: 'auth-plugin',
});

function getBearerToken(authorizationHeader: string): string {
  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || token === undefined || token.trim() === '') {
    throw new UnauthorizedError('Invalid authorization header.');
  }

  return token;
}
