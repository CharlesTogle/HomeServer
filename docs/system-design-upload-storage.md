# Upload, Storage, Compression, and Power Efficiency Design

## Status

Proposed design aligned to [README.md](/home/charles/Documents/Projects/HomeServer/README.md:1) and the repo contract in [AGENTS.md](/home/charles/Documents/Projects/HomeServer/AGENTS.md:1).

## Goals

1. A signed-in user can upload 5,000 images in one batch without exhausting memory, breaking auth, or leaving the system in an unrecoverable state.
2. The VPS stores files in a per-user directory tree that mirrors the logical folder hierarchy.
3. Image compression does not block uploads or destabilize the API.
4. The system favors low CPU, low RAM, and low disk churn.

## Constraints From The Repo

- Private-only app over Tailscale
- Fastify is the only backend boundary
- PostgreSQL stores users, sessions, folder metadata, and file metadata
- File bytes live on disk
- Uploads are `multipart/form-data`
- Uploads must stream to disk instead of buffering in memory
- Access tokens live only in memory on the frontend
- Refresh tokens live in `HttpOnly` cookies
- Public static filesystem exposure is not allowed

## Recommended Storage Root

Do not write into the Linux OS `/root` directory. Use a configurable storage root such as:

```text
/srv/homeserver/storage
```

Inside that root, store files like this:

```text
/srv/homeserver/storage
  /users
    /<user-id>
      /<folder-id-1>
        /<folder-id-2>
          /<file-id>.<ext>
      /_tmp
        /<upload-item-id>.part
```

Notes:

- `user-id` is the authenticated user UUID.
- Each folder directory name is the folder UUID, not the display name.
- File display names stay in PostgreSQL.
- Stored filenames should use the file UUID plus extension, not the user-supplied name.
- All stored paths in PostgreSQL must be relative to the configured storage root.

This keeps the physical layout stable when a user renames a folder or file. A folder rename only changes metadata. A folder move still requires a filesystem move, but that is an atomic `rename()` when it stays on the same filesystem.

## High-Level Architecture

### Components

1. `frontend/`
   - Maintains an upload queue in memory
   - Uses TanStack Query for upload mutations and folder refreshes
   - Uses Zustand only for client UI state and in-memory auth state

2. `backend/` Fastify API
   - Auth routes
   - Folder routes
   - Upload batch routes
   - File content routes
   - Compression job enqueueing

3. PostgreSQL
   - Users
   - Sessions
   - Folders
   - Files
   - Upload batches and items
   - Compression jobs

4. Filesystem
   - Per-user permanent storage tree
   - Per-user temporary upload directory

5. Background worker
   - Image derivative generation
   - Cleanup of stale temp files and stale upload rows
   - Optional integrity reconciliation

## Upload Design

### Core Rule

The API must never buffer an entire image in memory. Each upload request streams directly to a temp file on disk while the server computes metadata such as size and SHA-256.

### Why 5,000 Sequential Uploads Can Succeed

The system handles a 5,000-image batch by making each file independent:

- one file per request
- one temp file per request
- one short metadata transaction per file
- no long-lived database transaction across the whole batch
- no in-memory list of all file bytes

If upload number 3,742 fails, the first 3,741 completed files remain valid and the queue can resume from the failure point.

### Client Upload Strategy

Use an explicit upload batch model:

1. Client creates an upload batch for a target folder.
2. Client registers upload items with a client-generated idempotency key.
3. Client uploads files one by one by default.
4. Client may optionally raise concurrency to `2` or `3` for small files, but the safe default for a 5,000-image batch is `1`.

Recommended frontend behavior:

- Keep the queue in memory, not in `localStorage`.
- Show per-file status: queued, uploading, processing, complete, failed.
- Invalidate the folder listing after every `25` to `100` completed files, not after every file.
- Refresh the active folder immediately when the batch completes.

This avoids turning TanStack Query into a high-frequency invalidation loop during large batches.

### Server Upload Flow

Per file:

1. Authenticate request once at request start.
2. Validate that the target folder belongs to the authenticated user.
3. Reserve a `file_id` and an `upload_item_id` in PostgreSQL with status `uploading`.
4. Stream the multipart file to:
   ```text
   /srv/homeserver/storage/users/<user-id>/_tmp/<upload-item-id>.part
   ```
5. While streaming, compute:
   - byte size
   - mime type
   - SHA-256
6. Ensure the final folder path exists.
7. Atomically `rename()` the temp file to the final path.
8. Update the file row to `ready`.
9. Enqueue a compression job if the file is an image type we support.

### Why Reserve The File Row First

The filesystem and PostgreSQL cannot share a real transaction. The safest pattern is:

- create a metadata row first
- write temp file
- move temp file into place
- mark row `ready`

If the process crashes mid-upload, the row is stuck in `uploading` and the temp file remains in `_tmp`. A cleanup worker can safely mark it `failed` and delete the temp file later.

### Authentication Behavior During Long Batches

Access tokens will expire during a 5,000-file batch. That is expected.

Design rule:

- token validation happens before the file stream begins
- an upload already in progress is not interrupted because the token lifetime crosses zero during the stream
- the next upload request may receive `401`, trigger refresh, receive a new access token, and retry

This is compatible with the repo’s in-memory access token model.

### Concurrency And Backpressure

Support concurrent users, but keep hard limits:

- Per browser batch default concurrency: `1`
- Per user API upload concurrency limit: `2`
- Global API upload concurrency limit per app instance: `min(2 * CPU cores, 8)`

When limits are exceeded:

- reject with `429 Too Many Requests`
- include `Retry-After`
- keep queue state on the client and retry later

This prevents the VPS from accepting more active file streams than it can flush to disk.

### Fastify Route Shape

Recommended resource model:

- `POST /api/upload-batches`
- `POST /api/upload-batches/:batchId/items`
- `POST /api/upload-items/:itemId/content`
- `GET /api/upload-batches/:batchId`

This is better than sending one giant multipart request containing thousands of files because it gives:

- better failure isolation
- easier retries
- cleaner auth refresh behavior
- accurate progress reporting

## Folder And Filesystem Design

### Source Of Truth

PostgreSQL is the source of truth for:

- user ownership
- folder hierarchy
- display names
- file metadata
- upload status

The filesystem mirrors the DB structure and stores the file bytes.

### Folder Creation

When a folder is created:

1. insert folder row with `id`, `user_id`, `parent_folder_id`, and `display_name`
2. derive the physical path from the folder’s parent chain
3. create the directory on disk
4. store the relative folder path in the folder row

Do not accept raw path strings from the client. The client sends only a `parentFolderId` and a display name. The server computes the real filesystem path from trusted metadata.

### Folder Path Example

Logical hierarchy:

```text
user-1
  photos
    2026
      trip
```

Physical hierarchy:

```text
/srv/homeserver/storage/users/user-1/folder-a/folder-b/folder-c
```

Database:

- `folder-a.display_name = "photos"`
- `folder-b.display_name = "2026"`
- `folder-c.display_name = "trip"`

### File Path Example

```text
/srv/homeserver/storage/users/user-1/folder-a/folder-b/folder-c/file-9f8d.jpg
```

Database:

- `files.id = file-9f8d`
- `files.original_name = IMG_1934.JPG`
- `files.storage_rel_path = users/user-1/folder-a/folder-b/folder-c/file-9f8d.jpg`

## Database Model

### Tables

Recommended core tables:

- `users`
- `sessions`
- `folders`
- `files`
- `upload_batches`
- `upload_items`
- `file_derivatives`
- `media_jobs`

### Key Columns

`folders`

- `id uuid primary key`
- `user_id uuid not null`
- `parent_folder_id uuid null`
- `display_name text not null`
- `storage_rel_path text not null`
- `created_at timestamptz not null`

`files`

- `id uuid primary key`
- `user_id uuid not null`
- `folder_id uuid not null`
- `original_name text not null`
- `stored_extension text null`
- `mime_type text not null`
- `size_bytes bigint not null`
- `sha256 text not null`
- `storage_rel_path text not null`
- `status text not null`
- `created_at timestamptz not null`

`upload_batches`

- `id uuid primary key`
- `user_id uuid not null`
- `folder_id uuid not null`
- `status text not null`
- `expected_count integer null`
- `completed_count integer not null`
- `failed_count integer not null`
- `created_at timestamptz not null`
- `completed_at timestamptz null`

`upload_items`

- `id uuid primary key`
- `batch_id uuid not null`
- `user_id uuid not null`
- `client_idempotency_key text not null`
- `original_name text not null`
- `status text not null`
- `error_code text null`
- `created_at timestamptz not null`

`file_derivatives`

- `id uuid primary key`
- `file_id uuid not null`
- `kind text not null`
- `mime_type text not null`
- `size_bytes bigint not null`
- `storage_rel_path text not null`
- `status text not null`

`media_jobs`

- `id uuid primary key`
- `file_id uuid not null`
- `job_type text not null`
- `status text not null`
- `attempt_count integer not null`
- `scheduled_at timestamptz not null`
- `started_at timestamptz null`
- `finished_at timestamptz null`

### Important Indexes

- `folders (user_id, parent_folder_id)`
- `files (user_id, folder_id, created_at desc)`
- `files (user_id, sha256)`
- `upload_items (batch_id, status)`
- `media_jobs (status, scheduled_at)`

### Optional Idempotency Rule

Add a unique constraint:

```text
(user_id, client_idempotency_key)
```

This lets the client safely retry a failed upload item creation without duplicating metadata.

## Compression Design

### Scope

For v1, compression should mean image derivatives, not destructive replacement of the original file and not video transcoding.

Recommended rule:

- keep the original file exactly as uploaded
- generate low-cost derivatives for browsing
- never block upload completion on compression

### Why Compression Must Be Asynchronous

If the API compresses each image inline while the request is open, a 5,000-image batch will become CPU-bound instead of I/O-bound. That is the fastest way to make uploads fragile on a small VPS.

### Recommended Derivatives

For supported image types such as JPEG, PNG, WebP, and HEIC:

- `thumbnail`
  - max width/height: `256px`
  - format: `webp`
- `preview`
  - max width/height: `1600px`
  - format: `webp` or `jpeg`

Keep the original file for full-resolution download and archival viewing.

### Compression Worker Rules

- run in a separate worker process, not inside the request handler
- process only `1` image at a time by default on a small VPS
- skip compression while the same user still has an active upload batch
- retry failed jobs with capped backoff
- cap job attempts
- mark derivative status clearly: queued, processing, ready, failed

### What Not To Compress

Do not blindly recompress:

- GIF animations
- already-small PNG icons
- video files in v1
- audio files in v1

These often waste CPU for little or no meaningful space savings.

### Lazy Versus Eager Derivatives

Preferred default:

- enqueue `thumbnail` generation after upload
- defer `preview` generation until first open if CPU is limited

This reduces wasted work for files that are uploaded but never viewed.

## Power Efficiency Approach

### 1. Keep Uploads I/O-Bound

- stream upload directly to disk
- compute hash during the stream
- avoid second-pass reads
- do not compress inline

### 2. Bound Concurrency Hard

- low upload concurrency per user
- low global concurrency on the API
- low worker concurrency for compression

Low concurrency is the main power-efficiency feature on a small VPS because it avoids CPU spikes, disk seek storms, and memory pressure.

### 3. Use Low-Priority Worker Scheduling

Run the compression worker as a separate service with lower CPU and I/O priority than the API.

Example systemd intent:

- `Nice=10`
- `IOSchedulingClass=idle`
- `CPUWeight=20`
- `IOWeight=20`

The API stays responsive while derivatives are built in the background.

### 4. Avoid Wasteful Network And UI Churn

- use thumbnails for grid views instead of full originals
- do not refetch the full folder listing after every uploaded file
- set reasonable TanStack Query `staleTime` values for browsing screens
- use keep-alive connections

### 5. Keep Postgres Small And Predictable

- use a modest connection pool
- avoid one transaction spanning many files
- store only necessary metadata
- update counters incrementally instead of running repeated heavy count queries

### 6. Reduce Disk Churn

- write temp files on the same filesystem as final storage so `rename()` is atomic
- clean stale temp files on a schedule
- mount the storage volume with `noatime` if operationally acceptable

Do not place temp uploads in RAM-backed storage for large batches.

## Failure Handling

### Stale Upload Cleanup

A background cleanup job should:

- find `upload_items` stuck in `uploading` beyond a timeout
- delete their `.part` files
- mark them `failed`

### Reconciliation

Add a periodic reconcile job that can detect:

- DB row says `ready` but file missing on disk
- temp file exists but upload row is `failed`
- derivative row exists but derivative file is missing

This is important because the filesystem and database cannot be updated atomically together.

### Safe Logging

Log:

- `userId`
- `folderId`
- `fileId`
- `uploadItemId`
- `batchId`
- status transitions

Do not log:

- tokens
- cookies
- raw auth headers
- absolute sensitive filesystem paths

## API And Worker Capacity Recommendation

For a small single VPS:

- API process handles authenticated uploads and reads
- one compression worker process
- PostgreSQL on the same box is acceptable for v1

Reasonable initial limits:

- upload file size limit: set by product policy
- client concurrency: `1`
- per-user API concurrency: `2`
- global API upload concurrency: `4` to `8`
- compression worker concurrency: `1`

Start conservatively, measure, then raise only if the box stays stable.

## Recommended Implementation Order

1. Implement folders and file metadata tables.
2. Implement per-user directory creation under a configurable storage root.
3. Implement upload batch and upload item APIs.
4. Implement streaming upload to temp file plus atomic finalize.
5. Implement cleanup for stale temp files and stale upload rows.
6. Implement folder listing and file reads.
7. Implement background thumbnail generation.
8. Add preview derivatives only if the VPS still has headroom.

## Final Recommendation

The design should optimize for durability and bounded resource usage, not raw upload speed.

The safest shape for this repo is:

- one-file-per-request uploads
- per-user folder tree on disk under a configurable storage root
- PostgreSQL as metadata source of truth
- atomic temp-to-final file moves
- async image derivative generation
- strict concurrency limits and low-priority background work

That design will comfortably handle a user uploading 5,000 images in sequence on a modest VPS without violating the repo’s Fastify, PostgreSQL, and private-only constraints.
