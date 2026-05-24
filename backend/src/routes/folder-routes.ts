import { type FastifyInstance, type FastifyRequest } from 'fastify';

import {
  toFolderEntriesResponse,
  toFolderResponse,
  type FolderEntriesResponse,
  type FolderResponse,
  toFolderTreeResponse,
  type FolderTreeResponse,
} from '../types/api.js';
import { UnauthorizedError } from '../utils/http-errors.js';
import {
  folderEntriesResponseSchema,
  folderParamsSchema,
  folderResponseSchema,
  folderTreeResponseSchema,
} from './route-schemas.js';

interface CreateFolderBody {
  name: string;
  parentFolderId: string;
}

interface FolderParams {
  folderId: string;
}

interface UpdateFolderBody {
  name?: string;
  parentFolderId?: string;
}

interface DeleteFolderQuery {
  recursive?: 'false' | 'true';
}

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: FolderTreeResponse }>(
    '/api/folders/tree',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: folderTreeResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderTreeResponse(await app.libraryService.listFolders(getUserId(request))),
  );

  app.get<{ Reply: FolderResponse }>(
    '/api/folders/root',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: folderResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderResponse(
        await app.libraryService.getRootFolder(getUserId(request)),
      ),
  );

  app.post<{ Body: CreateFolderBody; Reply: FolderResponse }>(
    '/api/folders',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            name: { minLength: 1, type: 'string' },
            parentFolderId: { type: 'string' },
          },
          required: ['name', 'parentFolderId'],
          type: 'object',
        },
        response: {
          201: folderResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const folder = await app.libraryService.createFolder(getUserId(request), {
        name: request.body.name,
        parentFolderId: request.body.parentFolderId,
      });

      reply.code(201);
      return toFolderResponse(folder);
    },
  );

  app.get<{ Params: FolderParams; Reply: FolderResponse }>(
    '/api/folders/:folderId',
    {
      preHandler: app.authenticate,
      schema: {
        params: folderParamsSchema,
        response: {
          200: folderResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderResponse(
        await app.libraryService.getFolder(
          getUserId(request),
          request.params.folderId,
        ),
      ),
  );

  app.get<{ Params: FolderParams; Reply: FolderEntriesResponse }>(
    '/api/folders/:folderId/entries',
    {
      preHandler: app.authenticate,
      schema: {
        params: folderParamsSchema,
        response: {
          200: folderEntriesResponseSchema,
        },
      },
    },
    async (request) => {
      const entries = await app.libraryService.getFolderEntries(
        getUserId(request),
        request.params.folderId,
      );

      return toFolderEntriesResponse(entries.folder, entries.folders, entries.files);
    },
  );

  app.patch<{ Body: UpdateFolderBody; Params: FolderParams; Reply: FolderResponse }>(
    '/api/folders/:folderId',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            name: { minLength: 1, type: 'string' },
            parentFolderId: { type: 'string' },
          },
          type: 'object',
        },
        params: folderParamsSchema,
        response: {
          200: folderResponseSchema,
        },
      },
    },
    async (request) => {
      const folder = await app.libraryService.updateFolder(
        getUserId(request),
        request.params.folderId,
        request.body,
      );

      return toFolderResponse(folder);
    },
  );

  app.delete<{ Params: FolderParams; Querystring: DeleteFolderQuery }>(
    '/api/folders/:folderId',
    {
      preHandler: app.authenticate,
      schema: {
        params: folderParamsSchema,
        querystring: {
          additionalProperties: false,
          properties: {
            recursive: {
              enum: ['false', 'true'],
              type: 'string',
            },
          },
          type: 'object',
        },
        response: {
          204: {
            type: 'null',
          },
        },
      },
    },
    async (request, reply) => {
      await app.libraryService.deleteFolder(
        getUserId(request),
        request.params.folderId,
        request.query.recursive === 'true',
      );
      reply.code(204);

      return reply.send();
    },
  );
}

function getUserId(request: FastifyRequest): string {
  if (request.auth === null) {
    throw new UnauthorizedError('Missing authenticated session.');
  }

  return request.auth.userId;
}
