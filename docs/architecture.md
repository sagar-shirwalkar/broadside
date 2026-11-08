# Architecture and Data Flow

## Overview

Broadside is a Node/TypeScript service that ingests Artillery-style metric points, buffers them, and writes them to TimescaleDB. It can also launch Artillery runs, parse their JSON reports into aggregate and per-endpoint points, and persist the reports. It exposes REST reads, a WebSocket ingest endpoint, Connect/gRPC ingest, and an optional Kafka consumer. The dashboard UI is not implemented yet.

## Runtime topology

- `src/index.ts` starts the global `metricsFlusher`, the optional Kafka consumer, the Hono server on `PORT` (default `3000`) for REST + WebSocket, and a Node HTTP/2 Connect server on `PORT + 1` (default `3001`).
- Graceful shutdown stops the flusher, Kafka consumer, WebSocket server, HTTP server, and HTTP/2 server.
- `src/config.ts` is the only place that reads `process.env`. Ports, DB URL, Kafka settings, logging, report storage, and ring-buffer tuning live there.
- Orchestrated runs require an `artillery` binary on `PATH`. Broadside does not bundle it.
- `src/logger.ts` configures the shared Pino logger. `@hono/structured-logger` logs one entry per HTTP request and reports unhandled route errors.

## Ingestion paths

| Path | Entry point | Input | Notes |
| --- | --- | --- | --- |
| WebSocket `/ws` | `src/server/app.ts` | JSON `{ run_id, points[] }` or a single point | Normalized by `normalizeBatch` before ingestion. Invalid JSON returns an error message to the client. |
| Connect/gRPC | `src/server/grpc.ts` | `MetricBatch` protobuf messages | `StreamMetrics` is client-streaming; `PushMetrics` is unary. Proto types are mapped to domain `MetricPoint`s. |
| Kafka | `src/server/kafka.ts` | JSON `MetricBatch` | Enabled only when `KAFKA_BROKERS` is set. Consumes `KAFKA_TOPIC` (default `artillery.metrics`). |
| REST `POST /api/runs` | `src/server/routes/runs.ts` | `{ id?, script_path, config?, extra_args? }` | Inserts a `running` row and spawns `artillery run`. The report is parsed into `MetricPoint`s when Artillery exits, then fed to the flusher. |

## Run orchestration

`src/lib/artillery.ts` owns the run lifecycle:

1. `POST /api/runs` validates that `script_path` is a non-empty string without `..`, rejects duplicate active ids with `409`, and inserts the run as `running`.
2. `spawnArtillery` creates a temporary directory and runs `artillery run <script> --output <tmp>/report.json --quiet`, appending `extra_args`. It resolves once the child is spawned, not when the run finishes.
3. Active runs are tracked in an in-memory map. `killRun` sends `SIGTERM` and marks the run terminal so the eventual `close` event does not process a partial report.
4. On a clean exit, `processReport` reads the report, converts it to points, ingests them, copies the raw JSON to `ARTILLERY_REPORT_DIR`, and updates the `runs` row to `completed`.
5. A non-zero exit, spawn `error`, or parsing/DB failure marks the run `failed` and logs the reason. The temporary directory is removed in all cases.

`settled` and `killed` guards prevent double handling when `close` and `error` both fire. Routes await `spawnArtillery` only long enough to catch immediate spawn failures; they return `500` and mark the row failed if the process cannot start.

### Report parsing

Artillery's newer report shape uses `period` (epoch milliseconds) on intermediate buckets; older reports may use `timestamp`. Both are accepted, and `histograms`/`summaries` are treated as equivalent because Artillery currently populates them with the same summarized distributions.

Per-endpoint data is read from keys written by the `metrics-by-endpoint` plugin:

| Key | Meaning |
| --- | --- |
| `plugins.metrics-by-endpoint.response_time.<endpoint>` | Per-endpoint latency histogram. |
| `plugins.metrics-by-endpoint.<endpoint>.codes.<status>` | Per-endpoint response-code counter. |
| `plugins.metrics-by-endpoint.<endpoint>.errors.<code>` | Per-endpoint error counter. |

Custom `metricsNamespace` values are inferred from response-time keys. Engine-level histograms such as `http.response_time.2xx` are not treated as endpoints. Per-endpoint RPS scales the bucket's measured `http.request_rate` by each endpoint's share of `http.requests`; if no rate is reported, the bucket duration is derived from adjacent `period` values or falls back to 10 seconds. Reports without plugin keys emit only the aggregate point (`endpoint: ""`).

## Write path

```text
ingest path → metricsFlusher.ingest()
            → RingBuffer<MetricPoint>
            → flush on size threshold or timer
            → INSERT INTO metrics (postgres.js)
            → TimescaleDB hypertable
```

Rules:

- All ingestion paths must go through `metricsFlusher.ingest`; do not insert into `metrics` directly from a route or consumer.
- `RingBuffer` capacity is rounded up to a power of two. When full, it drops the oldest item and increments `dropped` instead of blocking.
- `MetricsFlusher` skips a flush if one is already running.
- A failed insert re-queues the drained batch.
- `MetricsFlusher` is a singleton exported from `src/lib/flusher.ts`.

## REST routes

Run and metric endpoints (`src/server/routes/runs.ts`):

- `GET /api/runs` — latest 100 runs from `runs`.
- `GET /api/runs/:id` — one run or `404`.
- `GET /api/runs/:id/metrics` — reads `metrics_1m`, `metrics_1h`, or `metrics_1d`. `granularity` defaults to `1m`; `from`/`to` are optional time filters.
- `GET /api/runs/:id/raw` — reads the raw `metrics` hypertable, limited to 100,000 rows.
- `POST /api/runs` — creates and starts a run (see [Run orchestration](#run-orchestration)).
- `DELETE /api/runs/:id` — kills an active run, or deletes a finished run and its metrics. Unknown ids return `404`.

`src/server/routes/health.ts` exposes `GET /api/health` with uptime and flusher stats (`buffered`, `dropped`, `flushed`).

Only `1m`, `1h`, and `1d` are valid granularities. The view name is selected with `sql.identifier`, so do not pass unvalidated user input into it.

## Data model

- **`metrics`** — raw hypertable: `time`, `run_id`, `endpoint`, `rps`, `p50`, `p95`, `p99`, `error_rate`. One-day chunks; index on `(run_id, time DESC)`. Aggregate rows use `endpoint = ''`; per-endpoint rows use the plugin's URL/request name. Aggregate error rate is VU-based; per-endpoint error rate is request-based.
- **`runs`** — run metadata: `id`, `started_at`, `duration_ms`, `total_requests`, `p50`, `p95`, `p99`, `error_rate`, `status`, `config_yaml`, `json_path`. `status` is `running`, `completed`, or `failed`; `json_path` is the persisted report location for orchestrated runs.
- **Continuous aggregates** — `metrics_1m` is built from raw data; `metrics_1h` from `metrics_1m`; `metrics_1d` from `metrics_1h`.
- **Policies** — continuous aggregates refresh on schedules; raw metrics compress after 7 days and are retained for 90 days.
- `metrics_1m` and `metrics_1h` use `timescaledb.materialized_only = false`, so they include recent unmaterialized data. `metrics_1d` remains materialized-only.

## Key files

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Process bootstrap, servers, shutdown. |
| `src/config.ts` | Environment configuration and defaults. |
| `src/types.ts` | Shared `MetricPoint`, `RunSummary`, `QueryParams`, `MetricBatch` types. |
| `src/server/app.ts` | Hono app, `/ws` ingestion, route mounting. |
| `src/server/grpc.ts` | Connect service implementation and proto → domain mapping. |
| `src/server/kafka.ts` | Optional Kafka consumer lifecycle. |
| `src/server/routes/runs.ts` | Run and metric query endpoints. |
| `src/server/routes/health.ts` | Health endpoint. |
| `src/logger.ts` | Shared Pino logger and Hono `AppEnv` logger typing. |
| `src/lib/normalize.ts` | JSON payload normalization and alias handling. |
| `src/lib/artillery.ts` | Run orchestration, report parsing, report persistence, and active-run tracking. |
| `src/lib/ring-buffer.ts` | Fixed-capacity drop-oldest ring buffer. |
| `src/lib/flusher.ts` | Buffered batch writes to TimescaleDB. |
| `src/db/client.ts` | postgres.js client. |
| `src/db/schema.sql` | Hypertable, runs table, continuous aggregates, policies. |
| `proto/metrics/v1/ingest.proto` | gRPC/Connect service and message definitions. |
| `src/gen/**` | Generated protobuf TypeScript; do not edit by hand. |
| `ui/` | Placeholder for the dashboard. |
| `src/lib/fplib/` | Standalone pure-TypeScript functional utilities; not imported by the server. |

## Known gaps and rough edges

- `ui/` contains only a `.gitkeep`, so `pnpm task build` fails at the `build:ui` step. Use `pnpm build`.
- Runs are not streamed live; metrics appear only after Artillery exits and the final report is processed. A crash before report processing loses that run's metrics.
- The `artillery` binary is not a project dependency; operators must install it on the host or in the runtime image.
- `metrics_1h` and `metrics_1d` use `avg(...)` over already-aggregated percentiles; they are approximations rather than recomputed percentiles.
- Docker Compose publishes port `3000` only; the gRPC port `3001` is not exposed by the default stack.
