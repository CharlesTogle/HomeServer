declare module 'multer' {
  export class MulterError extends Error {
    public readonly code: string;
    public readonly field?: string;

    public constructor(code: string, field?: string);
  }
}
