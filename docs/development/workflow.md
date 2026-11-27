# Development workflow

## Prerequisites

- Node.js 22+
- pnpm 12.18+
- Docker/Compose and `psql` on `PATH`
- [`artillery`](https://www.artillery.io/docs/get-started/install) CLI on `PATH` for `POST /api/runs`
- `task` and `buf` come from dev dependencies (no global install required)

## First-time setup

```bash
cp .env.example .env
# For local dev, keep DATABASE_URL pointed at localhost (db container is port-mapped)
pnpm task setup
```

`setup` runs install, proto generation, DB startup/wait, and schema init. It does not start the API/UI dev servers.

## Daily commands

| Command | Purpose |
| --- | --- |
| `pnpm task dev` | Run API server in watch mode (`:3000` REST/WS, `:3001` gRPC). |
| `pnpm task ui:dev` | Run Vite dashboard dev server (`:5173`, proxies `/api`, `/ws`, `/readyz`, `/livez`). |
| `pnpm task dev:full` | Run API + UI dev servers together. Dev resolves `@broadside/fp` from source (`source` condition), so FP edits do not require rebuilding `packages/fp/dist`. |
| `pnpm task lint` | Type-check server/root with `tsc --noEmit`. |
| `pnpm test` | Run root Vitest suite (`src/**/*.test.ts`, `test/**/*.test.ts`, `packages/fp/**/*.test.ts`). |
| `pnpm test:coverage` | Run root tests with coverage thresholds (see `vitest.config.ts`). |
| `pnpm task fp:test` | Run `@broadside/fp` package tests only. |
| `pnpm task fp:build` | Build `@broadside/fp` (`packages/fp/dist`). |
| `pnpm task ui:test` | Run UI unit tests (Vitest). |
| `pnpm task ui:test:e2e` | Run UI E2E tests (Playwright, stubbed API). |
| `pnpm build` | Build server TypeScript only (`tsc` → `dist/`); does **not** build `@broadside/fp/dist` or the UI. |
| `pnpm task build` | Build `@broadside/fp` (as needed), server, and UI (`packages/fp/dist`, `dist/`, `ui/dist/`). |
| `pnpm start` | Run built server (`node dist/index.js`, serves API + built UI from `UI_DIST_DIR`). |
| `pnpm task proto` | Regenerate `src/gen/` from `proto/`. |
| `pnpm task proto:check` | Verify generated proto files are up to date. |
| `pnpm task db:up` / `db:down` | Start / stop TimescaleDB (`db` service). |
| `pnpm task db:wait` | Wait for DB readiness. |
| `pnpm task db:init` | Apply `src/db/schema.sql` via `psql`. |
| `pnpm task db:logs` | Tail DB logs. |
| `pnpm task docker:build` / `docker:up` / `docker:down` | Build/run/stop Docker Compose stack. |
| `pnpm task clean` | Remove `dist`, `ui/dist`, `.task`. |
| `pnpm task --list` | List all tasks. |

## Database lifecycle

- `docker-compose.yml` mounts `src/db/schema.sql` into `/docker-entrypoint-initdb.d/` for first-time DB volume initialization.
- After schema changes on an existing volume, run `pnpm task db:init` or recreate the volume (`docker compose down -v`) for a clean rebuild.
- `db:init` requires `psql` on the host.
- TimescaleDB image: `timescale/timescaledb:latest-pg16`.

## Proto workflow

1. Edit `proto/metrics/v1/ingest.proto`.
2. Run `pnpm task proto`.
3. Commit proto and regenerated `src/gen/` together.
4. Run `pnpm task proto:check`.

`src/gen/**` is generated code; never edit it by hand.

## Artillery/orchestration development notes

- `POST /api/runs` accepts `script_path` (server-visible path) or `script_content` (uploaded script text). It rejects traversal (`..`) in user-supplied paths, oversized script/config bodies, duplicate active IDs, and capacity exhaustion (`ARTILLERY_MAX_CONCURRENT`).
- Runs spawn `artillery run <script> --output <tmp>/report.json --quiet ...` with a temporary Broadside reporter plugin (`config.plugins.broadside-reporter`, `ARTILLERY_PLUGIN_PATH`) for live metric streaming; on exit, the final report reconciles provisional streamed rows and is persisted under `ARTILLERY_REPORT_DIR` (default `data/reports`).
- `failure_reason`, `partial_data`, and `dropped_points` capture abnormal termination and ingestion-loss signals.
- `/livez` is liveness; `/readyz` (or `/api/health/ready`) is readiness and includes DB/flusher telemetry (and aggregate service checks in split deployments).

## Logging and debugging

- Use Pino logger from `src/logger.ts` (`logger.info/error/...`), never `console.*` in `src/`.
- Pass errors as `{ err }` to preserve stack/serialization.
- HTTP request logging is handled by Hono structured logging middleware.
- `LOG_LEVEL` and `LOG_PRETTY` control verbosity/formatting.

## Build and CI

- `pnpm task build` builds `@broadside/fp` (server build depends on it), the server, and the UI. Raw `pnpm build` runs server `tsc` only.
- CI (`.github/workflows/ci.yml`) runs, in the main `check` job: install, `pnpm task proto:check`, `pnpm task lint`, `pnpm test:coverage`, `pnpm task fp:build && pnpm build` (server), UI install/build, UI typecheck, and UI unit tests. Separate jobs run UI E2E (Playwright) and a Docker Compose smoke check (`/api/health` + SPA shell) after `check`.

## Project layout (high level)

```text
packages/fp/            # @broadside/fp workspace package (source + dist exports)
src/                    # server, ingestion, DB, orchestration
  server/               # app wiring, routes, gRPC, Kafka
  lib/                  # normalize, flusher, ring buffer, artillery, ingest tracker
  db/                   # postgres client, schema.sql
  gen/                  # generated proto TS (do not edit)
proto/                  # protobuf definitions
ui/                     # Lit dashboard (workspace package)
  src/core, app, features, components, services, styles
docs/                   # documentation
load-tests/             # local scripts (may be gitignored/local)
scripts/                # helper/benchmark scripts
``` Tests are co-located in `__tests__/` directories (e.g. `src/**/__tests__`, `ui/src/**/__tests__`, `packages/fp/**/__tests__`). Root Vitest config also includes `test/**/*.test.ts` if present.

## Adding features

- **New REST route:** add under `src/server/routes/` and mount in `src/server/app.ts`.
- **New ingestion path:** normalize/validate at boundary and call `metricsFlusher.ingest(...)` (never write directly to DB).
- **New config/env var:** add in `src/config.ts`, document in `.env.example`, and update relevant docs.
- **Schema change:** update `src/db/schema.sql`, apply/migrate appropriately, and update [data model](../data-model.md) and behavior docs.
- **Proto change:** edit proto, regenerate, update handlers/clients, and run proto checks.

## Gotchas

- ESM + `NodeNext`: relative TS imports use `.js` extensions (server/root). `@broadside/fp` is a workspace package with `source`-condition dev resolution and `dist` runtime exports.
- `src/gen/**` is generated; `src/index.ts` and generated files have special coverage/build considerations.
- Active Artillery runs are tracked in memory; process restarts lose in-flight orchestration state.
- In dev, Vite proxies `/api`, `/ws`, `/readyz`, `/livez` to the API server.
- For local host dev, `DATABASE_URL` should target `localhost`; Compose services use the internal `db` hostname.
- Production-style runs (`pnpm start` / `node dist/index.js`) require built `packages/fp/dist` and `dist/` (and `ui/dist` for the dashboard); prefer `pnpm task build`.
