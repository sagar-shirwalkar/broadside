# Architecture and Data Flow

## Overview

Broadside is a Node/TypeScript service that ingests Artillery-style metric points, buffers them, and writes them to TimescaleDB. It exposes REST reads, a WebSocket ingest endpoint, Connect/gRPC ingest, and an optional Kafka consumer. The dashboard UI is not implemented yet.

## Runtime topology

- `src/index.ts` starts the global `metricsFlusher`, the optional Kafka consumer, the Hono server on `PORT` (default `3000`) for REST + WebSocket, and a Node HTTP/2 Connect server on `PORT + 1` (default `3001`).
- Graceful shutdown stops the flusher, Kafka consumer, WebSocket server, HTTP server, and HTTP/2 server.
- `src/config.ts` is the only place that reads `process.env`. Ports, DB URL, Kafka settings, logging, and ring-buffer tuning live there.
- `src/logger.ts` configures the shared Pino logger. `@hono/structured-logger` logs one entry per HTTP request and reports unhandled route errors.

## Ingestion paths

| Path | Entry point | Input | Notes |
| --- | --- | --- | --- |
| WebSocket `/ws` | `src/server/app.ts` | JSON `{ run_id, points[] }` or a single point | Normalized by `normalizeBatch` before ingestion. Invalid JSON returns an error message to the client. |
| Connect/gRPC | `src/server/grpc.ts` | `MetricBatch` protobuf messages | `StreamMetrics` is client-streaming; `PushMetrics` is unary. Proto types are mapped to domain `MetricPoint`s. |
| Kafka | `src/server/kafka.ts` | JSON `MetricBatch` | Enabled only when `KAFKA_BROKERS` is set. Consumes `KAFKA_TOPIC` (default `artillery.metrics`). |
| REST `POST /api/runs` | `src/server/routes/runs.ts` | `{ id, config? }` | Registers run metadata only. It does not ingest metrics or launch Artillery (TODO). |

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

## Query path

`src/server/routes/runs.ts`:

- `GET /api/runs` — latest 100 runs from `runs`.
- `GET /api/runs/:id` — one run or `404`.
- `GET /api/runs/:id/metrics` — reads `metrics_1m`, `metrics_1h`, or `metrics_1d`. `granularity` defaults to `1m`; `from`/`to` are optional time filters.
- `GET /api/runs/:id/raw` — reads the raw `metrics` hypertable, limited to 100,000 rows.
- `GET /api/health` — uptime and flusher stats (`buffered`, `dropped`, `flushed`).

Only `1m`, `1h`, and `1d` are valid granularities. The view name is selected with `sql.identifier`, so do not pass unvalidated user input into it.

## Data model

- **`metrics`** — raw hypertable: `time`, `run_id`, `endpoint`, `rps`, `p50`, `p95`, `p99`, `error_rate`. One-day chunks; index on `(run_id, time DESC)`.
- **`runs`** — run metadata: `id`, `started_at`, `duration_ms`, `total_requests`, `p50`, `p95`, `p99`, `error_rate`, `status`, `config_yaml`, `json_path`.
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
- `POST /api/runs` does not spawn an Artillery process yet.
- `metrics_1h` and `metrics_1d` use `avg(...)` over already-aggregated percentiles; they are approximations rather than recomputed percentiles.
- Docker Compose publishes port `3000` only; the gRPC port `3001` is not exposed by the default stack.
