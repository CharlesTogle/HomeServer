import { type FastifyInstance, type FastifyRequest } from 'fastify';

import {
  toFileResponse,
  toUploadBatchResponse,
  toUploadItemResponse,
  type FileResponse,
  type UploadBatchResponse,
  type UploadItemResponse,
} from '../types/api.js';
import { UnauthorizedError } from '../utils/http-errors.js';
import {
  fileResponseSchema,
  uploadBatchParamsSchema,
  uploadBatchResponseSchema,
  uploadItemParamsSchema,
  uploadItemResponseSchema,
} from './route-schemas.js';

interface CreateUploadBatchBody {
  expectedCount?: number;
  folderId: string;
}

interface CreateUploadItemBody {
  clientIdempotencyKey: string;
  originalName: string;
}

interface UploadBatchParams {
  batchId: string;
}

interface UploadItemParams {
  itemId: string;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateUploadBatchBody; Reply: UploadBatchResponse }>(
    '/api/upload-batches',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            expectedCount: { minimum: 1, type: 'integer' },
            folderId: { type: 'string' },
          },
          required: ['folderId'],
          type: 'object',
        },
        response: {
          201: uploadBatchResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const batch = await app.libraryService.createUploadBatch(getUserId(request), {
        expectedCount: request.body.expectedCount,
        folderId: request.body.folderId,
      });

      reply.code(201);

      return toUploadBatchResponse(batch, []);
    },
  );

  app.get<{ Params: UploadBatchParams; Reply: UploadBatchResponse }>(
    '/api/upload-batches/:batchId',
    {
      preHandler: app.authenticate,
      schema: {
        params: uploadBatchParamsSchema,
        response: {
          200: uploadBatchResponseSchema,
        },
      },
    },
    async (request) => {
      const snapshot = await app.libraryService.getUploadBatch(
        getUserId(request),
        request.params.batchId,
      );

      return toUploadBatchResponse(snapshot.batch, snapshot.items);
    },
  );

  app.post<{ Body: CreateUploadItemBody; Params: UploadBatchParams; Reply: UploadItemResponse }>(
    '/api/upload-batches/:batchId/items',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            clientIdempotencyKey: { minLength: 1, type: 'string' },
            originalName: { minLength: 1, type: 'string' },
          },
          required: ['clientIdempotencyKey', 'originalName'],
          type: 'object',
        },
        params: uploadBatchParamsSchema,
        response: {
          201: uploadItemResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const uploadItem = await app.libraryService.createUploadItem(
        getUserId(request),
        request.params.batchId,
        request.body,
      );

      reply.code(201);

      return toUploadItemResponse(uploadItem);
    },
  );

  app.post<{ Params: UploadItemParams; Reply: FileResponse }>(
    '/api/upload-items/:itemId/content',
    {
      preHandler: app.authenticate,
      schema: {
        params: uploadItemParamsSchema,
        response: {
          201: fileResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const multipartFile = await request.file();
      const file = await app.libraryService.uploadItemContent(
        getUserId(request),
        request.params.itemId,
        multipartFile,
      );

      reply.code(201);

      return toFileResponse(file);
    },
  );
}

function getUserId(request: FastifyRequest): string {
  if (request.auth === null) {
    throw new UnauthorizedError('Missing authenticated session.');
  }

  return request.auth.userId;
}
