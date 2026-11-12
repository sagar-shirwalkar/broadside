# API reference

## Authentication and access

- **Auth (optional):** if `API_TOKEN` is set, `/api/runs/*` (including SSE `/api/runs/:id/live`) and `/ws` require `Authorization: Bearer <token>`.
  - WebSocket and SSE clients that cannot set headers may use `?token=`.
  - Health/readiness/liveness probes remain public: `/api/health`, `/api/health/live`, `/api/health/ready`, `/livez`, `/readyz`.
- **gRPC:** listens on HTTP/2 (`PORT + 1`, default `3001`) and does not enforce `API_TOKEN`. Keep it on a trusted network or protect it via infrastructure.
- **CORS:** controlled by `CORS_ORIGINS` (comma-separated allow-list; `*` allows any origin).

## REST endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/runs` | Paginated runs, newest first. Supports offset and cursor pagination. |
| `GET` | `/api/runs/compare` | Compare multiple runs (`ids=a,b,...`) with series data. |
| `GET` | `/api/runs/:id` | Fetch one run (`404` if not found). |
| `GET` | `/api/runs/:id/endpoints` | Distinct non-aggregate endpoints in a run with sample counts. |
| `GET` | `/api/runs/:id/phases` | Artillery phase annotations parsed from stored script config (empty if unavailable). |
| `GET` | `/api/runs/:id/metrics` | Aggregated metrics from `metrics_10s|metrics_1m|metrics_1h|metrics_1d`. |
| `GET` | `/api/runs/:id/raw` | Raw points from `metrics` hypertable (bounded limit). |
| `GET` | `/api/runs/:id/live` | SSE stream of raw metric points plus terminal run event. |
| `POST` | `/api/runs` | Start an orchestrated Artillery run. |
| `DELETE` | `/api/runs/:id` | Kill a running run or delete a finished run and its metrics. |
| `GET` | `/api/health` | Static liveness (no DB). |
| `GET` | `/api/health/live` | Static liveness alias. |
| `GET` | `/api/health/ready` | Readiness (DB + flusher telemetry; aggregate service health). |
| `GET` | `/livez` | Static liveness alias. |
| `GET` | `/readyz` | Readiness alias (recommended for probes/healthchecks). |
| `GET` | `/api/overview` | Overview dashboard aggregates (SLO/trends/frequency/worst/regressions/recent runs). |

## Query parameters

### `GET /api/runs`

| Parameter | Type | Description |
| --- | --- | --- |
| `limit` | integer (1–100) | Page size. Default `100`. |
| `offset` | integer (≥ 0) | Offset pagination. Default `0`. |
| `cursor` | string | Cursor pagination token (alternative to offset). |

Behavior notes:
- Stable ordering: `started_at DESC, id DESC`.
- Response includes pagination/cache headers such as `X-Pagination-Modes: offset,cursor`, `X-Next-Cursor` (when available), `ETag`, and `Cache-Control: private, max-age=5`.

### `GET /api/runs/:id/metrics`, `/raw`, `/live`

| Parameter | Applies to | Type | Description |
| --- | --- | --- | --- |
| `granularity` | `/metrics` | `10s`, `1m`, `1h`, `1d` | Rollup view. Default `1m`. |
| `from` | all | ISO 8601 | Inclusive lower bound. |
| `to` | all | ISO 8601 | Inclusive upper bound. |
| `endpoint` | all | string | Exact endpoint filter. Empty string targets aggregate row. |
| `interval_ms` | `/live` | integer (100–60000) | SSE poll interval. Default `1000`. |

### `GET /api/runs/compare`

| Parameter | Type | Description |
| --- | --- | --- |
| `ids` | comma-separated string | Required. 2–10 unique run IDs. |
| `granularity` | `10s`, `1m`, `1h`, `1d` | Rollup view. Default `1m`. |
| `from`, `to` | ISO 8601 | Optional time bounds. |
| `endpoint` | string | Optional exact endpoint filter. |

### `GET /api/overview`

| Parameter | Type | Description |
| --- | --- | --- |
| `days` | `1`, `7`, `30` | Trend window. Default `30`. |
| `frequency` | `day`, `week` | Run frequency bucket. Default `day`. |

## Run orchestration (`POST /api/runs`)

Request body:

```json
{
  "id": "optional-run-id",
  "script_path": "./load-test.yml",
  "config": "optional yaml/text metadata",
  "extra_args": ["--environment", "staging"]
}
```

Behavior highlights:
- `script_path` is required and validated (path traversal rejected).
- Returns `201` with `{ id, status: "running" }` once the process is spawned.
- Returns `409` for duplicate active run IDs, `429` when run concurrency capacity is reached, `413` for oversized config, and `500` on immediate spawn/start failures.
- Requires the `artillery` CLI on `PATH` (not bundled).
- Completed orchestrated reports are persisted under `ARTILLERY_REPORT_DIR` and referenced by `runs.json_path`.

`DELETE /api/runs/:id` kills an active run (marks failed, typically `failure_reason: "killed"`) or deletes a finished run and its metrics.

## Live metrics (SSE)

`GET /api/runs/:id/live` streams from the raw `metrics` table using keyset pagination over `(time, COALESCE(endpoint, ''))` to avoid skipping rows that share timestamps.

Events:
- **`metric`**: raw metric row payload (`time`, `endpoint`, `rps`, `p50`, `p95`, `p99`, `error_rate`, etc.)
- **`run`**: terminal run status snapshot when the run leaves `running`; stream closes afterward

Notes:
- Supports reconnect/replay from `from` (or epoch) because it resumes by cursor.
- Data lags ingestion by roughly flusher timing (`FLUSH_INTERVAL_MS`) because writes are buffered/batched.
- Orchestrated Artillery runs still produce report-derived points at process exit, so SSE for those runs may stay quiet until completion.

Example:

```bash
curl -N "http://localhost:3000/api/runs/<id>/live?interval_ms=1000"
```

## WebSocket ingest (`/ws`)

- Endpoint: `ws://<host>:<port>/ws` (main port, dedicated in-process `INGEST_PORT`, or dedicated ingest service depending on deployment).
- Auth: Bearer token when `API_TOKEN` is set (`Authorization` header or `?token=` fallback).
- Payloads: JSON batch `{ run_id, points: [...] }` or a single point object.
- Points are normalized/validated at the boundary; malformed payloads are rejected (`invalid message`).
- Message and batch sizes are bounded (`INGEST_MAX_MESSAGE_BYTES`, `INGEST_MAX_BATCH_POINTS`).

### Backpressure control frame

When ingest pressure is high, the server may emit:

```json
{ "type": "slow_down", "target_hz": 1 }
```

This is a best-effort hint (counted in flusher telemetry as `slowDownSent`). Producers should adapt their send rate if they implement this protocol.

Example producer:

```js
const ws = new WebSocket("ws://localhost:3000/ws");
ws.onopen = () => {
  ws.send(JSON.stringify({
    run_id: "run-123",
    points: [{
      time_ms: Date.now(),
      endpoint: "/api/checkout",
      rps: 42.5,
      p50: 120,
      p95: 340,
      p99: 780,
      error_rate: 0.01
    }]
  }));
};
```

## Kafka ingest (optional)

Enabled when `KAFKA_BROKERS` is set (topic defaults to `artillery.metrics` via `KAFKA_TOPIC`).

- Messages are JSON `MetricBatch` objects (`run_id`, `points[]`).
- Intended to run in `ingest`/`all` service roles (not `api`-only) so ingestion and flusher responsibilities stay on ingest-capable processes.

Example message:

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

## gRPC / Connect

Defined in [`proto/metrics/v1/ingest.proto`](../proto/metrics/v1/ingest.proto), served on HTTP/2 at `PORT + 1` (default `3001`).

| RPC | Type | Purpose |
| --- | --- | --- |
| `metrics.v1.Ingest/StreamMetrics` | Client streaming | Stream `MetricBatch` messages. |
| `metrics.v1.Ingest/PushMetrics` | Unary | Send one `MetricBatch`. |

Generated TypeScript: `src/gen/metrics/v1/ingest_pb.ts` (generated; do not edit by hand).

## Readiness payload highlights

`/readyz` and `/api/health/ready` return readiness details including:
- `healthy` / overall `status`
- `services` (aggregate service checks such as dashboard, ingest, database when available)
- `database` status
- `flusher` telemetry (buffered, dropped, flushed, db write errors, flush latency/depth, slow-down counters, shard info)

Use readiness for healthchecks and runtime diagnosis; use liveness for process-up checks.
