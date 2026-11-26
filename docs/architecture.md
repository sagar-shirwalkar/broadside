# Architecture

## Overview

Broadside ingests Artillery-style metric points, buffers them in memory, and writes them to TimescaleDB for querying and dashboard visualization. It supports metric ingestion over WebSocket (`/ws`), Connect/gRPC, and optional Kafka; can orchestrate Artillery runs via `POST /api/runs`; and serves a REST API plus the Lit dashboard UI.

The system is designed around a **validated ingestion boundary**, **buffered/batched writes**, and **TimescaleDB hypertables + continuous aggregates** for time-series storage and rollups.

## Runtime topology and roles

Broadside runs as a Node.js/TypeScript process with role-based behavior controlled by `SERVICE_ROLE` (`src/config.ts`, `src/index.ts`):

| Role | Responsibilities | Typical deployment |
| --- | --- | --- |
| `all` | API/UI/control plane, `/ws` ingest, optional dedicated in-process ingest listener (`INGEST_PORT`), gRPC, and Kafka consumer (if enabled) | Local/dev single-process mode |
| `api` | REST/UI/control plane and gRPC (no ingest listeners/consumer role) | Dashboard/API replica in split deployments |
| `ingest` | Dedicated `/ws` ingest server, flusher/ingest pipeline, Kafka consumer (if enabled) | Isolated ingest replica/container |

### Process startup (current behavior)

- `src/index.ts` starts the global `metricsFlusher` and `ingestTracker` for process-local ingestion accounting, then starts role-appropriate servers.
- **`api`/`all`:** starts Hono HTTP server for REST/UI/WS (and in `all`, can also start a separate in-process ingest listener when `INGEST_PORT` is set and differs from `PORT`), plus HTTP/2 Connect/gRPC server on `PORT + 1`.
- **`ingest`:** starts a dedicated ingest HTTP server (WS + probes) on `INGEST_PORT` when set, otherwise `PORT`.
- **Kafka:** consumer startup is gated to `ingest`/`all` roles (not `api`).
- HTTP server tuning (`keepAliveTimeout`, `headersTimeout`, `requestTimeout`, `maxRequestsPerSocket`) is applied from `SERVER_*` config.

Graceful shutdown stops ingest tracking, drains/stops the flusher (best effort), stops Kafka, terminates active Artillery children, and closes servers/sockets.

## Deployment topology (split Compose stack)

`docker-compose.yml` defines a split stack:

- **`dashboard`** (`SERVICE_ROLE=api`): serves REST/UI and probes; depends on `db` and `ingest`.
- **`ingest`** (`SERVICE_ROLE=ingest`): dedicated ingest container/service for `/ws` and buffered writes.
- **`db`**: TimescaleDB.

The dashboard readiness endpoint can **aggregate service health** (dashboard process + ingest probe + database) so UI/ops can determine whether all core services are live/responsive. Liveness remains static.

## Ingestion paths and isolation

| Path | Entry point | Input | Notes |
| --- | --- | --- | --- |
| WebSocket `/ws` | `src/server/app.ts` (`createApp` / `createIngestApp`) | JSON `{ run_id, points[] }` or single point | Normalized/validated by `normalizeBatch` (`@zod/mini`) at boundary; size/batch caps enforced; may emit `slow_down` control frames under pressure. |
| Connect/gRPC | `src/server/grpc.ts` | Protobuf `MetricBatch` | `StreamMetrics` (client streaming) and `PushMetrics` (unary) map to domain `MetricPoint`s and ingest via flusher. |
| Kafka (optional) | `src/server/kafka.ts` | JSON `MetricBatch` | Enabled only when `KAFKA_BROKERS` is set; consumed in `ingest`/`all` roles. |
| Orchestrated run report | `src/server/routes/runs.ts` + `src/lib/artillery.ts` | Artillery JSON report | `POST /api/runs` spawns Artillery; report is parsed at process exit into points and ingested through the flusher. |

### Isolation tiers

1. **Same process, same port (`SERVICE_ROLE=all`, `INGEST_PORT=0`)**: simplest dev/default in-process mode.
2. **Same process, dedicated ingest listener (`SERVICE_ROLE=all`, `INGEST_PORT != PORT`)**: separates `/ws` accept/socket handling from REST/control/SSE on another port.
3. **Separate ingest process/container (`SERVICE_ROLE=ingest`, e.g. Compose `ingest` service)**: strongest isolation for event-loop, socket, and resource contention; dashboard/API runs separately.

## Write path and flusher

```text
ingest path
  -> normalize/validate (JSON boundaries)
  -> metricsFlusher.ingest(points)
  -> shard selection (FNV-1a hash-mod by run_id, FLUSH_SHARDS)
  -> per-shard RingBuffer<MetricPoint>
  -> flush on batch threshold or interval
  -> batch INSERT INTO metrics (postgres.js)
  -> TimescaleDB hypertable
```

### Buffering, sharding, and backpressure

- **Singleton flusher:** all ingestion paths must call `metricsFlusher.ingest(...)` (no direct DB inserts from routes/consumers).
- **Sharding:** `FLUSH_SHARDS` independent shards (default 4). Points are routed by `run_id` hash-mod so one hot/slow run is less likely to block others.
- **Ring buffers:** fixed-capacity, drop-oldest buffers per shard. When full, oldest points are dropped and counted (ingest is not blocked on DB).
- **Flush behavior:** periodic and threshold-triggered flushes; failed inserts may be requeued (or dropped with accounting during shutdown paths) to protect process stability.
- **Backpressure signaling:** when ring depth exceeds `INGEST_SLOWDOWN_THRESHOLD`, WS ingest may emit a best-effort control frame `{"type":"slow_down","target_hz":1}` and increments telemetry (`slowDownSent`). Producers must opt in to honor it.

### Telemetry and loss accounting

Flusher/readiness telemetry includes buffered/dropped/flushed counts, DB write errors, flush latency and ring-depth summaries, slow-down counters, and shard count.

Best-effort per-run loss accounting persists:
- **`dropped_points`**: attributed dropped count increments
- **`partial_data`**: set when loss/incomplete ingest is detected
- **`failure_reason`**: preserved if already set, otherwise set (e.g. `ring_overflow`, `flush_failed`)

## Run lifecycle and orchestration

`src/lib/artillery.ts` manages orchestrated runs:

1. `POST /api/runs` validates input (`script_path`, traversal checks, config/body limits), rejects duplicate active IDs (`409`) and capacity exhaustion (`429`), inserts `runs` row as `running`.
2. Spawns `artillery run <script> --output <tmp>/report.json --quiet` (plus args). Active runs are tracked in-memory.
3. On clean exit, report is parsed into points, ingested via flusher, copied to `ARTILLERY_REPORT_DIR`, and run marked `completed` (clearing `failure_reason` as appropriate).
4. Failures (spawn/start/report/DB/exit) mark run `failed` with a `failure_reason` (e.g. `start_failed`, `spawn_error`, `artillery_exit_nonzero`, `report_processing_failed`, `killed`). Temp artifacts are cleaned up.
5. Kill/delete paths and settled guards prevent double-processing of close/error events.

### Report parsing highlights

- Accepts both `period` and `timestamp` bucket keys and compatible histogram/summary shapes across Artillery versions.
- Emits aggregate (`endpoint: ""`) and per-endpoint points when `metrics-by-endpoint` data is present.
- Per-endpoint RPS is derived from bucket request share and measured request rate; endpoint error rates are request-based, aggregate error rate is VU-based.

## Ingest stall detection (`ingest_disconnected`)

`src/lib/ingest-tracker.ts` tracks last-seen timestamps for runs receiving WS-ingested points. If a tracked running run stalls beyond `INGEST_STALL_TIMEOUT_MS`, it is marked **failed** with `failure_reason = "ingest_disconnected"` and `partial_data = true` (best-effort heuristic). Runs without WS ingest activity are not falsely flagged solely for lacking heartbeats.

## Query/read path

- **Raw points:** `/api/runs/:id/raw` reads from the `metrics` hypertable (bounded).
- **Aggregated metrics:** `/api/runs/:id/metrics` and compare flows read from continuous aggregates `metrics_10s|1m|1h|1d` (allow-listed; selected via `sql.identifier`).
- **Live stream:** `/api/runs/:id/live` tails raw `metrics` via SSE with keyset pagination over `(time, COALESCE(endpoint, ''))` to deliver rows sharing timestamps; emits `metric` events and a terminal `run` event.
- **Overview:** `/api/overview` computes SLO/trend/frequency/worst/regression/recent-run aggregates from `runs` and rollups.

### Probes and health semantics

- **Liveness:** `/api/health`, `/api/health/live`, `/livez` are static/no-DB probes.
- **Readiness:** `/api/health/ready`, `/readyz` return DB + flusher telemetry and aggregate service health. In split deployments the dashboard readiness probes the ingest service and reports per-service status; returns `503` when unhealthy/degraded.
- UI topbar health badge consumes `/readyz` and treats all required services healthy as `healthy`, otherwise `broken`.

## HTTP/API composition

`src/server/app.ts` wires middleware/routes (structured logging, security headers/CSP, compression, CORS before auth), auth for `/api/runs/*` and `/ws` (when enabled), route mounting (`/api/runs`, `/api/health`, `/api/overview`, `/ws`), probe aliases, static UI serving from `UI_DIST_DIR` (`ui/dist` by default), and SPA fallback behavior.

Auth is a shared Bearer token (`API_TOKEN`, opt-in). gRPC port does not enforce this token check.

## UI architecture (high level)

The dashboard in `ui/` is a Lit/Vite app following TEA/MVU conventions (`core/`, `app/`, `features/`, `components/`, `services/`, `styles/`). It consumes REST/SSE APIs, uses hash routing, and is served by the API server in production builds (or proxied in Vite dev mode).

## Known implementation notes / gaps

- Kafka consumer startup is role-gated in `index.ts` to `ingest`/`all`; keep it that way to avoid duplicate/incorrect consumption on API-only replicas.
- In-memory flusher buffers and active run tracking are process-local; restarts can lose in-flight buffered points and in-memory run handles.
- `metrics_1h`/`metrics_1d` percentile rollups are approximations over aggregated values.
- Dashboard automated tests do not pixel-assert chart rendering.
- gRPC port is not exposed by default Compose publishing and lacks Bearer-token enforcement.
