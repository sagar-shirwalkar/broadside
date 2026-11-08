# Broadside

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](LICENSE)

Dashboard for Artillery-generated data.

Broadside is a self-hosted backend and dashboard for [Artillery](https://www.artillery.io/) load-test metrics. Artillery can produce detailed results, but the FOSS toolchain does not include a long-term metrics dashboard. Broadside accepts Artillery-shaped metrics over WebSocket, [Connect/gRPC](https://connectrpc.com/docs/node/getting-started/), or [Kafka](https://kafka.apache.org/), buffers them, and stores them in [TimescaleDB](https://docs.timescale.com/) so runs, RPS, latency percentiles, and error rates can be queried across time.

> **Project status:** backend-first. Ingestion, buffering, storage, continuous aggregates, and the REST API are implemented. The `ui/` directory is a placeholder, and run orchestration (`POST /api/runs` spawning Artillery) is still a TODO.
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

Broadside does **not** include authentication or authorization. Treat the REST, WebSocket, and gRPC ports as trusted internal services:

- Bind the service to localhost or run it behind an authenticated reverse proxy with TLS.
- Do not expose the ingestion ports directly to untrusted networks.
- Keep `DATABASE_URL` and other credentials in `.env`; never commit them.
- The ring buffer bounds memory use, but when it is full Broadside drops the oldest samples rather than slowing ingestion.

## Background

[Artillery](https://www.artillery.io/) is an open-source load-testing tool. It can emit per-endpoint metrics such as requests per second, latency percentiles, and error rates, but the FOSS distribution does not ship with a persistent metrics dashboard. Broadside fills that gap with a small service that:

1. Accepts metrics without blocking on database writes.
2. Stores them in a time-series database built for high-volume append and range queries.
3. Pre-aggregates them into `1m`, `1h`, and `1d` rollups.
4. Exposes the data through a simple REST API.

The dashboard UI is intentionally not implemented yet; the backend is designed so a UI can be added without changing the ingestion contract.

## Install

### Requirements

- [Node.js](https://nodejs.org/) 22+ (the Docker image uses Node 22; CI uses Node 24)
- [pnpm](https://pnpm.io/) 12.18+
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for TimescaleDB)
- `psql` on your `PATH` for `pnpm task db:init`
- Ports `3000` (REST/WebSocket) and `3001` (gRPC) available

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

4. Verify that the service is healthy:

   ```bash
   curl -s http://localhost:3000/api/health
   ```

   A healthy response looks like:

   ```json
   {
     "status": "ok",
     "uptime": 12.3,
     "flusher": { "buffered": 0, "dropped": 0, "flushed": 42 },
     "timestamp": "2026-11-08T12:00:00.000Z"
   }
   ```

## Usage

### Start the server

```bash
pnpm task dev      # REST + WebSocket on :3000, gRPC on :3001
pnpm task lint     # type-check with tsc --noEmit
pnpm task --list   # see every task
```

To build the server:

```bash
pnpm build
```

`pnpm task build` also tries to build the UI. Until `ui/` contains a real app, use `pnpm build` for the server.

### Register a run (optional)

Register run metadata before sending metrics:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{
    "id": "run-123",
    "config": "config:\n  target: https://example.com\n  phases:\n    - duration: 60\n      arrivalRate: 5\n"
  }'
```

Metrics can also be sent without pre-registering a run; the metric queries use `run_id` directly.

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
| `GET` | `/api/runs` | List the 100 most recent runs. |
| `GET` | `/api/runs/:id` | Fetch one run, or `404` if it does not exist. |
| `GET` | `/api/runs/:id/metrics` | Aggregated metrics from the `1m`, `1h`, or `1d` continuous aggregate. |
| `GET` | `/api/runs/:id/raw` | Raw metric points, limited to 100,000 rows. |
| `POST` | `/api/runs` | Register run metadata with `{ "id": "...", "config": "..." }`. Does **not** launch Artillery yet. |
| `GET` | `/api/health` | Health, uptime, and flusher statistics. |
| `WS` | `/ws` | JSON metric ingestion. |

### Query parameters

`GET /api/runs/:id/metrics` and `GET /api/runs/:id/raw` accept:

| Parameter | Applies to | Type | Description |
| --- | --- | --- | --- |
| `granularity` | `/metrics` | `1m`, `1h`, or `1d` | Rollup view. Defaults to `1m`. |
| `from` | both | ISO 8601 timestamp | Inclusive lower bound. Optional. |
| `to` | both | ISO 8601 timestamp | Inclusive upper bound. Optional. |

Example:

```bash
curl "http://localhost:3000/api/runs/run-123/metrics?granularity=1m&from=2026-01-01T00:00:00Z"
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
| `endpoint` | `TEXT` | Endpoint or scenario label. |
| `rps` | `DOUBLE PRECISION` | Requests per second. |
| `p50`, `p95`, `p99` | `DOUBLE PRECISION` | Latency percentiles, in the units supplied by the load generator (typically milliseconds). |
| `error_rate` | `DOUBLE PRECISION` | Error rate as supplied by the load generator (for example, `0.01` for 1%). |

The table is a TimescaleDB hypertable with one-day chunks and an index on `(run_id, time DESC)`.

### `runs` (metadata)

Stores `id`, `started_at`, `duration_ms`, `total_requests`, `p50`, `p95`, `p99`, `error_rate`, `status`, `config_yaml`, and `json_path`.

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
| `KAFKA_BROKERS` | empty (disabled) | Comma-separated Kafka brokers. Setting this enables the consumer. |
| `KAFKA_TOPIC` | `artillery.metrics` | Kafka topic to consume. |
| `RING_CAPACITY` | `16384` | Ring buffer capacity. Rounded up to the next power of two. |
| `FLUSH_BATCH_SIZE` | `5000` | Maximum points per database insert, and the size that triggers an early flush. |
| `FLUSH_INTERVAL_MS` | `500` | How often the flusher drains the ring buffer. |

### Commands

| Command | Description |
| --- | --- |
| `pnpm task setup` | First-time install, proto generation, DB start, and schema init. |
| `pnpm task dev` | Run the server in watch mode. |
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
  types.ts              # shared domain types
  server/
    app.ts              # Hono app, /ws ingestion, route mounting
    grpc.ts             # Connect/gRPC service implementation
    kafka.ts            # optional Kafka consumer
    routes/             # REST handlers
  lib/
    normalize.ts        # JSON → MetricPoint
    ring-buffer.ts      # fixed-size drop-oldest buffer
    flusher.ts          # batch writes to TimescaleDB
    fplib/              # standalone functional utilities (not wired in)
  db/
    client.ts           # postgres.js client
    schema.sql          # hypertable, runs, continuous aggregates
  gen/                  # buf-generated protobuf TypeScript (do not edit)
test/                   # Vitest unit and integration tests
proto/metrics/v1/ingest.proto
ui/                     # placeholder for the dashboard
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

- The dashboard UI is not implemented (`ui/` only contains a placeholder).
- `POST /api/runs` does not spawn or stream an Artillery process yet.
- `metrics_1h` / `metrics_1d` aggregate already-aggregated percentiles with `avg(...)`; they are approximations, not recomputed percentiles from raw data.
- The Docker Compose stack publishes the REST/WS port (`3000`) but not the gRPC port (`3001`).
- There is no authentication; see [Security](#security).

### Planned work

- [ ] Implement the dashboard UI in `ui/`.
- [ ] Add Artillery run orchestration and live result streaming.
- [ ] Make retention, compression, and refresh policies configurable.
- [ ] Publish the gRPC port in the Docker Compose stack.
- [ ] Add authentication or document a recommended reverse-proxy setup.

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
