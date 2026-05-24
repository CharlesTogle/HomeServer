import { type FastifyServerOptions } from 'fastify';

const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
] as const;

type FastifyLoggerOption = FastifyServerOptions['logger'];

export function getLoggerOptions(): FastifyLoggerOption {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    return {
      level: 'info',
      redact: [...REDACTED_LOG_PATHS],
    };
  }

  return {
    level: 'debug',
    redact: [...REDACTED_LOG_PATHS],
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    },
  };
}
