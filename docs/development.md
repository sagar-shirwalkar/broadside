# Development Workflow

## First-time setup

Prerequisites: Node.js 22+, pnpm 12.18+, Docker/Compose, and `psql` on `PATH`. Install the `artillery` CLI separately if you want to exercise `POST /api/runs` against a real load test.

```bash
cp .env.example .env
# Edit DATABASE_URL if Postgres is not at localhost:5432

pnpm task setup
```

`setup` runs `pnpm install`, `pnpm task proto`, `pnpm task db:up`, `pnpm task db:wait`, and `pnpm task db:init`.

## Daily commands

| Command | Purpose |
| --- | --- |
| `pnpm task dev` | Run the server in watch mode (REST/WS `:3000`, gRPC `:3001`). |
| `pnpm task dev:full` | Run the server and Vite dev server together (dashboard on `:5173`). |
| `pnpm task lint` | Type-check with `tsc --noEmit`. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:coverage` | Run tests with the 80% coverage gate. |
| `pnpm build` | Compile the server to `dist/`. |
| `pnpm task proto` | Regenerate `src/gen/` from `proto/`. |
| `pnpm task proto:check` | Fail if generated proto files are stale. |
| `pnpm task db:up` / `db:down` | Start / stop TimescaleDB. |
| `pnpm task db:init` | Apply `src/db/schema.sql` with `psql`. |
| `pnpm task db:logs` | Tail database logs. |
| `pnpm task docker:build` / `docker:up` / `docker:down` | Build / run / stop the Docker stack. |
| `pnpm task clean` | Remove `dist`, `ui/dist`, and `.task`. |
| `pnpm task --list` | List every task. |

## Database lifecycle

- `docker-compose.yml` mounts `src/db/schema.sql` into `/docker-entrypoint-initdb.d/`. That only runs when the Postgres data volume is first created.
- After changing the schema, apply it explicitly with `pnpm task db:init`, or reset the volume with `docker compose down -v` for a clean rebuild.
- `db:init` requires the `psql` client; it is not bundled with the project.
- TimescaleDB runs as `timescale/timescaledb:latest-pg16`.

## Proto workflow

1. Edit `proto/metrics/v1/ingest.proto`.
2. Run `pnpm task proto` to regenerate `src/gen/`.
3. Commit both the proto change and the regenerated TypeScript.
4. Run `pnpm task proto:check` before finishing.

`src/gen/` is excluded from `tsconfig.json` but is imported by `src/server/grpc.ts`. Do not edit generated files manually.

## Testing

- Tests live in `test/` and use Vitest plus Hono's `testClient` from `hono/testing`.
- `pnpm test` runs the suite; `pnpm test:coverage` enforces 80% statements, branches, functions, and lines.
- `test/normalize.fuzz.test.ts` is the fast-check property suite for the ingestion boundary: arbitrary JSON must either parse or throw `TypeError`; well-formed points round-trip, alias variants agree, re-normalization is idempotent, and unknown keys are inert. Run it with `pnpm test test/normalize.fuzz.test.ts`.
- Database and Kafka dependencies are mocked. Unit tests do not require a running TimescaleDB.
- `test/artillery.test.ts` mocks `node:child_process`, `node:fs/promises`, the DB client, the logger, config, and the flusher. Use its fake process helper to drive `close`/`error` events; wrap assertions for async handlers in `vi.waitFor`.
- `test/runs.test.ts` exercises the REST surface through `testClient` with a mocked `sql` tagged-template. Because the mock records template parts and values separately, assertions on pagination or `ANY (${ids})` inspect the value indexes (`call[1]`, `call[2]`, …) rather than the SQL text.
- `src/server/routes/runs.ts` tests the SSE stream through the router itself (`runs.request(...)`) so `streamSSE` writes real `text/event-stream` chunks; assert on the response body text and on the recorded `sql` calls.
- `src/index.ts` and `src/gen/**` are excluded from coverage. `src/index.ts` starts real servers and exits the process. `src/lib/artillery.ts` is included in the coverage gate.

## Artillery runs

- `POST /api/runs` requires `script_path`; a missing/blank path returns `400`, a path containing `..` returns `400`, and an already-active id returns `409`.
- The server invokes `artillery run <script> --output <temp>/report.json --quiet` plus any `extra_args`. The report is parsed only after the process exits, which sets `status` to `completed`, fills `duration_ms` / `total_requests` / percentiles / `error_rate`, and ingests the points through the flusher. A non-zero exit, spawn failure, or parsing error marks the run `failed`.
- Completed reports are copied to `ARTILLERY_REPORT_DIR` (default `data/reports`) and recorded in `runs.json_path`. The directory is gitignored.
- Per-endpoint points require Artillery's `metrics-by-endpoint` plugin. It is enabled by default since Artillery v2.0.1; older or plugin-less reports still produce an aggregate point.
- `load-tests/` (gitignored) holds local sample scripts: `load-test.yml` (10s smoke), `steady-state.yml`, `ramp.yml`, `multi-session.yml`, `mixed-load.yml` — all gentle (≤8 rps) with multi-phase shapes for chart exercises.
- `POST /api/runs` refuses with `429` once `ARTILLERY_MAX_CONCURRENT` children are already running, and with `413` for configs over 200 KB. On shutdown the server SIGTERMs any still-running children.
- Tests mock the Artillery process; they do not require the CLI. Manual runs against a local target are the quickest way to verify parser changes against a new Artillery version.

## Auth and CORS

- Set `API_TOKEN` to require `Authorization: Bearer <token>` on `/api/runs/*`, `/api/runs/:id/live`, and `/ws`. `/api/health` stays public. To test with curl: `curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/api/runs`.
- WebSocket (`/ws`) and EventSource (`/:id/live`) clients accept `?token=` as a fallback because browsers cannot set headers on those transports. The token then appears in server logs, so use it only where the header is impossible.
- `CORS_ORIGINS` is a comma-separated allow-list, defaulting to `http://localhost:5173,http://127.0.0.1:5173` for the Vite dev server. `*` allows any origin.
- `test/auth.test.ts` builds a bare Hono app around `createAuthMiddleware` so token handling is tested without touching the real `config`; `test/app.test.ts` covers CORS behavior through `createApp`. The config module reads env at import time, so `test/config.test.ts` uses `vi.resetModules()` and sets `process.env` before importing.

## Reading run data

- `GET /api/runs?limit=&offset=` — paginate the run list; `limit` is 1–100 (default 100), `offset` is ≥ 0.
- `GET /api/overview?days=<1|7|30>&frequency=<day|week>` — one-shot landing-page aggregates: SLO status (p95/error-rate met-rates over the last `SLO_WINDOW_RUNS` completed runs), per-run p95 and error-rate trend from `metrics_1d` grouped by `run_id` over `?days` (default `30`), run frequency bucketed by `?frequency` over 30 days (default `day`), worst endpoints by average p95 (30 days), regression alerts (latest run's per-endpoint p95 vs. rolling median), and the 5 most recent runs. Returns `meta: { trendDays, frequencyInterval }`.
- `GET /api/runs/:id/endpoints` — distinct non-aggregate endpoints with sample counts; what the dashboard uses to render filter tabs.
- `GET /api/runs/:id/metrics` and `/raw` accept `endpoint=` for server-side filtering. The aggregate row is `endpoint=`.
- `GET /api/runs/compare?ids=a,b,c` — metadata plus one series per run. `ids` is required, 2–10 after de-duplication; `granularity`/`from`/`to`/`endpoint` work as on `/metrics`.
- `GET /api/runs/:id/live` — SSE feed of raw points plus a terminal `run` event. `interval_ms` bounds polling between 100 and 60000 (default 1000). To try it locally, push points over `/ws` in a loop and open the stream with `curl -N`.

## Logging

- Use the shared Pino logger from `src/logger.ts`. Do not add `console.*` calls in `src/`.
- `@hono/structured-logger` logs each HTTP request with `method`, `path`, `status`, and `durationMs`, and logs unhandled errors with `{ err }`.
- Pass errors as `logger.error({ err }, "message")` so Pino serializes the stack trace.
- `LOG_LEVEL` controls verbosity; `LOG_PRETTY=true` enables `pino-pretty` for local development.

## Build and CI

- CI runs `pnpm task proto:check`, `pnpm task lint`, `pnpm test:coverage`, and its server build step.
- A separate CI job builds the Docker image on pushes to `main`.
- `pnpm task build` runs `build:server` and `build:ui` in parallel; `pnpm build` builds the server only.

## Docker

- `pnpm task docker:build` builds the production image.
- `pnpm task docker:up` runs the full Compose stack; `docker:down` stops it.
- The Dockerfile is multi-stage: install deps and generate/build in the first stage, then copy `node_modules`, `dist`, and `package.json` into the runtime stage.
- The default Compose stack publishes only port `3000`.

## Dashboard (`ui/`)

- `ui/` is its own package (own `package.json`, lockfile, and `pnpm-workspace.yaml` for the esbuild approval). `cd ui && pnpm install` sets it up; `pnpm task ui:dev` / `ui:build` wrap the Vite scripts.
- UI tests: `pnpm task ui:test` (Vitest, pure-logic: router parsing, formatters, chart geometry) and `pnpm task ui:test:e2e` (Playwright, 9 scenarios with the API stubbed at the network layer, so no database is needed). E2E needs browsers: `cd ui && pnpm exec playwright install chromium`. CI runs both.
- The dashboard opens on the **Overview** page (`#/`): SLO status, per-run p95/error-rate trend, run frequency, worst endpoints, recent runs, and regression alerts. The **Runs** list moved to `#/runs`.
- `GET /api/runs/:id/phases` parses `config.phases` from the stored Artillery YAML to annotate charts; runs started outside `POST /api/runs` have no phases.
- The UI type-checks as part of its build (`tsc --noEmit && vite build`). The root `tsc` does not cover `ui/` — run `cd ui && pnpm typecheck` to check it alone.
- Routing is hash-based (`#/` → Overview, `#/runs` → run list, `#/compare` → compare, `#/runs/:id` → detail), so no static-host rewrite rules are needed; the API server's SPA fallback serves `index.html` for unknown non-API GETs.
- Charts are hand-rolled SVG (`ui/src/chart-svg.ts` for scales/paths, `line-chart.ts` for rendering); colors come from CSS custom properties (`--chart-line-*`) so the dark/light toggle re-colors rendered paths without re-rendering. The SVG children are injected via `innerHTML` on the `<g>` — Lit `${...}` interpolations inside `<svg>` land in the XHTML namespace and don't render.
- API calls go through `apiGet`/`api` in `ui/src/api.ts`, which centralizes the Bearer token and 401 handling. UI tests: `pnpm task ui:test` (Vitest) and `pnpm task ui:test:e2e` (Playwright, API stubbed — see the Testing section).

## Adding features

- **New REST route:** add a Hono router under `src/server/routes/`, then mount it in `src/server/app.ts`.
- **New ingestion path:** normalize JSON at the boundary, then call `metricsFlusher.ingest`. Do not write to the database directly.
- **New config value:** add it to `src/config.ts` and document it in `.env.example` and the README.
- **Schema change:** update `src/db/schema.sql`, apply it with `pnpm task db:init`, and update the README data-model section if behavior changes.
- **New proto RPC:** update the proto, regenerate, implement the handler in `src/server/grpc.ts`, and update the README API table.

## Gotchas

- The project is ESM with `module: NodeNext`; relative imports in TypeScript must use the `.js` extension (for example `./config.js`).
- Tests use Vitest and Hono's `testClient`; run `pnpm test` or `pnpm test:coverage`.
- `pnpm task dev:full` runs the server and Vite dev server together; the UI at `:5173` proxies `/api` and `/ws` to `:3000`.
- `artillery` is not in `package.json`; `POST /api/runs` fails with `500` if the binary is missing from `PATH`.
- The orchestrator keeps active runs in memory, so restarting Broadside while a run is in flight leaves that row at `running` and loses the report.
