import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:password@127.0.0.1:5432/homeserver',
  },
  migrations: {
    path: 'prisma/migrations',
  },
  schema: 'prisma/schema.prisma',
});
