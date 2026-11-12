# Testing

## Test layers

- **Server/unit & integration (Vitest):** `test/` covers routes, normalization, flusher, orchestration, auth/config behavior, etc.
- **UI unit tests (Vitest):** `ui/` package tests for pure logic (routing, formatting, chart helpers where covered).
- **UI E2E (Playwright):** `ui/e2e/` scenarios run against the Vite dev server with the API stubbed at the network layer (no database/Artillery required).
- **Property/fuzz boundary tests:** `test/normalize.fuzz.test.ts` (fast-check) validates ingestion normalization invariants.

## Commands

From repo root:

```bash
pnpm test                 # server/unit+integration tests
pnpm test:coverage        # server tests with 80% coverage gate
pnpm task lint            # type-check (server/root)
pnpm task ui:test         # UI unit tests
pnpm task ui:test:e2e     # UI E2E tests (Playwright, stubbed API)
```

UI-only checks:

```bash
cd ui && pnpm typecheck
cd ui && pnpm test
cd ui && pnpm exec playwright install chromium   # first-time browser install
cd ui && pnpm exec playwright test e2e/broadside.spec.ts
```

## Coverage and gates

- Server coverage gate: **80%** (statements/branches/functions/lines) via `pnpm test:coverage`.
- CI runs proto freshness check, lint/typecheck, server tests/coverage, and builds (plus Docker image build on relevant branches/workflows as configured).
- UI build includes `tsc --noEmit`; root `tsc` does not typecheck `ui/`.

## Testing conventions and notes

- **HTTP route tests:** use Hono `testClient` and mock DB/Kafka/external dependencies as needed.
- **SSE tests:** exercise the router/request path so real `text/event-stream` behavior is validated.
- **Artillery orchestration tests:** mock `node:child_process`, filesystem, DB, logger, config, and flusher; use fake process helpers and `vi.waitFor` for async close/error handling.
- **Normalization boundary:** all untrusted JSON ingest payloads must be validated through normalization; malformed shapes fail closed (`TypeError`) rather than producing invalid domain values.
- **E2E stubbing:** Playwright tests intercept network calls (e.g. `/api/**`, `/readyz`) to keep runs deterministic and independent of backend state.
- **No generated-code edits:** `src/gen/**` is generated from proto and should not be hand-edited; update proto + regenerate instead.

## When to run what

- **Most code changes:** `pnpm task lint` and relevant `pnpm test`/targeted tests; `pnpm test:coverage` before finishing significant backend changes.
- **Proto changes:** `pnpm task proto`, `pnpm task proto:check`, and affected tests.
- **UI behavior/routing/API contract changes:** `cd ui && pnpm typecheck`, `pnpm task ui:test`, and `pnpm task ui:test:e2e` (or targeted spec).
- **Schema/query/rollup changes:** run DB against updated schema (`db:init`/reset volume as appropriate) and validate affected endpoints/queries.
