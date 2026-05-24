# HomeServer Experiences & Operating Contract

This file rewrites the repo rules in the same convention as `/home/charles/.claude/home-files/experiences.md` so future agents can scan and apply them the same way.

Use this file with [README.md](/home/charles/Documents/Projects/HomeServer/README.md:1). If a borrowed standard conflicts with this repo's auth model, deployment model, or product boundary, this file and the README win.

---

## Table of Contents

### Quick Reference
- [Pre-Implementation Checklist](#pre-implementation-checklist) — Apply before scaffolding or major edits
- [Verification Checklist](#verification-checklist) — Apply before handing work back

### Entries
1. [Preserve the Private-Only Product Boundary](#preserve-the-private-only-product-boundary) — Security
2. [Keep the Repository Shape and Stack Intentional](#keep-the-repository-shape-and-stack-intentional) — Code Quality
3. [Never Leak Secrets or Private Structure](#never-leak-secrets-or-private-structure) — Security
4. [Keep Types Concrete at Every Trust Boundary](#keep-types-concrete-at-every-trust-boundary) — API Design
5. [Use Zustand for Client State and TanStack Query for Server State](#use-zustand-for-client-state-and-tanstack-query-for-server-state) — Code Quality
6. [Preserve the In-Memory Access Token Auth Model](#preserve-the-in-memory-access-token-auth-model) — Security
7. [Keep React State Derived, Focused, and Per-Item Safe](#keep-react-state-derived-focused-and-per-item-safe) — Logic
8. [Build Fastify as Plugins with Explicit Contracts](#build-fastify-as-plugins-with-explicit-contracts) — API Design
9. [Keep Database Access Pooled, Parameterized, and Transactional](#keep-database-access-pooled-parameterized-and-transactional) — Data Integrity
10. [Protect Uploads, Media Reads, and Filesystem Paths](#protect-uploads-media-reads-and-filesystem-paths) — Security
11. [Test Behavior Through Service Layers and Fastify Inject](#test-behavior-through-service-layers-and-fastify-inject) — Testing
12. [Borrowed Standards Must Yield to the HomeServer Security Model](#borrowed-standards-must-yield-to-the-homeserver-security-model) — API Design

---

## Convention

Each entry follows this format:

```text
### [SHORT TITLE]
- **Date**: YYYY-MM-DD
- **Category**: Security | Data Integrity | Performance | Logic | Code Quality | Testing | Error Handling | API Design | Concurrency | DevOps
- **What happened**: Brief description of the mistake
- **Why it's wrong**: The actual risk or consequence
- **Anti-pattern examples**: Code snippets or structural examples showing the wrong way
- **Correct approach**: What should be done instead, with fixed examples
- **Applies to**: All stacks | Backend | Frontend | Database | Infrastructure
```

### Categories

| Category | When to use |
| --- | --- |
| **Security** | Auth flaws, exposed secrets, unsafe file access, missing request guards |
| **Data Integrity** | Lost updates, missing transactions, invalid metadata writes |
| **Performance** | Unbounded buffering, inefficient rendering, heavy requests |
| **Logic** | Bad state flow, wrong conditions, auth flashes, incorrect ownership |
| **Code Quality** | God modules, duplicate logic, wrong layer ownership |
| **Testing** | Missing coverage, wrong testing surface, poor verification |
| **Error Handling** | Swallowed errors, leaking internals, unclear failures |
| **API Design** | Loose contracts, untyped boundaries, inconsistent schemas |
| **Concurrency** | Shared mutable state, conflicting per-item mutations |
| **DevOps** | Bad environment assumptions, unsafe deployment defaults |

---

## Pre-Implementation Checklist

**Apply to every meaningful change before writing code.** This is the condensed version of the repo contract.

| # | Check | Category |
| --- | --- | --- |
| 1 | **Keep the app private-only** — Tailscale is the access boundary; there is no public/share feature in v1 | Security |
| 2 | **Keep filesystem access behind Fastify** — frontends never read or write files directly | Security |
| 3 | **Stay within the current repo shape** — prefer `frontend/` and `backend/`; add `packages/` only for real reuse | Code Quality |
| 4 | **Use the required stack** — React + Vite + strict TypeScript, Zustand, TanStack Query, ShadCN, Radix, Lucide, Fastify, PostgreSQL | Code Quality |
| 5 | **Do not log secrets or private path details** — redact tokens, cookies, auth headers, passwords, and sensitive raw paths | Security |
| 6 | **No `any`; no leaking `unknown`** — validate at the trust boundary and return concrete types immediately | API Design |
| 7 | **Use explicit DTOs and signatures** — exported functions, handlers, hooks, mutations, and stores need explicit params and returns | API Design |
| 8 | **Use Zustand only for client-owned state** — never cache server listings or metadata collections there | Code Quality |
| 9 | **Use TanStack Query for every backend call** — components must not do raw `fetch()` against Fastify | Code Quality |
| 10 | **Keep access tokens in memory only** — refresh tokens live in `HttpOnly` cookies; never use `localStorage` | Security |
| 11 | **Avoid effect-driven fetching** — normal backend reads belong in query hooks/services, not `useEffect` | Logic |
| 12 | **Keep UI safe per item** — no shared pending state across mutating rows; destructive actions require confirmation | Logic |
| 13 | **Keep Fastify modular** — everything is a plugin; route schemas and response schemas are required | API Design |
| 14 | **Keep SQL safe and durable** — parameterized queries only; use transactions for multi-step writes | Data Integrity |
| 15 | **Stream files and media** — do not buffer large uploads/downloads; support byte ranges for audio/video | Performance |
| 16 | **Protect filesystem paths** — normalize input paths and store paths relative to the configured storage root | Security |
| 17 | **Test on the correct surface** — frontend through hooks/services, backend through `inject()`, then run repo verification commands | Testing |

---

## Verification Checklist

| # | Check | Category |
| --- | --- | --- |
| 1 | **Frontend exists** — run `npx tsc --noEmit` | Testing |
| 2 | **Frontend exists** — run `npx react-doctor . --verbose --diff` | Testing |
| 3 | **Backend tests use `inject()`** — avoid spinning up external HTTP for normal route tests | Testing |
| 4 | **Fastify apps are closed in tests** — no leaked handles | Testing |
| 5 | **Auth work includes refresh-flow coverage** — login, refresh, logout, retry behavior | Testing |
| 6 | **Upload work includes multipart coverage** — especially nested folder placement | Testing |
| 7 | **Listing work includes nested folder coverage** — verify hierarchy and navigation contracts | Testing |
| 8 | **Media work includes byte-range coverage** — browsers depend on range support for audio/video | Testing |

---

## Entries

<!-- Add new entries below this line, newest first -->

---

### Preserve the Private-Only Product Boundary

- **Date**: 2026-05-24
- **Category**: Security
- **What happened**: File-server projects drift into public sharing, direct browser file access, or mixed trust boundaries unless the product scope is kept explicit from the start.
- **Why it's wrong**: This repo is intentionally narrow. If agents add public access assumptions or bypass the backend boundary, they break the security model and start designing for the wrong product.
- **Anti-pattern examples**:
  ```text
  - Add a public share-link flow in v1
  - Let the frontend read /storage paths directly
  - Treat the app like a public internet file host instead of a Tailscale-only tool
  ```
  ```ts
  // WRONG: direct browser path access
  const imageUrl = `/storage/${file.relativePath}`
  ```
- **Correct approach**:
  ```text
  - Keep the product private-only
  - Treat Tailscale as the private access boundary
  - Keep scope to frontend + backend for v1
  - Store file bytes on disk, but route every read/write through Fastify
  - Store metadata and sessions in PostgreSQL
  ```
  ```ts
  // CORRECT: file bytes are always read through an authorized backend route
  const imageUrl = `/api/files/${file.id}/content`
  ```
- **Applies to**: All stacks

---

### Keep the Repository Shape and Stack Intentional

- **Date**: 2026-05-24
- **Category**: Code Quality
- **What happened**: Early monorepos often accumulate extra packages, substitute convenience libraries, or drift off the intended stack before the first milestone is stable.
- **Why it's wrong**: This repo is still at the definition stage. Premature structure and stack drift make future work harder to reason about and weaken consistency across agents.
- **Anti-pattern examples**:
  ```text
  - Add a shared package before there are real cross-boundary call sites
  - Swap TanStack Query for ad hoc fetch utilities
  - Introduce a second backend framework next to Fastify
  - Build the frontend with loose TypeScript settings
  ```
- **Correct approach**:
  ```text
  - Keep top-level work in frontend/ and backend/
  - Add packages/ only when two or three real reuse points justify it
  - Keep code DRY, but do not create abstractions before real repeated call sites justify them
  - Avoid god components, god stores, and god services; split modules before they become dumping grounds
  - Use React + Vite + TypeScript strict in frontend/
  - Use Zustand for client-owned state
  - Use TanStack Query for backend data and mutations
  - Use ShadCN, Radix primitives, and Lucide React for UI
  - Use Fastify + TypeScript strict in backend/
  - Use PostgreSQL for persistence
  ```
- **Applies to**: All stacks

---

### Never Leak Secrets or Private Structure

- **Date**: 2026-05-24
- **Category**: Security
- **What happened**: Logs and UI flows often expose more than intended: tokens, cookies, auth headers, passwords, or raw filesystem paths that reveal private server structure.
- **Why it's wrong**: This repo is a private file server. Secret leakage in logs or private path leakage in errors is a direct security failure. Weak destructive-action UX also makes data loss more likely.
- **Anti-pattern examples**:
  ```ts
  request.log.info({
    authorization: request.headers.authorization,
    cookies: request.headers.cookie,
    filePath: absolutePath,
  })
  ```
  ```tsx
  <Button onClick={deleteFile}>Delete</Button>
  ```
- **Correct approach**:
  ```ts
  request.log.info({
    fileId,
    folderId,
    action: 'delete-file',
  })
  ```
  ```tsx
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="destructive">Delete</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>{/* explicit confirmation */}</AlertDialogContent>
  </AlertDialog>
  ```
  ```text
  - Redact authorization headers, cookies, passwords, tokens, and similar secrets
  - Avoid returning raw storage paths to clients or logs when they expose private structure
  - Require explicit confirmation for destructive actions
  - If permissions are introduced later, use lowercase object:action strings
  ```
- **Applies to**: All stacks

---

### Keep Types Concrete at Every Trust Boundary

- **Date**: 2026-05-24
- **Category**: API Design
- **What happened**: Untyped boundaries spread quickly: `any` in handlers, `unknown` leaking from mappers, loose service contracts, and untyped store or hook APIs.
- **Why it's wrong**: Loose typing hides data-shape bugs until runtime and makes the frontend/backend contract unstable. This repo relies heavily on explicit contracts across auth, folders, uploads, and media.
- **Anti-pattern examples**:
  ```ts
  export async function listFolders(parentId): Promise<any> {
    const response = await fetch(`/folders?parentId=${parentId}`)
    return response.json()
  }
  ```
  ```ts
  export function mapFileRecord(input: unknown) {
    return input as FileRecord
  }
  ```
  ```ts
  export async function createFolderHandler(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as any
    return createFolder(body)
  }
  ```
- **Correct approach**:
  ```ts
  interface FolderSummary {
    id: string
    name: string
    parentId: string | null
  }

  export async function listFolders(parentId: string | null): Promise<FolderSummary[]> {
    const response = await apiClient.get('/folders', { parentId })
    return mapFolderSummaryList(response.data)
  }
  ```
  ```ts
  interface FileRecord {
    id: string
    name: string
    mimeType: string
    sizeBytes: number
  }

  export function mapFileRecord(input: unknown): FileRecord {
    const parsed = fileRecordSchema.parse(input)

    return {
      id: parsed.id,
      name: parsed.name,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
    }
  }
  ```
  ```ts
  interface CreateFolderBody {
    name: string
    parentId: string | null
  }

  interface CreateFolderReply {
    id: string
    name: string
    parentId: string | null
  }

  export async function createFolderHandler(
    request: FastifyRequest<{ Body: CreateFolderBody }>,
    reply: FastifyReply,
  ): Promise<CreateFolderReply> {
    reply.code(201)
    return createFolder(request.body)
  }
  ```
  ```text
  - No any, including implicit any, Array<any>, Promise<any>, Record<string, any>, or as any
  - Use unknown only inside dedicated mapper/parser functions at trust boundaries
  - Do not let unknown escape into components, hooks, stores, services, handlers, or exported types
  - Exported functions, hooks, mutations, store actions, handlers, and service methods need explicit params and return types
  - Use interface for object shapes and type for unions/intersections/mapped types
  - Prefer T | null or T | undefined over vague optional flow
  - Do not use double assertions like as unknown as SomeType
  - Prefer one component per file
  - Prefer kebab-case filenames and dedicated type files over inline domain types
  - Use @/ imports for frontend code once aliases are configured
  ```
- **Applies to**: All stacks

---

### Use Zustand for Client State and TanStack Query for Server State

- **Date**: 2026-05-24
- **Category**: Code Quality
- **What happened**: Frontends frequently blur client state, auth state, and server caches into one mega-store or scatter raw network calls directly inside components.
- **Why it's wrong**: That creates stale cache bugs, duplicated fetch logic, and weak invalidation. This repo explicitly separates client-owned state from backend-owned state.
- **Anti-pattern examples**:
  ```ts
  // WRONG: server cache in Zustand
  interface FileStore {
    files: FileRecord[]
    fetchFiles: (folderId: string) => Promise<void>
  }
  ```
  ```tsx
  export function FolderPage(): JSX.Element {
    useEffect(() => {
      void fetch('/api/folders').then(...)
    }, [])

    return <div />
  }
  ```
- **Correct approach**:
  ```ts
  interface UiState {
    selectedFolderId: string | null
    setSelectedFolderId: (folderId: string | null) => void
  }
  ```
  ```ts
  export function useFolderListQuery(parentId: string | null): UseQueryResult<FolderSummary[], Error> {
    return useQuery({
      queryKey: ['folders', parentId],
      queryFn: () => listFolders(parentId),
    })
  }
  ```
  ```text
  Component -> query/mutation hook -> service/api client -> Fastify API

  - Use one Zustand store per domain
  - Use atomic selectors and useShallow when selecting multiple fields from one store
  - Put mutation logic inside store actions, not components
  - Keep folder listings, file metadata collections, upload results, and other server-owned data in TanStack Query
  ```
- **Applies to**: Frontend

---

### Preserve the In-Memory Access Token Auth Model

- **Date**: 2026-05-24
- **Category**: Security
- **What happened**: Many frontend standards assume long-lived browser storage for tokens. That default conflicts with this repo's security contract.
- **Why it's wrong**: Persisting access tokens in readable browser storage widens the blast radius of XSS and breaks the intended refresh/session model.
- **Anti-pattern examples**:
  ```ts
  localStorage.setItem('accessToken', accessToken)
  document.cookie = `accessToken=${accessToken}`
  ```
  ```ts
  const token = sessionStorage.getItem('accessToken')
  ```
- **Correct approach**:
  ```text
  - Access tokens are short-lived and live only in memory
  - Refresh tokens are long-lived and live only in HttpOnly cookies
  - The auth store can hold the current access token in memory only
  - Session bootstrap must rebuild state through backend login/refresh/bootstrap calls
  - Shared API clients must read the current access token from in-memory state
  - Query and mutation flows must refresh and retry cleanly on token expiry
  - Protected screens must not flash private content before auth bootstrap resolves
  ```
  ```text
  login -> access token in response body + refresh cookie set
  request with expired access token -> refresh endpoint -> new access token -> retry original request
  logout -> invalidate session + clear refresh cookie
  ```
- **Applies to**: Frontend and Backend

---

### Keep React State Derived, Focused, and Per-Item Safe

- **Date**: 2026-05-24
- **Category**: Logic
- **What happened**: React codebases accumulate prop-to-state syncing, oversized components, effect-driven business logic, inaccessible click targets, unstable keys, and shared pending state across item lists.
- **Why it's wrong**: These patterns create race conditions, stale UI, brittle rendering, and poor accessibility. They also make file browsing and upload workflows harder to maintain.
- **Anti-pattern examples**:
  ```tsx
  const [currentName, setCurrentName] = useState(props.name)

  useEffect(() => {
    setCurrentName(props.name)
  }, [props.name])
  ```
  ```tsx
  {files.map((file, index) => (
    <div key={index} onClick={() => openFile(file.id)}>
      {file.name}
    </div>
  ))}
  ```
  ```tsx
  const [isDeleting, setIsDeleting] = useState(false)
  ```
- **Correct approach**:
  ```tsx
  const currentName = file.name
  ```
  ```tsx
  <button type="button" onClick={() => openFile(file.id)}>
    {file.name}
  </button>
  ```
  ```tsx
  {files.map((file) => (
    <FileRow key={file.id} file={file} />
  ))}
  ```
  ```text
  - Compute derived state during render instead of syncing props to state with useEffect
  - Prefer a key-based remount when state should reset for a new entity
  - Split components that exceed roughly 300 lines or mix too many responsibilities
  - If a component has 5+ related useState calls, consider useReducer
  - Put user-triggered logic in event handlers, not effects that watch state
  - Use semantic HTML first; do not make clickable div/span elements unless accessibility is fully handled
  - Avoid magic pixel positioning unless the layout truly requires it
  - Never share a single mutation pending state across a list when rows can mutate independently
  ```
- **Applies to**: Frontend

---

### Build Fastify as Plugins with Explicit Contracts

- **Date**: 2026-05-24
- **Category**: API Design
- **What happened**: Fastify apps become hard to test and reason about when registration order is loose, schemas are missing, and route behavior is implicit.
- **Why it's wrong**: This repo depends on explicit backend contracts for auth, uploads, folder listings, and media reads. Loose Fastify composition produces inconsistent behavior and fragile tests.
- **Anti-pattern examples**:
  ```ts
  const app = Fastify()
  app.post('/folders', async (request) => {
    return createFolder(request.body)
  })
  ```
  ```ts
  fastify.register(routes)
  fastify.register(dbPlugin)
  fastify.register(cors)
  ```
- **Correct approach**:
  ```text
  - Everything is a plugin
  - Separate the app builder from the server entrypoint so tests can use inject()
  - Register in this order:
    1. external plugins
    2. custom shared plugins
    3. decorators
    4. hooks
    5. routes
  - Use fastify-plugin only for shared infrastructure such as config, database, auth, and storage
  - Organize routes by resource/domain
  - Define params/query/body schemas for every route as applicable
  - Define response schemas for JSON endpoints
  - Use additionalProperties: false on body schemas unless there is a real reason not to
  - Never dynamically build schemas from user input
  - Use setErrorHandler() and setNotFoundHandler() for response shaping
  - Throw Error instances, not strings or plain objects
  - Use request.log inside handlers
  - Never leak stack traces or internal details to production clients
  ```
- **Applies to**: Backend

---

### Keep Database Access Pooled, Parameterized, and Transactional

- **Date**: 2026-05-24
- **Category**: Data Integrity
- **What happened**: File metadata and session systems fail subtly when SQL is concatenated, pooled clients are leaked, or multi-step writes are not wrapped in transactions.
- **Why it's wrong**: This repo stores metadata and sessions in PostgreSQL. Broken DB hygiene risks corrupted folder/file state and unstable auth behavior.
- **Anti-pattern examples**:
  ```ts
  const result = await client.query(`SELECT * FROM files WHERE folder_id = '${folderId}'`)
  ```
  ```ts
  await client.query(insertFileSql, fileValues)
  await client.query(insertFolderLinkSql, folderValues)
  ```
- **Correct approach**:
  ```ts
  const result = await client.query(
    'SELECT id, name FROM files WHERE folder_id = $1',
    [folderId],
  )
  ```
  ```text
  - Register a pooled PostgreSQL connection through a Fastify plugin
  - Open connections during plugin registration and close them with onClose
  - Use parameterized queries only
  - Use transactions for multi-step writes such as metadata creation plus folder/file linkage updates
  - Always release checked-out clients back to the pool
  ```
- **Applies to**: Backend and Database

---

### Protect Uploads, Media Reads, and Filesystem Paths

- **Date**: 2026-05-24
- **Category**: Security
- **What happened**: File servers often start by buffering uploads in memory, exposing storage directories directly, or trusting raw client paths.
- **Why it's wrong**: Those shortcuts break the repo's file-access model, hurt performance, and open path-traversal or unauthorized-read risks.
- **Anti-pattern examples**:
  ```ts
  const buffer = await request.file().toBuffer()
  await fs.promises.writeFile(`/srv/storage/${request.body.path}`, buffer)
  ```
  ```ts
  fastify.register(staticPlugin, {
    root: '/srv/storage',
  })
  ```
- **Correct approach**:
  ```text
  - Stream uploads to disk instead of buffering large payloads in memory
  - Stream media reads from disk instead of loading full files into memory
  - Support byte-range requests for audio and video endpoints
  - Route every file access through authorization-aware Fastify handlers
  - Never expose the storage directory as unauthenticated static hosting
  - Normalize and validate folder/file path inputs
  - Store paths relative to the configured storage root
  ```
  ```text
  - Use route-level auth hooks or preHandlers, not one global hook for every route
  - Keep cookie settings explicit and environment-aware
  - Preserve the backend auth contract:
    - login returns an access token and sets a refresh cookie
    - refresh validates the refresh token and returns a new access token
    - logout invalidates the session and clears the refresh cookie
  ```
- **Applies to**: Backend

---

### Test Behavior Through Service Layers and Fastify Inject

- **Date**: 2026-05-24
- **Category**: Testing
- **What happened**: Tests lose value when they mock the wrong layer, skip app shutdown, or avoid the exact behaviors this repo depends on: auth refresh, uploads, nested folders, and media ranges.
- **Why it's wrong**: Low-fidelity tests hide integration bugs in the exact places this private file server is most sensitive.
- **Anti-pattern examples**:
  ```tsx
  // WRONG: component-level fetch mocking instead of testing the query/service layer
  global.fetch = vi.fn()
  render(<FolderPage />)
  ```
  ```ts
  // WRONG: backend route test without inject()
  await fetch('http://localhost:3000/api/folders')
  ```
- **Correct approach**:
  ```text
  - Test frontend server-state behavior through query hooks and service modules
  - Test backend HTTP behavior with Fastify inject()
  - Always close the Fastify app in tests
  - When frontend exists, run:
    - npx tsc --noEmit
    - npx react-doctor . --verbose --diff
  - Add focused coverage for:
    - access-token refresh flow
    - multipart upload handling
    - nested folder listing
    - media range requests
  ```
- **Applies to**: Frontend and Backend

---

### Borrowed Standards Must Yield to the HomeServer Security Model

- **Date**: 2026-05-24
- **Category**: API Design
- **What happened**: External standards often assume a different trust model, especially around browser token storage and generic frontend architecture.
- **Why it's wrong**: If agents apply those rules mechanically, they will violate this repo's auth contract even while appearing to follow a standard.
- **Anti-pattern examples**:
  ```text
  - "The standard says store the access token in localStorage, so do that here too."
  - "A shared API client can read tokens from browser storage because that is how other projects work."
  ```
- **Correct approach**:
  ```text
  - Keep the Zustand + TanStack Query architecture from borrowed frontend standards
  - Reject any borrowed rule that requires access tokens in localStorage, sessionStorage, or readable cookies
  - Adapt the API client, bootstrap flow, and refresh behavior to this repo's in-memory access-token model
  - When standards conflict, this file and README.md are the source of truth
  ```
- **Applies to**: All stacks

---

## Source Material

This file was distilled from:

- `/home/charles/.claude/home-files/experiences.md`
- `/home/charles/Documents/Standards/next-standards.md`
- `/home/charles/Documents/Standards/FastifyJS-Coding-Standards.md`
