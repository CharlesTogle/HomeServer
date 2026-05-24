# HomeServer

`HomeServer` is a small self-hosted file server for private media storage and browsing.

This repository is intended to become a monorepo with:

- a private React + Vite application for authenticated management
- a Fastify API running on the Ubuntu VPS
- Zustand as the frontend client-state layer
- TanStack Query as the frontend data-fetching layer
- a PostgreSQL database for auth/session/file metadata

## Repository Status

The repository is currently at the definition stage. This README is the current source-of-truth description that future agents should compare against before scaffolding or implementing features.

## Product Goal

Build a minimal private file server that runs on an Ubuntu VPS and is accessed over Tailscale.

The first milestone is intentionally narrow:

1. Authentication with short-lived access tokens and long-lived refresh tokens
2. Multipart file upload from React frontends to the Fastify backend
3. File and media reading with nested folder browsing

## Core Architecture

### Deployment Surfaces

- `frontend/`: React + Vite app for signed-in private use
- `backend/`: Fastify backend for auth, upload, folder listing, and media delivery

### Network Model

- The Ubuntu VPS hosts the private web app and the Fastify API on separate ports.
- Tailscale is the default trust boundary for private/admin access.
- Port numbers are configuration details. The example `:3000` and `:5173` split is acceptable, but the exact assignment should be environment-driven.

### Storage Model

- PostgreSQL stores users, sessions, folder metadata, and file metadata.
- File bytes live on the VPS filesystem.
- React frontends never touch the filesystem directly; all reads and writes go through Fastify.

## Authentication Contract

Authentication should follow this model exactly:

- Access tokens are short-lived and stored only in application memory.
- Refresh tokens are long-lived and stored in `HttpOnly` cookies.
- When an access token expires, the backend uses the refresh token to issue a new access token.
- The frontend must not persist access tokens in `localStorage`, `sessionStorage`, or non-`HttpOnly` cookies.

Expected flow:

1. Login returns a short-lived access token in the response body and sets a refresh token cookie.
2. The frontend keeps the access token in memory only.
3. Authenticated API calls send the access token.
4. When the access token expires, the frontend calls a refresh endpoint with credentials included.
5. The backend validates the refresh token, refreshes the session, and returns a new access token.
6. Logout invalidates the refresh session and clears the cookie.

## Upload Contract

Upload behavior should follow these rules:

- Uploads use `multipart/form-data`.
- The browser sends files directly to Fastify.
- Fastify must stream uploads to disk instead of buffering large files in memory.
- Each uploaded file must create or update corresponding metadata in PostgreSQL.
- Uploads should support placing files into nested folders.

## Read Contract

The read side must support:

- nested folder viewing
- folder listing and navigation
- image rendering
- music playback
- video playback

Backend expectations:

- Folder and file metadata comes from PostgreSQL.
- Media endpoints should support streaming semantics appropriate for browsers, including byte ranges for audio/video.
- File access should be controlled through Fastify authorization rules, not direct static filesystem exposure.

Frontend expectations:

- The private frontend should present folder browsing and management UX.
- Lucide React and ShadCN are the default component/UI primitives.

## Frontend State And Data Layer

React frontends should use Zustand for client-owned state and TanStack Query for backend state.

- `frontend/` should use Zustand for client-owned state such as in-memory auth session state, UI state, and other cross-component client state.
- Zustand should not be used as a cache for backend-owned file listings, folder data, or other server data.
- `frontend/` should use TanStack Query for all server reads and writes.
- Components should not scatter raw backend `fetch` calls throughout the UI.
- Queries and mutations should be wrapped in dedicated API modules or hooks.
- Auth refresh behavior should integrate with a shared request layer so expired access tokens can be refreshed and the original request retried cleanly.
- Query keys should be stable and predictable so folder listings, file metadata, and auth-dependent views invalidate correctly.

## Proposed Repository Shape

This is the current preferred repository structure:

```text
backend/          # Fastify backend
frontend/         # React + Vite private UI
packages/
  db/             # database schema, migrations, query layer
  shared/         # shared types/contracts/constants
  ui/             # shared ShadCN wrappers or common UI primitives if needed
docs/             # architecture notes and future specs
storage/          # local file bytes on VPS, gitignored
```

## Agent Guardrails

Future agents should preserve these constraints:

- Treat Fastify as the single backend boundary.
- Keep private/admin behavior behind Tailscale.
- Do not persist access tokens outside in-memory client state.
- Use Zustand for client-owned frontend state and TanStack Query for backend state.
- Do not bypass TanStack Query for normal frontend-to-backend calls.
- Keep file metadata in PostgreSQL and file contents on disk.
- Prefer simple, direct implementations over premature abstractions.

## Explicit Assumptions

These assumptions are being made from the current requirements:

- "Fastify for the Frontend" is interpreted as "Fastify for the backend/API".
- The `frontend/` React app and `backend/` Fastify API run on the same VPS on different ports.
- This is a single-server, single-database, filesystem-backed v1.

## Non-Goals For V1

The first version does not need:

- object storage such as S3
- transcoding pipelines
- background media processing
- advanced multi-user permissions
- external sharing flows
- public filesystem exposure
- long-term offline token storage in the browser

## Definition Of Success

The initial repository should be considered aligned when it provides:

- a private authenticated UI over Tailscale
- a Fastify API that owns auth, upload, listing, and media reads
- PostgreSQL-backed metadata and session persistence
- direct multipart upload from browser to backend
- folder navigation and media playback for stored files
