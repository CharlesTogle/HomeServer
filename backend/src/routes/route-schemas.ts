export const userResponseSchema = {
  additionalProperties: false,
  properties: {
    email: { type: 'string' },
    id: { type: 'string' },
  },
  required: ['email', 'id'],
  type: 'object',
} as const;

export const authResponseSchema = {
  additionalProperties: false,
  properties: {
    accessToken: { type: 'string' },
    user: userResponseSchema,
  },
  required: ['accessToken', 'user'],
  type: 'object',
} as const;

export const folderResponseSchema = {
  additionalProperties: false,
  properties: {
    createdAt: { type: 'string' },
    id: { type: 'string' },
    isRoot: { type: 'boolean' },
    name: { type: 'string' },
    parentFolderId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    updatedAt: { type: 'string' },
  },
  required: ['createdAt', 'id', 'isRoot', 'name', 'parentFolderId', 'updatedAt'],
  type: 'object',
} as const;

export const fileResponseSchema = {
  additionalProperties: false,
  properties: {
    contentUrl: { type: 'string' },
    createdAt: { type: 'string' },
    folderId: { type: 'string' },
    id: { type: 'string' },
    mimeType: { type: 'string' },
    name: { type: 'string' },
    originalName: { type: 'string' },
    sizeBytes: { type: 'number' },
    status: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: [
    'contentUrl',
    'createdAt',
    'folderId',
    'id',
    'mimeType',
    'name',
    'originalName',
    'sizeBytes',
    'status',
    'updatedAt',
  ],
  type: 'object',
} as const;

export const folderEntriesResponseSchema = {
  additionalProperties: false,
  properties: {
    files: {
      items: fileResponseSchema,
      type: 'array',
    },
    folder: folderResponseSchema,
    folders: {
      items: folderResponseSchema,
      type: 'array',
    },
  },
  required: ['files', 'folder', 'folders'],
  type: 'object',
} as const;

export const uploadItemResponseSchema = {
  additionalProperties: false,
  properties: {
    batchId: { type: 'string' },
    createdAt: { type: 'string' },
    errorCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    fileId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    id: { type: 'string' },
    originalName: { type: 'string' },
    status: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: [
    'batchId',
    'createdAt',
    'errorCode',
    'fileId',
    'id',
    'originalName',
    'status',
    'updatedAt',
  ],
  type: 'object',
} as const;

export const uploadBatchResponseSchema = {
  additionalProperties: false,
  properties: {
    completedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    completedCount: { type: 'number' },
    createdAt: { type: 'string' },
    expectedCount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    failedCount: { type: 'number' },
    folderId: { type: 'string' },
    id: { type: 'string' },
    items: {
      items: uploadItemResponseSchema,
      type: 'array',
    },
    status: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: [
    'completedAt',
    'completedCount',
    'createdAt',
    'expectedCount',
    'failedCount',
    'folderId',
    'id',
    'items',
    'status',
    'updatedAt',
  ],
  type: 'object',
} as const;
