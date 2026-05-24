import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { UnauthorizedError } from './http-errors.js';

const scryptAsync = promisify(scrypt);
const ACCESS_TOKEN_PREFIX = 'hs1';

export interface AccessTokenPayload {
  email: string;
  exp: number;
  sessionId: string;
  userId: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString(
    'base64url',
  )}`;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueAccessToken(
  payload: AccessTokenPayload,
  secret: string,
): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = sign(encodedPayload, secret);

  return `${ACCESS_TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

export function issueRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function verifyPassword(
  password: string,
  storedPasswordHash: string,
): Promise<boolean> {
  const [algorithm, rawSalt, rawHash] = storedPasswordHash.split('$');

  if (algorithm !== 'scrypt' || rawSalt === undefined || rawHash === undefined) {
    return false;
  }

  const salt = Buffer.from(rawSalt, 'base64url');
  const expectedHash = Buffer.from(rawHash, 'base64url');
  const derivedKey = (await scryptAsync(password, salt, expectedHash.length)) as Buffer;

  return timingSafeEqual(derivedKey, expectedHash);
}

export function verifyAccessToken(
  accessToken: string,
  secret: string,
): AccessTokenPayload {
  const [prefix, rawPayload, rawSignature] = accessToken.split('.');

  if (
    prefix !== ACCESS_TOKEN_PREFIX ||
    rawPayload === undefined ||
    rawSignature === undefined
  ) {
    throw new UnauthorizedError('Invalid access token.');
  }

  const expectedSignature = sign(rawPayload, secret);

  if (!safeCompare(rawSignature, expectedSignature)) {
    throw new UnauthorizedError('Invalid access token.');
  }

  const parsedPayload = JSON.parse(
    Buffer.from(rawPayload, 'base64url').toString('utf8'),
  ) as Partial<AccessTokenPayload>;

  if (
    typeof parsedPayload.email !== 'string' ||
    typeof parsedPayload.exp !== 'number' ||
    typeof parsedPayload.sessionId !== 'string' ||
    typeof parsedPayload.userId !== 'string'
  ) {
    throw new UnauthorizedError('Invalid access token.');
  }

  if (parsedPayload.exp <= Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedError('Access token expired.');
  }

  return {
    email: parsedPayload.email,
    exp: parsedPayload.exp,
    sessionId: parsedPayload.sessionId,
    userId: parsedPayload.userId,
  };
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
