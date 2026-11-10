# <p align="center">Broadside</p>

<p align="center"><strong>Self-hosted dashboard for <a href="https://www.artillery.io">Artillery</a> load-test metrics.</strong></p>

<div align="center">

[![Lit](https://img.shields.io/badge/Lit-324FFF?style=for-the-badge&logo=Lit&logoColor=white)](LIT)
[![Hono](https://img.shields.io/badge/hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](HONO)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-003B77?style=for-the-badge&logo=timescale&logoColor=white)](TIMESCALEDB)
[![GitHub License](https://img.shields.io/github/license/sagar-shirwalkar/broadside?style=for-the-badge&color=purple)](LICENSE)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/sagar-shirwalkar/broadside/ci.yml?style=for-the-badge&labelColor=black)](BUILD)

</div>

<div align="center">

<img width="2895" height="1719" alt="broadside-0 2 0-runs-full" src="https://github.com/user-attachments/assets/86f1aba3-480d-4db2-9559-1be7db1015bf" />

</div>

Broadside is a self-hosted backend and dashboard for [Artillery](https://www.artillery.io/) load-test metrics. Artillery can produce detailed results, but the FOSS toolchain does not include a long-term metrics dashboard. Broadside accepts Artillery-shaped metrics over WebSocket, [Connect/gRPC](https://connectrpc.com/docs/node/getting-started/), or [Kafka](https://kafka.apache.org/), buffers them, and stores them in [TimescaleDB](https://docs.timescale.com/) so runs, RPS, latency percentiles, and error rates can be queried across time.

> **Project status:** backend and dashboard are implemented. The Lit dashboard in `ui/` covers run management, charts, live streaming, and run comparison.
>
> _Last reviewed: 2026-11-08._

## Table of Contents

- [Security](#security)
- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Security

Broadside supports shared-secret Bearer authentication for the REST API (including the SSE live feed) and the `/ws` ingest endpoint, but it is **disabled by default**. Treat the REST, WebSocket, and gRPC ports as trusted internal services unless you set a token:

- Set `API_TOKEN` to require `Authorization: Bearer <token>` on `/api/runs/*`, `/api/runs/:id/live`, and `/ws`. `/api/health` stays public so load balancers can probe it. WebSocket and EventSource clients can fall back to `?token=`; prefer the header, since query strings end up in logs.
- Bind the service to localhost or run it behind an authenticated reverse proxy with TLS when serving beyond a trusted network. The gRPC port (`PORT + 1`) has no token check; keep it on a trusted network.
- Restrict browser access with `CORS_ORIGINS` (comma-separated allow-list, defaulting to the Vite dev server). Set `CORS_ORIGINS=*` only for deployments that accept any origin.
- Keep `DATABASE_URL`, `API_TOKEN`, and other credentials in `.env`; never commit them.
- The ring buffer bounds memory use, but when it is full Broadside drops the oldest samples rather than slowing ingestion.

## Background

[Artillery](https://www.artillery.io/) is an open-source load-testing tool. It can emit per-endpoint metrics such as requests per second, latency percentiles, and error rates, but the FOSS distribution does not ship with a persistent metrics dashboard. Broadside fills that gap with a small service that:

1. Launches Artillery runs and ingests their reports.
2. Accepts metrics without blocking on database writes.
3. Stores them in a time-series database built for high-volume append and range queries.
4. Pre-aggregates them into `1m`, `1h`, and `1d` rollups.
5. Exposes the data through a simple REST API.

The dashboard lives in `ui/` (Lit + Vite) and talks to the same REST API described below; it does not change the ingestion contract. Pages: **Overview** (`#/`, drift detection), **Runs** (`#/runs`), **Compare** (`#/compare`), and run detail (`#/runs/:id`).

## Install

### Requirements

- [Node.js](https://nodejs.org/) 22+ (the Docker image uses Node 22; CI uses Node 24)
- [pnpm](https://pnpm.io/) 12.18+
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for TimescaleDB)
  - Pull the TimescaleDB image ahead of time, e.g. to verify the CLI path works or to force an update instead of waiting for Compose:
    `docker pull timescale/timescaledb:latest-pg16`
    (`pnpm task db:up` pulls it implicitly on first run if it's missing.)
- `psql` on your `PATH` for `pnpm task db:init`
- Ports `3000` (REST/WebSocket) and `3001` (gRPC) available
- The [`artillery`](https://www.artillery.io/docs/get-started/install) CLI on your `PATH` if you want to launch runs through `POST /api/runs`

No global `task` or `buf` install is required; both come from dev dependencies.

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/your-org/broadside.git
   cd broadside
   ```

2. Create the environment file:

   ```bash
   cp .env.example .env
   # Edit .env if Postgres is not at localhost:5432
   ```

3. Run the one-command setup:

   ```bash
   pnpm task setup
   ```

   `setup` runs:

   | Step | Command | What it does |
   | --- | --- | --- |
   | Install | `pnpm install` | Installs server and tooling dependencies. |
   | Proto | `pnpm task proto` | Runs `buf generate` into `src/gen/` (already committed; a no-op unless protos changed). |
   | DB up | `pnpm task db:up` | Starts TimescaleDB with Docker Compose. |
   | DB wait | `pnpm task db:wait` | Polls `pg_isready` until the database accepts connections. |
   | DB init | `pnpm task db:init` | Applies `src/db/schema.sql` with `psql`. |

   `pnpm task setup` implies only the Docker database is started —
   **it does not start the API server or the dashboard.** If the
   database is ever stopped, bring it back with:

   ```bash
   pnpm task db:up        # docker compose up db -d
   pnpm task db:wait      # wait until pg_isready passes
   pnpm task db:init      # safe to re-run (schema is idempotent)
   ```

   Stop it with `pnpm task db:down`. The database also starts
   automatically as part of the full Docker stack
   (`pnpm task docker:up`).

4. Start the services:

   **Development** (server + Vite dashboard, side by side):

   ```bash
   pnpm task dev:full
   ```

   (`pnpm task dev` runs only the API server on `:3000` and gRPC on
   `:3001`; `pnpm task ui:dev` runs only the dashboard dev server on
   `:5173`, which proxies `/api` to `:3000`.)

   **Production** (single built artifact, no watch mode):

   ```bash
   pnpm task build          # server + dashboard (ui/dist)
   pnpm task db:up          # make sure TimescaleDB is running
   node dist/server.js      # or: pnpm task docker:up (server + DB + UI in Docker)
   ```

   The API server serves the built dashboard from `ui/dist` itself, so
   one process covers both; set `UI_DIST_DIR` to serve from elsewhere.
   In production you normally run the Docker stack:

   ```bash
   docker compose up --build -d   # dashboard + db
   docker compose logs -f         # tail logs
   docker compose down            # stop everything
   ```

5. Verify that the service is healthy:

   Wait for the API server to print its "listening" line, then:

   ```bash
   curl -s http://localhost:3000/api/health
   ```

   ```json
   {
     "status": "ok",
     "uptime": 12.3,
     "database": { "status": "ok" },
     "flusher": { "buffered": 0, "dropped": 0, "flushed": 42 },
     "timestamp": "2026-11-08T12:00:00.000Z"
   }
   ```

   If the database check says `panic`/`error`, the database is down —
   run `pnpm task db:up` and re-check. `docker compose logs db` shows
   the database log.

## Usage

### Start the server

```bash
pnpm task dev:full      # API on :3000 + dashboard on :5173
```

The dashboard opens on the **Overview** page (`#/`): SLO status, the
per-run p95/error-rate trend, run frequency, worst endpoints, recent
runs, and regression alerts. Use the sidebar for **Runs** (`#/runs`),
**Compare** (`#/compare`), or a run detail page (`#/runs/:id`).

```bash
pnpm task dev      # REST + WebSocket on :3000, gRPC on :3001
pnpm task ui:dev   # dashboard dev server on :5173 (proxies /api to :3000)
pnpm task lint     # type-check with tsc --noEmit
pnpm task --list   # see every task
```

To build:

```bash
pnpm task build    # server + dashboard (ui/dist)
pnpm build         # server only
```

The API server serves the built dashboard from `ui/dist` itself (set `UI_DIST_DIR` to change the directory), so a single process serves both. In development, run the Vite dev server on `:5173` and the API on `:3000` side by side (`pnpm task dev:full` runs both).

### Run a load test

Broadside can spawn Artillery, capture its JSON report, and store both aggregate and per-endpoint metrics. The `artillery` binary must be on the server's `PATH`.

| Feature | API | Behavior |
| --- | --- | --- |
| Start a run | `POST /api/runs` | Requires `script_path`. Inserts a `running` row, spawns `artillery run`, and returns `201` as soon as the process starts. Returns `500` if Artillery cannot start. |
| List runs | `GET /api/runs?limit=50&offset=0` | Paginated runs, newest first. `limit` defaults to 100 (max 100). |
| Check status | `GET /api/runs/:id` | `status` is `running`, `completed`, or `failed`. Completed runs include `duration_ms`, `total_requests`, percentiles, `error_rate`, and `json_path`. |
| List endpoints | `GET /api/runs/:id/endpoints` | Distinct non-aggregate endpoints in a run, with sample counts. |
| Read metrics | `GET /api/runs/:id/metrics` | Rollups with one row per endpoint per bucket, plus the aggregate row (`endpoint: ""`). Pass `endpoint` to filter. |
| Read raw points | `GET /api/runs/:id/raw` | Unaggregated points, limited to 100,000 rows. Pass `endpoint` to filter. |
| Stream live metrics | `GET /api/runs/:id/live` | Server-Sent Events feed of raw points as they are written, plus a terminal `run` event. |
| Compare runs | `GET /api/runs/compare?ids=a,b` | Run metadata plus one metric series per run for overlay charts. |
| Stop or delete | `DELETE /api/runs/:id` | A running run is sent `SIGTERM` and marked `failed`. A finished run and its metrics are deleted. |

Start a run:

```bash
curl -s -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{
    "id": "run-123",
    "script_path": "./load-test.yml",
    "extra_args": ["--environment", "staging"]
  }'
# {"id":"run-123","status":"running"}
```

`id` is optional; Broadside generates a UUID when it is omitted. `config` is optional free-form YAML stored in `runs.config_yaml`. `extra_args` is appended to the Artillery command line.

Check status and read the results:

```bash
curl -s http://localhost:3000/api/runs/run-123

# Per-endpoint 1-minute rollups
curl -s "http://localhost:3000/api/runs/run-123/metrics?granularity=1m"

# Only one endpoint
curl -s "http://localhost:3000/api/runs/run-123/metrics?granularity=1m&endpoint=/api/users"

# Endpoint tabs for the dashboard
curl -s http://localhost:3000/api/runs/run-123/endpoints

# Side-by-side comparison
curl -s "http://localhost:3000/api/runs/compare?ids=run-123,run-456"

# Paginate older runs
curl -s "http://localhost:3000/api/runs?limit=50&offset=100"
```

Stop a running test or delete a finished one:

```bash
curl -s -X DELETE http://localhost:3000/api/runs/run-123
# {"id":"run-123","status":"killed"}   # running
# {"id":"run-123","status":"deleted"}  # finished
```

#### What gets ingested

Artillery writes a JSON report to a temporary directory (`--output`), and Broadside processes it when the process exits:

- **Aggregate metrics** (`endpoint: ""`) come from `http.response_time`, `http.requests`, `http.request_rate`, and the `vusers.*` counters.
- **Per-endpoint metrics** come from the `metrics-by-endpoint` plugin (enabled by default since Artillery v2.0.1). The plugin publishes namespaced keys such as `plugins.metrics-by-endpoint.response_time./api/users` and `plugins.metrics-by-endpoint./api/users.codes.200`.
- Per-endpoint RPS scales the bucket's measured `http.request_rate` by each endpoint's share of `http.requests`, keeping per-endpoint and aggregate rates on the same basis.
- Per-endpoint error rate is `errors / (codes + errors)` for that endpoint. The aggregate error rate remains VU-based (`vusers.failed / vusers.created`).
- Reports generated without the plugin contain only aggregate data; Broadside then emits only the aggregate row.

Completed reports are copied to `ARTILLERY_REPORT_DIR` (default `data/reports`), and the destination is stored in `runs.json_path`. The temporary directory is removed after processing. Metrics can still be sent over WebSocket, gRPC, or Kafka without registering a run; those queries use `run_id` directly.

### Send metrics over WebSocket

Connect to `ws://localhost:3000/ws` and send a JSON batch. A single point (without a `points` array) is also accepted.

```js
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    run_id: "run-123",
    points: [
      {
        time_ms: Date.now(),
        endpoint: "/api/checkout",
        rps: 42.5,
        p50: 120,
        p95: 340,
        p99: 780,
        error_rate: 0.01
      }
    ]
  }));
};
```

### Receive live metrics (SSE)

`GET /api/runs/:id/live` is a Server-Sent Events stream for the dashboard. It tails the raw `metrics` hypertable for one run and emits:

| Event | Data | Meaning |
| --- | --- | --- |
| `metric` | Raw metric row (`time`, `endpoint`, `rps`, `p50`, `p95`, `p99`, `error_rate`) | A point written after the stream started (or after `from`). |
| `run` | Run status row | The run reached `completed` or `failed`; the stream then closes. |

```js
const source = new EventSource(
  "http://localhost:3000/api/runs/run-123/live?from=2026-01-01T00:00:00Z",
);

source.addEventListener("metric", (event) => {
  const point = JSON.parse(event.data);
  console.log(point.time, point.endpoint, point.p95);
});

source.addEventListener("run", (event) => {
  console.log("finished:", JSON.parse(event.data).status);
  source.close();
});
```

Optional query parameters: `from` / `to` (ISO 8601), `endpoint` (exact match), and `interval_ms` (poll interval, 100–60000, default `1000`). The stream reads raw rows with keyset pagination, so points written in the same millisecond (the aggregate row plus every endpoint in one Artillery bucket) are all delivered. Because the flusher batches writes every `FLUSH_INTERVAL_MS`, live data trails ingestion by roughly that interval.

> Orchestrated Artillery runs still parse their report when the process exits, so an SSE stream for a run started through `POST /api/runs` stays quiet until the run finishes. Live streaming is most useful for metrics pushed over WebSocket, gRPC, or Kafka.

### Send metrics over Kafka (optional)

Set `KAFKA_BROKERS` and publish JSON `MetricBatch` messages to `KAFKA_TOPIC` (default `artillery.metrics`):

```json
{
  "run_id": "run-123",
  "points": [
    {
      "time_ms": 1760000000000,
      "endpoint": "/api/checkout",
      "rps": 42.5,
      "p50": 120,
      "p95": 340,
      "p99": 780,
      "error_rate": 0.01
    }
  ]
}
```

### Read metrics

```bash
# List recent runs
curl -s http://localhost:3000/api/runs

# Read one run's 1-minute rollups
curl -s "http://localhost:3000/api/runs/run-123/metrics?granularity=1m"

# Read raw points for a time range
curl -s "http://localhost:3000/api/runs/run-123/raw?from=2026-01-01T00:00:00Z"
```

## API

### REST

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/runs` | Paginated runs, newest first (`limit`, `offset`). |
| `GET` | `/api/runs/compare` | Compare several runs (`ids=a,b,c`). |
| `GET` | `/api/runs/:id` | Fetch one run, or `404` if it does not exist. |
| `GET` | `/api/runs/:id/endpoints` | Distinct non-aggregate endpoints with sample counts. |
| `GET` | `/api/runs/:id/phases` | Artillery phase boundaries from the stored script config. |
| `GET` | `/api/runs/:id/metrics` | Aggregated metrics from the `1m`, `1h`, or `1d` continuous aggregate. |
| `GET` | `/api/runs/:id/raw` | Raw metric points, limited to 100,000 rows. |
| `GET` | `/api/runs/:id/live` | Server-Sent Events stream of raw points plus a terminal run event. |
| `POST` | `/api/runs` | Start an Artillery run with `{ "script_path": "...", "id"?, "config"?, "extra_args"? }`. |
| `DELETE` | `/api/runs/:id` | Kill a running run, or delete a finished run and its metrics. |
| `GET` | `/api/health` | Health, uptime, database check, and flusher statistics. Public (no token). Returns `503` when the database is unreachable. |
| `GET` | `/api/overview?days=<1\|7\|30>&frequency=<day\|week>` | Overview dashboard aggregates: SLO status, per-run p95/error-rate trend, run frequency, worst endpoints, regression alerts, and recent runs. Returns `meta` with the applied window/bucket. |
| `WS` | `/ws` | JSON metric ingestion. |

When `API_TOKEN` is set, the REST endpoints under `/api/runs` (including the SSE stream) and `/ws` require `Authorization: Bearer <token>`; `/api/health` does not. See [Security](#security).

### Query parameters

`GET /api/runs` accepts:

| Parameter | Type | Description |
| --- | --- | --- |
| `limit` | integer, 1–100 | Page size. Defaults to `100`. |
| `offset` | integer, ≥ 0 | Rows to skip. Defaults to `0`. |

`GET /api/runs/:id/metrics`, `GET /api/runs/:id/raw`, and `GET /api/runs/:id/live` accept:

| Parameter | Applies to | Type | Description |
| --- | --- | --- | --- |
| `granularity` | `/metrics` | `1m`, `1h`, or `1d` | Rollup view. Defaults to `1m`. |
| `from` | all | ISO 8601 timestamp | Inclusive lower bound. Optional. |
| `to` | all | ISO 8601 timestamp | Inclusive upper bound. Optional. |
| `endpoint` | all | string | Exact endpoint match. Use the empty string for the aggregate row. Optional. |
| `interval_ms` | `/live` | integer, 100–60000 | Poll interval. Defaults to `1000`. |

`GET /api/runs/compare` accepts `ids` (comma-separated, 2–10 runs, required), `granularity`, `from`, `to`, and `endpoint`.

Examples:

```bash
curl "http://localhost:3000/api/runs/run-123/metrics?granularity=1m&from=2026-01-01T00:00:00Z"
curl "http://localhost:3000/api/runs?limit=50&offset=100"
curl "http://localhost:3000/api/runs/compare?ids=run-123,run-456&granularity=1m"
```

### gRPC / Connect

The service is defined in [`proto/metrics/v1/ingest.proto`](proto/metrics/v1/ingest.proto) and listens on `http://localhost:3001` over HTTP/2.

| RPC | Type | Purpose |
| --- | --- | --- |
| `metrics.v1.Ingest/StreamMetrics` | Client streaming | Send a stream of `MetricBatch` messages. |
| `metrics.v1.Ingest/PushMetrics` | Unary | Send one `MetricBatch`. |

Generated TypeScript lives in `src/gen/metrics/v1/ingest_pb.ts`. Use the generated client with `@connectrpc/connect` and `@connectrpc/connect-node`, targeting port `3001`.

## Architecture

```text
Artillery / load generator
  ├── WebSocket  /ws (JSON)
  ├── gRPC       :3001 (StreamMetrics / PushMetrics)
  └── Kafka      optional, JSON MetricBatch
                    │
                    ▼
           normalize → MetricsFlusher
                    │  ring buffer (RING_CAPACITY)
                    ▼
     batch INSERT every FLUSH_INTERVAL_MS / FLUSH_BATCH_SIZE
                    │
                    ▼
        TimescaleDB `metrics` hypertable
                    │
                    ▼
   continuous aggregates: metrics_1m → metrics_1h → metrics_1d
                    │
                    ▼
              REST API /api/*
```

### Run orchestration

`POST /api/runs` validates `script_path`, inserts a `running` row, and calls `spawnArtillery` in `src/lib/artillery.ts`. Artillery runs with `--output <temp>/report.json --quiet`; its stderr is captured for failure messages, and the temporary directory is removed after processing.

When the process exits successfully, Broadside parses the report into `MetricPoint[]`, feeds them to the flusher, persists the raw JSON under `ARTILLERY_REPORT_DIR`, and updates the `runs` row to `completed`. A non-zero exit, spawn error, or report-processing error marks the row `failed` and logs the reason. Killing an active run sends `SIGTERM` and marks the row `failed` without ingesting a report. The in-memory `activeRuns` map guards against duplicate concurrent runs and prevents double-settling on `close`/`error` events.

### Write path

All ingestion paths call the singleton `MetricsFlusher`, which pushes points into a fixed-capacity ring buffer. A background flush drains the buffer every `FLUSH_INTERVAL_MS` or when it reaches `FLUSH_BATCH_SIZE`, then writes one batch to TimescaleDB. If the buffer is full, the oldest points are dropped and counted. If a database insert fails, the batch is re-queued.

### Query path

The REST layer reads from the raw `metrics` hypertable for `/raw` and from the `metrics_1m`, `metrics_1h`, or `metrics_1d` continuous aggregate for `/metrics`. The health endpoint reports the flusher's `buffered`, `dropped`, and `flushed` counters.

## Data model

### `metrics` (raw hypertable)

| Column | Type | Description |
| --- | --- | --- |
| `time` | `TIMESTAMPTZ` | Sample timestamp. |
| `run_id` | `TEXT` | Run identifier. |
| `endpoint` | `TEXT` | Endpoint or scenario label. Aggregate rows use the empty string; per-endpoint rows use the URL or request name reported by `metrics-by-endpoint`. |
| `rps` | `DOUBLE PRECISION` | Requests per second. |
| `p50`, `p95`, `p99` | `DOUBLE PRECISION` | Latency percentiles, in the units supplied by the load generator (typically milliseconds). |
| `error_rate` | `DOUBLE PRECISION` | Error rate as supplied by the load generator (for example, `0.01` for 1%). Aggregate rows use failed/created VUs; per-endpoint rows use failed requests / total requests. |

The table is a TimescaleDB hypertable with one-day chunks and an index on `(run_id, time DESC)`.

### `runs` (metadata)

Stores `id`, `started_at`, `duration_ms`, `total_requests`, `p50`, `p95`, `p99`, `error_rate`, `status`, `config_yaml`, and `json_path`. `status` is `running`, `completed`, or `failed`; `json_path` points at the persisted report for orchestrated runs.

### Continuous aggregates

| View | Built from | Purpose |
| --- | --- | --- |
| `metrics_1m` | `metrics` | One-minute rollups. |
| `metrics_1h` | `metrics_1m` | One-hour rollups. |
| `metrics_1d` | `metrics_1h` | One-day rollups. |

`metrics_1m` and `metrics_1h` include recent unmaterialized data (`timescaledb.materialized_only = false`); `metrics_1d` is materialized-only.

### Retention and compression

- Raw metrics are compressed after 7 days.
- Raw metrics are retained for 90 days.
- Retention, compression, and continuous-aggregate refresh policies are defined in [`src/db/schema.sql`](src/db/schema.sql), not environment variables.

Example query:

```sql
SELECT bucket, endpoint, rps, p95
FROM metrics_1m
WHERE run_id = 'run-123'
ORDER BY bucket;
```

## Development

### Configuration

All configuration is read in `src/config.ts` from environment variables (loaded from `.env` via `dotenv`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | REST/WebSocket port. gRPC listens on `PORT + 1`. |
| `DATABASE_URL` | — (required) | Postgres/TimescaleDB connection string. |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`). |
| `LOG_PRETTY` | `false` | Set to `true` to format logs with `pino-pretty` for local development. |
| `ARTILLERY_REPORT_DIR` | `data/reports` | Directory where completed Artillery JSON reports are persisted. |
| `ARTILLERY_MAX_CONCURRENT` | `4` | Max concurrently running Artillery children; `POST /api/runs` returns `429` past it. |
| `INGEST_MAX_MESSAGE_BYTES` | `1048576` | WebSocket messages larger than this are dropped. |
| `INGEST_MAX_BATCH_POINTS` | `50000` | Points per batch accepted from gRPC/Kafka producers. |
| `API_TOKEN` | empty (disabled) | Bearer token required on `/api/runs/*`, `/api/runs/:id/live`, and `/ws`. `/api/health` stays public. |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated browser origins allowed by CORS. `*` allows any origin. |
| `UI_DIST_DIR` | `ui/dist` | Directory the API server serves the dashboard from. Empty disables the UI. |
| `KAFKA_BROKERS` | empty (disabled) | Comma-separated Kafka brokers. Setting this enables the consumer. |
| `KAFKA_TOPIC` | `artillery.metrics` | Kafka topic to consume. |
| `RING_CAPACITY` | `16384` | Ring buffer capacity. Rounded up to the next power of two. |
| `FLUSH_BATCH_SIZE` | `5000` | Maximum points per database insert, and the size that triggers an early flush. |
| `FLUSH_INTERVAL_MS` | `500` | How often the flusher drains the ring buffer. |
| `SLO_P95_MS` | `400` | Headline p95 target for the Overview SLO strip ("p95 < 400ms: met in X% of last runs"). |
| `SLO_ERROR_RATE` | `0.01` | Error-ratio target for the Overview SLO strip (0.01 = 1%). |
| `SLO_WINDOW_RUNS` | `30` | How many recent completed runs back the SLO met-rate. |
| `SLO_REGRESSION_DELTA` | `1.2` | Regression alert threshold: latest run's p95 > rolling median × this factor (1.2 = +20%). |

### Logging

The server emits structured JSON logs with [Pino](https://getpino.io/). Hono's [`@hono/structured-logger`](https://github.com/honojs/middleware/tree/main/packages/structured-logger) middleware writes one entry per request with `method`, `path`, `status`, and `durationMs`; unhandled errors are logged with the serialized `err`. Application code uses the shared `logger` from `src/logger.ts` rather than `console`.

Set `LOG_PRETTY=true` for human-readable local logs. The production default is JSON.

### Commands

| Command | Description |
| --- | --- |
| `pnpm task setup` | First-time install, proto generation, DB start, and schema init. |
| `pnpm task dev` | Run the server in watch mode. |
| `pnpm task ui:dev` | Run the dashboard dev server (Vite, `:5173`). |
| `pnpm task ui:build` | Build the dashboard to `ui/dist`. |
| `pnpm task ui:test` | Run the UI unit tests (Vitest). |
| `pnpm task ui:test:e2e` | Run the UI end-to-end tests (Playwright, API stubbed). |
| `pnpm task lint` | Type-check with `tsc --noEmit`. |
| `pnpm test` | Run the Vitest suite once. |
| `pnpm test:coverage` | Run tests with the 80% coverage gate. |
| `pnpm build` | Compile the server to `dist/`. |
| `pnpm task proto` | Regenerate TypeScript from protos. |
| `pnpm task proto:check` | CI gate: fail if `src/gen/` is stale. |
| `pnpm task db:up` / `db:down` | Start / stop TimescaleDB. |
| `pnpm task db:init` | Apply `src/db/schema.sql`. |
| `pnpm task db:logs` | Tail database logs. |
| `pnpm task docker:build` / `docker:up` / `docker:down` | Build / run / stop the Docker stack. |
| `pnpm task clean` | Remove `dist`, `ui/dist`, and `.task`. |

### Project layout

```text
src/
  index.ts              # HTTP/WS + HTTP/2 gRPC bootstrap
  config.ts             # environment configuration
  logger.ts             # shared Pino logger
  types.ts              # shared domain types
  server/
    app.ts              # Hono app, /ws ingestion, route mounting
    grpc.ts             # Connect/gRPC service implementation
    kafka.ts            # optional Kafka consumer
    middleware/auth.ts  # Bearer token authentication
    routes/             # REST handlers
  lib/
    normalize.ts        # JSON → MetricPoint
    artillery.ts        # run orchestration + report parsing
    ring-buffer.ts      # fixed-size drop-oldest buffer
    flusher.ts          # batch writes to TimescaleDB
  db/
    client.ts           # postgres.js client
    schema.sql          # hypertable, runs, continuous aggregates
  gen/                  # buf-generated protobuf TypeScript (do not edit)
test/                   # Vitest unit and integration tests
proto/metrics/v1/ingest.proto
ui/                     # Lit dashboard (own package.json, Vite build → ui/dist)
  index.html            # entry point, meta, manifest
  public/               # favicon.svg, manifest.json
  src/                  # app shell, router, views, components, theme
```

### CI

The GitHub Actions workflow runs:

1. `pnpm task proto:check`
2. `pnpm task lint`
3. `pnpm test:coverage`
4. Server build
5. A Docker image build on pushes to `main`

## Roadmap

### Known limitations

- The dashboard is covered by Vitest unit tests and 9 Playwright E2E scenarios (API stubbed at the network layer); chart rendering itself is not pixel-asserted.
- `GET /api/runs/:id/live` streams points once they are written by the flusher. Orchestrated Artillery runs still produce their report at process exit, so their live stream stays quiet until the run finishes. The `artillery` binary must be installed on the host separately.
- `metrics_1h` / `metrics_1d` aggregate already-aggregated percentiles with `avg(...)`; they are approximations, not recomputed percentiles from raw data.
- The Docker Compose stack publishes the REST/WS port (`3000`) but not the gRPC port (`3001`).
- Authentication is an opt-in shared Bearer token (`API_TOKEN`), disabled by default; the gRPC port has no token check. See [Security](#security).

### Planned work

- [ ] Harden the dashboard: automated chart rendering tests, windowing for very long metric series.
- [ ] Stream Artillery metrics live instead of waiting for the final report. (`GET /api/runs/:id/live` already streams points as the flusher writes them; orchestrated reports still arrive at process exit.)
- [ ] Make retention, compression, and refresh policies configurable.
- [ ] Publish the gRPC port in the Docker Compose stack.
- [ ] Extend Bearer authentication to the gRPC port, or document a recommended reverse-proxy setup that covers it.

## Contributing

Contributions are welcome. For bugs, feature requests, or questions, open an issue on the repository. For larger changes, open an issue first so the approach can be discussed.

Before opening a pull request, run:

```bash
pnpm task proto:check
pnpm task lint
pnpm test:coverage
pnpm build
```

Keep changes focused, update the README when behavior or configuration changes, and do not edit generated files in `src/gen/` by hand.

## License

Broadside is licensed under the [Mozilla Public License 2.0](LICENSE).
