# Data model

Source of truth: [`src/db/schema.sql`](../src/db/schema.sql). TimescaleDB stores raw metric points, run metadata, and continuous aggregates used by the REST API and dashboard.

## `metrics` (raw hypertable)

`metrics` is a TimescaleDB hypertable partitioned by `time` (1-day chunks) with an index on `(run_id, time DESC)`.

| Column | Type | Description |
| --- | --- | --- |
| `time` | `TIMESTAMPTZ` | Sample timestamp (UTC). |
| `run_id` | `TEXT` | Run identifier. |
| `endpoint` | `TEXT` | Endpoint/scenario label. Aggregate rows use `''`; per-endpoint rows use the URL/request name reported by `metrics-by-endpoint`. |
| `rps` | `DOUBLE PRECISION` | Requests per second for the bucket/point. |
| `p50`, `p95`, `p99` | `DOUBLE PRECISION` | Latency percentiles in the units supplied by the producer (typically ms). |
| `error_rate` | `DOUBLE PRECISION` | Error rate (e.g. `0.01` = 1%). Aggregate rows are VU-based; per-endpoint rows are request-based. |
| `vusers_started`, `vusers_stopped`, `vusers_created`, `vusers_completed` | `BIGINT` (nullable) | Per-bucket VU counter deltas. |
| `error_count` | `BIGINT` (nullable) | Absolute error count for the bucket/point. |
| `hist_min`, `hist_max`, `hist_p75`, `hist_p90`, `hist_p999` | `DOUBLE PRECISION` (nullable) | Additional histogram/quantile values for charts/derived views. |

Notes:
- All ingestion paths normalize to domain `MetricPoint`s and write through the flusher (no direct inserts from routes/consumers).
- `db:init` includes `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements to upgrade existing volumes in place; continuous aggregates may need to be dropped/recreated to expose new columns depending on the change.

## `runs` (metadata)

`runs` stores one row per run.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `TEXT` PK | Run identifier (client-supplied or generated UUID). |
| `started_at` | `TIMESTAMPTZ` | Start time (default `now()`). |
| `duration_ms` | `BIGINT` (nullable) | Run duration. |
| `total_requests` | `BIGINT` (nullable) | Total requests/counters aggregate for the run. |
| `p50`, `p95`, `p99` | `DOUBLE PRECISION` (nullable) | Run-level latency aggregates. |
| `error_rate` | `DOUBLE PRECISION` (nullable) | Run-level error rate aggregate. |
| `status` | `TEXT` | `running`, `completed`, or `failed`. |
| `failure_reason` | `TEXT` (nullable) | Why a run ended abnormally when known (e.g. `start_failed`, `spawn_error`, `artillery_exit_nonzero`, `report_processing_failed`, `killed`, `ring_overflow`, `flush_failed`, `ingest_disconnected`). |
| `partial_data` | `BOOLEAN` | Indicates ingestion/data loss or incomplete stream for the run. |
| `dropped_points` | `BIGINT` | Best-effort count of dropped points attributed to the run. |
| `config_yaml` | `TEXT` (nullable) | Optional script/config metadata stored with the run. |
| `json_path` | `TEXT` (nullable) | Persisted Artillery report path for orchestrated runs. |

`runs` may be inserted by orchestration (`POST /api/runs`) or referenced implicitly by externally ingested metrics; APIs tolerate runs that exist only as metric `run_id`s in some flows.

## Continuous aggregates

Rollups are built over `metrics` and queried by `/api/runs/:id/metrics` (and compare/overview flows).

| View | Bucket | Built from | Materialization |
| --- | --- | --- | --- |
| `metrics_10s` | 10 seconds | `metrics` | `timescaledb.materialized_only = false` |
| `metrics_1m` | 1 minute | `metrics` | `timescaledb.materialized_only = false` |
| `metrics_1h` | 1 hour | `metrics_1m` | `timescaledb.materialized_only = false` |
| `metrics_1d` | 1 day | `metrics_1h` | materialized-only |

Notes:
- `10s/1m/1h` include recent unmaterialized data for fresher reads; `1d` remains materialized-only.
- Coarse rollups (`1h`, `1d`) aggregate already-aggregated percentiles (e.g. via `avg(...)`), so they are approximations rather than exact recomputed percentiles from raw samples.
- Only `10s`, `1m`, `1h`, and `1d` are valid API granularities. Query code selects views via `sql.identifier(...)` from an allow-list.

## Retention and compression policies

Defined in [`src/db/schema.sql`](../src/db/schema.sql) (not environment-configurable today):

- Compression policy: compress raw `metrics` chunks older than **7 days**.
- Retention policy: drop raw `metrics` older than **90 days**.
- Continuous aggregate refresh policies are configured per view in the schema.

## Example query

```sql
SELECT bucket, endpoint, rps, p95, error_rate
FROM metrics_1m
WHERE run_id = 'run-123'
ORDER BY bucket;
```
