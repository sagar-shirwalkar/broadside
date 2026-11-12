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
| `pnpm task dev:full` | Run API + UI dev servers together. |
| `pnpm task lint` | Type-check server/root with `tsc --noEmit`. |
| `pnpm test` | Run server Vitest suite. |
| `pnpm test:coverage` | Run server tests with 80% coverage gate. |
| `pnpm task ui:test` | Run UI unit tests (Vitest). |
| `pnpm task ui:test:e2e` | Run UI E2E tests (Playwright, stubbed API). |
| `pnpm build` | Build server only (`dist/`). |
| `pnpm task build` | Build server + UI in parallel (`dist/`, `ui/dist/`). |
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

- `POST /api/runs` requires `script_path` and rejects traversal (`..`), oversized config, duplicate active IDs, and capacity exhaustion (`ARTILLERY_MAX_CONCURRENT`).
- Runs spawn `artillery run <script> --output <tmp>/report.json --quiet ...`; report parsing and ingestion happen after process exit.
- Completed reports are persisted under `ARTILLERY_REPORT_DIR` (default `data/reports`).
- `failure_reason`, `partial_data`, and `dropped_points` capture abnormal termination and ingestion-loss signals.
- `/livez` is liveness; `/readyz` (or `/api/health/ready`) is readiness and includes DB/flusher telemetry (and aggregate service checks in split deployments).

## Logging and debugging

- Use Pino logger from `src/logger.ts` (`logger.info/error/...`), never `console.*` in `src/`.
- Pass errors as `{ err }` to preserve stack/serialization.
- HTTP request logging is handled by Hono structured logging middleware.
- `LOG_LEVEL` and `LOG_PRETTY` control verbosity/formatting.

## Build and CI

Typical CI checks/gates:
- `pnpm task proto:check`
- `pnpm task lint`
- `pnpm test:coverage`
- server build (and Docker image build in configured workflows)

`pnpm task build` runs server and UI builds in parallel.

## Project layout (high level)

```text
src/                    # server, ingestion, DB, orchestration
  server/               # app wiring, routes, gRPC, Kafka
  lib/                  # normalize, flusher, ring buffer, artillery, ingest tracker
  db/                   # postgres client, schema.sql
  gen/                  # generated proto TS (do not edit)
proto/                  # protobuf definitions
ui/                     # Lit dashboard (own package)
  src/core, app, features, components, services, styles
test/                   # Vitest tests
docs/                   # documentation
load-tests/             # local scripts (may be gitignored/local)
scripts/                # helper/benchmark scripts
```

## Adding features

- **New REST route:** add under `src/server/routes/` and mount in `src/server/app.ts`.
- **New ingestion path:** normalize/validate at boundary and call `metricsFlusher.ingest(...)` (never write directly to DB).
- **New config/env var:** add in `src/config.ts`, document in `.env.example`, and update relevant docs.
- **Schema change:** update `src/db/schema.sql`, apply/migrate appropriately, and update [data model](../data-model.md) and behavior docs.
- **Proto change:** edit proto, regenerate, update handlers/clients, and run proto checks.

## Gotchas

- ESM + `NodeNext`: relative TS imports use `.js` extensions.
- `src/gen/**` is generated; `src/index.ts` and generated files have special coverage/build considerations.
- Active Artillery runs are tracked in memory; process restarts lose in-flight orchestration state.
- In dev, Vite proxies `/api`, `/ws`, `/readyz`, `/livez` to the API server.
- For local host dev, `DATABASE_URL` should target `localhost`; Compose services use the internal `db` hostname.
