import { type FastifyInstance, type FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../utils/http-errors.js';

export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('auth', null);
  app.decorate(
    'authenticate',
    async function authenticate(request: FastifyRequest): Promise<void> {
      const authorizationHeader = request.headers.authorization;

      if (authorizationHeader === undefined) {
        throw new UnauthorizedError('Missing access token.');
      }

      const accessToken = getBearerToken(authorizationHeader);
      request.auth = await app.authService.authenticate(accessToken);
    },
  );
}

function getBearerToken(authorizationHeader: string): string {
  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || token === undefined || token.trim() === '') {
    throw new UnauthorizedError('Invalid authorization header.');
  }

  return token;
}
