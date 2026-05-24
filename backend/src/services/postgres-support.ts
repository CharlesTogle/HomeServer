import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from 'pg';

export type PostgresDatabaseClient = Pool | PoolClient;

interface PostgresErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export async function withPostgresTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function isPostgresErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as PostgresErrorLike).code === code
  );
}

export function isUniqueConstraintViolation(
  error: unknown,
  constraintName?: string,
): boolean {
  if (!isPostgresErrorCode(error, '23505')) {
    return false;
  }

  if (constraintName === undefined) {
    return true;
  }

  return (
    typeof error === 'object' &&
    error !== null &&
    'constraint' in error &&
    (error as PostgresErrorLike).constraint === constraintName
  );
}

export async function queryOptionalRow<T>(
  client: PostgresDatabaseClient,
  sql: string,
  values: readonly unknown[],
): Promise<T | null> {
  const result: QueryResult<T> = await client.query<T>(sql, [...values]);

  return result.rows[0] ?? null;
}

export async function queryRequiredRow<T>(
  client: PostgresDatabaseClient,
  sql: string,
  values: readonly unknown[],
): Promise<T> {
  const row = await queryOptionalRow<T>(client, sql, values);

  if (row === null) {
    throw new Error('Expected query to return a row.');
  }

  return row;
}

export async function queryRows<T>(
  client: PostgresDatabaseClient,
  sql: string,
  values: readonly unknown[],
): Promise<T[]> {
  const result: QueryResult<T> = await client.query<T>(sql, [...values]);

  return result.rows;
}
