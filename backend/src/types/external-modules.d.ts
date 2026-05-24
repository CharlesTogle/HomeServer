declare module 'multer' {
  export class MulterError extends Error {
    public readonly code: string;
    public readonly field?: string;

    public constructor(code: string, field?: string);
  }
}

declare module 'pg' {
  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResult<T = QueryResultRow> {
    rowCount: number | null;
    rows: T[];
  }

  export interface PoolClient {
    query<T = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<T>>;
    release(): void;
  }

  export interface Pool {
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    query<T = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<T>>;
  }

  export class Pool {
    public constructor(options?: { connectionString?: string });
  }
}
