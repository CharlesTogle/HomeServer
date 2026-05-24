# HomeServer Backend Standards Audit

**Date:** 2026-05-24
**Scope:** `backend/` tracked source, Prisma schema/migrations, and `backend/test/`, audited against `/home/charles/.claude/home-files/experiences.md`, `~/Documents/Standards/FastifyJS-Coding-Standards.md`, plus repo-local `AGENTS.md` and `README.md`

---

## Overall Score

| Category | ERRORs | WARNINGs |
|----------|--------|----------|
| Security | 0 | 0 |
| Data Integrity | 1 | 0 |
| Performance | 0 | 1 |
| Code Quality | 0 | 1 |
| Error Handling | 0 | 0 |
| API Design | 1 | 1 |
| Concurrency | 1 | 0 |
| Testing | 0 | 1 |
| DevOps | 1 | 0 |
| **Total** | **4** | **4** |

---

## CRITICAL — Must Fix Before Any Deployment

No CRITICAL backend findings were fully proven in the current source sweep.

---

## HIGH — Must Fix Before Relying On This Backend

### 1. `backend/src/utils/env.ts` + plugin chain — backend can boot in a non-durable fallback mode instead of failing fast

**Severity:** ERROR — DevOps  
**Files:** `backend/src/utils/env.ts:18-22`, `backend/src/plugins/database-plugin.ts:7-16`, `backend/src/plugins/services-plugin.ts:18-39`

`DATABASE_URL` is optional, so the backend silently falls back to `mode: 'memory'` and swaps in `InMemoryHomeServerStore` when the DB URL is missing. The same config loader also ships a known default auth secret.

```ts
DATABASE_URL: z.string().min(1).optional(),
AUTH_TOKEN_SECRET: z.string().min(1).default('homeserver-dev-secret-change-me')

if (config.databaseUrl === undefined) {
  app.decorate('database', { mode: 'memory' })
  app.decorate('prisma', null)
  return
}
```

This violates the repo contract that metadata and sessions live in PostgreSQL. One bad deploy env can pass `/health` while keeping users, sessions, folders, files, and upload state only in RAM. After restart, metadata disappears while bytes already written to disk remain behind. The default secret increases the blast radius of that misconfiguration.

**Fix:** Fail startup when `DATABASE_URL` or `AUTH_TOKEN_SECRET` are missing outside tests. If memory mode is needed for local tests, gate it behind an explicit test-only flag instead of treating it as a normal runtime mode.

---

### 2. Prisma write paths mutate the filesystem before the database state is durably safe

**Severity:** ERROR — Data Integrity  
**Files:** `backend/src/services/prisma-library-service.ts:92-105`, `backend/src/services/prisma-library-service.ts:176-185`, `backend/src/services/prisma-library-service.ts:214-271`, `backend/src/services/prisma-library-service.ts:467-486`, `backend/src/services/prisma-library-service.ts:540-592`, `backend/src/services/prisma-library-service.ts:673-729`, `backend/src/services/prisma-auth-service.ts:145-155`, `backend/src/services/prisma-auth-service.ts:225-248`

Multiple code paths change disk state before the backing DB writes are guaranteed:

- `createFolder()` creates the directory before `folder.create()`.
- `deleteFile()` unlinks bytes before `file.delete()`.
- `deleteFolder()` removes the storage tree before the delete transaction runs.
- `updateFile()` and `updateFolder()` rename paths before DB metadata is updated.
- `uploadItemContent()` renames the temp file into its final location before the Prisma transaction creates the file row and completes the upload item.
- `register()` creates the user, root folder, and session across separate operations.

```ts
await rename(
  tempAbsolutePath,
  this.resolveAbsolutePath(finalStorageRelPath),
)

const fileRecord = await this.prisma.$transaction(async (tx) => {
  const createdFile = await tx.file.create({ ... })
  await tx.uploadItem.update({ ... })
  await this.refreshBatchStatus(batch.id, tx)
  return createdFile
})
```

If the DB operation fails after the filesystem move/delete succeeds, the backend leaves orphaned files/directories, rows pointing at missing bytes, or partially created accounts without the expected library/session state.

**Fix:** Treat DB state as the durable source of truth. Keep uploads in temp locations until the DB transaction succeeds, add compensating cleanup for final paths on failure, and wrap multi-step auth/library writes in transactions with explicit filesystem rollback behavior.

---

### 3. The backend is implemented for MariaDB/MySQL even though the repo contract requires PostgreSQL

**Severity:** ERROR — API Design  
**Files:** `backend/package.json:19-25`, `backend/src/plugins/database-plugin.ts:2-20`, `backend/prisma/schema.prisma:4-6`, `backend/schema.sql:1-161`, `backend/prisma/migrations/20260524070000_init/migration.sql:1-168`

The repo README and `AGENTS.md` set PostgreSQL as the persistence contract. The backend currently uses `@prisma/adapter-mariadb`, `provider = "mysql"`, and MySQL/MariaDB-flavored schema and migration files.

This is not just a cosmetic mismatch. It changes collation behavior, migration tooling, operational expectations, and future query semantics. It also means future agents will build against the wrong persistence boundary even if they follow the repo-local rules.

**Fix:** Move the Prisma datasource, driver adapter, schema, and migrations to PostgreSQL now, before more route and frontend code is built against the wrong DB stack.

---

### 4. Upload idempotency is not atomic in the Prisma path, so concurrent retries can duplicate work

**Severity:** ERROR — Concurrency  
**Files:** `backend/src/services/prisma-library-service.ts:147-173`, `backend/src/services/prisma-library-service.ts:619-709`

`createUploadItem()` does a read-then-create around the unique idempotency key, and `uploadItemContent()` does a read-then-update around the `uploading` status. Two concurrent requests can both pass the read step before either write becomes visible.

- On item creation, one request can succeed while the other throws a raw unique-constraint failure instead of returning the existing item.
- On content upload, two requests can both claim the same pending item and create multiple file rows for one logical upload.

This breaks the repo's idempotent upload intent precisely when a client retries or double-submits.

**Fix:** Use conditional updates or transactions to claim an upload item exactly once. Catch unique-key conflicts on `createUploadItem()` and return the already-created row rather than surfacing a 500.

---

## MEDIUM — Should Fix Soon

### 5. Recursive folder operations use proven N+1 query patterns and per-row updates

**Severity:** WARNING — Performance  
**Files:** `backend/src/services/prisma-library-service.ts:529-579`, `backend/src/services/prisma-library-service.ts:773-803`

`getDescendantFolders()` issues one `findMany()` per visited folder, then `updateFolder()` loops over descendants and files with one `update()` call each inside a transaction.

This is a classic `1 base operation + N child queries/updates` shape. Large folder trees will make move/delete operations slower and keep transactions open longer than necessary.

**Fix:** Replace recursive per-folder reads with a set-based descendant query strategy, then batch updates/deletes rather than updating one row at a time inside the transaction.

---

### 6. The automated tests only validate the in-memory backend path

**Severity:** WARNING — Testing  
**Files:** `backend/test/support/app.ts:31-43`, `backend/test/auth-routes.test.ts:7-49`, `backend/test/library-routes.test.ts:24-140`

The route tests are well-shaped around `inject()`, but the harness explicitly deletes `DATABASE_URL`, so every test runs against `InMemoryHomeServerStore`.

That means the Prisma persistence path is not being exercised for:

- transaction boundaries
- filesystem/DB divergence behavior
- DB-specific uniqueness/collation behavior
- concurrency and retry edge cases

**Fix:** Add a second integration suite that boots the real Prisma-backed app against a disposable test database and runs the same auth/upload/library flows through `inject()`.

---

## LOW — Cleanup And Contract Tightening

### 7. Many parameterized routes do not declare `params` schemas

**Severity:** WARNING — API Design  
**Files:** `backend/src/routes/folder-routes.ts:80-180`, `backend/src/routes/file-routes.ts:51-161`, `backend/src/routes/upload-routes.ts:68-143`

The Fastify standard in this audit requires params/query/body schemas for every route as applicable. Several routes define body/query/response schemas but leave `:folderId`, `:fileId`, `:batchId`, and `:itemId` untyped at the HTTP boundary.

This weakens the contract and pushes malformed identifier handling down into the service layer instead of rejecting bad requests consistently during Fastify validation.

**Fix:** Add explicit `params` schemas to every route with path variables and keep the same `additionalProperties: false` discipline used on bodies/querystrings.

---

### 8. Shared backend concerns are plain functions, not registered Fastify plugins with explicit plugin boundaries

**Severity:** WARNING — Code Quality  
**Files:** `backend/src/app.ts:50-53`, `backend/src/plugins/index.ts:9-15`, `backend/src/plugins/auth-plugin.ts:5-19`, `backend/src/plugins/database-plugin.ts:7-31`, `backend/src/plugins/services-plugin.ts:10-39`, `backend/src/plugins/storage-plugin.ts:8-12`

The Fastify standard in this audit treats plugin registration as the framework's core contract. Here, shared concerns are invoked directly as functions against the root app rather than being registered as real Fastify plugins, and the external multipart plugin is loaded inside that custom chain instead of through a clearly declared external-plugins-first registration pass.

The current code works, but it gives up Fastify's normal encapsulation and makes future growth harder to reason about.

**Fix:** Convert shared infrastructure to actual Fastify plugins, register them through `app.register()`, and keep the order explicit: external plugins, custom shared plugins, decorators/hooks, then routes.

---

## Files With Zero Violations

- `backend/src/routes/health-routes.ts`
- `backend/src/utils/cookies.ts`
- `backend/src/utils/http-errors.ts`
- `backend/src/utils/logger.ts`
- `backend/src/utils/storage-paths.ts`
- `backend/test/health-routes.test.ts`
- `backend/test/faker-support.test.ts`

---

## Things that we're done correctly

- `backend/src/utils/logger.ts:3-25` redacts `authorization`, `cookie`, and password fields instead of logging them raw.
- `backend/src/utils/cookies.ts:41-63` keeps the refresh token in an `HttpOnly` cookie with explicit `Path`, `SameSite`, and `Secure` handling instead of readable browser storage.
- `backend/src/routes/file-routes.ts:75-110` streams file reads and supports byte-range responses rather than buffering whole media files in memory.
- `backend/src/utils/storage-paths.ts:26-64` rejects empty names, reserved names, path separators, and storage-root escapes before touching the filesystem.
- `backend/test/auth-routes.test.ts:7-49`, `backend/test/library-routes.test.ts:24-140`, and `backend/test/health-routes.test.ts:6-20` use `app.inject()` and close/clean up the app correctly instead of spinning up external HTTP for normal route tests.

---

## Priority Fix Roadmap

1. Remove the silent memory fallback and require explicit, validated production secrets and DB config at startup.
2. Align the backend with the repo contract by migrating the persistence layer from MariaDB/MySQL to PostgreSQL.
3. Rework Prisma file/folder/upload/auth write flows so disk and DB cannot commit independently.
4. Make upload item creation and upload processing atomic under concurrent retries.
5. Add Prisma-backed `inject()` integration tests that cover auth refresh, upload, move/delete, and failure rollback paths.
6. Tighten Fastify contracts by adding params schemas and converting shared infrastructure into real plugins.

---

Generated on 2026-05-24. Heuristic N+1 analysis included: yes. Local verification run: `pnpm test` passed and `pnpm typecheck` completed cleanly in `backend/`.
