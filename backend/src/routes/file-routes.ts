import { createReadStream } from 'node:fs';

import { type FastifyInstance, type FastifyRequest } from 'fastify';

import { toFileResponse, type FileResponse } from '../types/api.js';
import { BadRequestError, UnauthorizedError } from '../utils/http-errors.js';
import { fileParamsSchema, fileResponseSchema } from './route-schemas.js';

interface FileParams {
  fileId: string;
}

interface FilesQuerystring {
  folderId: string;
}

interface UpdateFileBody {
  folderId?: string;
  name?: string;
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: FilesQuerystring; Reply: FileResponse[] }>(
    '/api/files',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: {
          additionalProperties: false,
          properties: {
            folderId: { type: 'string' },
          },
          required: ['folderId'],
          type: 'object',
        },
        response: {
          200: {
            items: fileResponseSchema,
            type: 'array',
          },
        },
      },
    },
    async (request) =>
      (await app.libraryService.getFilesInFolder(
        getUserId(request),
        request.query.folderId,
      )).map(toFileResponse),
  );

  app.get<{ Params: FileParams; Reply: FileResponse }>(
    '/api/files/:fileId',
    {
      preHandler: app.authenticate,
      schema: {
        params: fileParamsSchema,
        response: {
          200: fileResponseSchema,
        },
      },
    },
    async (request) =>
      toFileResponse(
        await app.libraryService.getFile(
          getUserId(request),
          request.params.fileId,
        ),
      ),
  );

  app.get<{ Params: FileParams }>(
    '/api/files/:fileId/content',
    {
      preHandler: app.authenticate,
      schema: {
        params: fileParamsSchema,
      },
    },
    async (request, reply) => {
      const descriptor = await app.libraryService.getFileReadDescriptor(
        getUserId(request),
        request.params.fileId,
      );
      const rangeHeader = request.headers.range;

      reply.header('accept-ranges', 'bytes');
      reply.header('content-type', descriptor.file.mimeType);

      if (rangeHeader === undefined) {
        reply.header('content-length', descriptor.sizeBytes);

        return reply.send(createReadStream(descriptor.absolutePath));
      }

      const range = parseByteRange(rangeHeader, descriptor.sizeBytes);

      if (range === null) {
        reply.header('content-range', `bytes */${descriptor.sizeBytes}`);
        throw new BadRequestError('Invalid range header.');
      }

      reply.code(206);
      reply.header('content-length', range.end - range.start + 1);
      reply.header(
        'content-range',
        `bytes ${range.start}-${range.end}/${descriptor.sizeBytes}`,
      );

      return reply.send(
        createReadStream(descriptor.absolutePath, {
          end: range.end,
          start: range.start,
        }),
      );
    },
  );

  app.patch<{ Body: UpdateFileBody; Params: FileParams; Reply: FileResponse }>(
    '/api/files/:fileId',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            folderId: { type: 'string' },
            name: { minLength: 1, type: 'string' },
          },
          type: 'object',
        },
        params: fileParamsSchema,
        response: {
          200: fileResponseSchema,
        },
      },
    },
    async (request) => {
      const file = await app.libraryService.updateFile(
        getUserId(request),
        request.params.fileId,
        request.body,
      );

      return toFileResponse(file);
    },
  );

  app.delete<{ Params: FileParams }>(
    '/api/files/:fileId',
    {
      preHandler: app.authenticate,
      schema: {
        params: fileParamsSchema,
        response: {
          204: {
            type: 'null',
          },
        },
      },
    },
    async (request, reply) => {
      await app.libraryService.deleteFile(getUserId(request), request.params.fileId);
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

function parseByteRange(
  rangeHeader: string,
  fileSize: number,
): { end: number; start: number } | null {
  const matches = /^bytes=(\d+)-(\d*)$/u.exec(rangeHeader);

  if (matches === null) {
    return null;
  }

  const start = Number(matches[1]);
  const end = matches[2] === '' ? fileSize - 1 : Number(matches[2]);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= fileSize
  ) {
    return null;
  }

  return {
    end,
    start,
  };
}
