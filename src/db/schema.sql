CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw hypertable
CREATE TABLE IF NOT EXISTS metrics (
  time        TIMESTAMPTZ NOT NULL,
  run_id      TEXT NOT NULL,
  endpoint    TEXT,
  rps         DOUBLE PRECISION,
  p50         DOUBLE PRECISION,
  p95         DOUBLE PRECISION,
  p99         DOUBLE PRECISION,
  error_rate  DOUBLE PRECISION
);

SELECT create_hypertable('metrics', 'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_metrics_run_time
  ON metrics (run_id, time DESC);

-- Runs metadata
CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms     INTEGER,
  total_requests  BIGINT,
  p50             DOUBLE PRECISION,
  p95             DOUBLE PRECISION,
  p99             DOUBLE PRECISION,
  error_rate      DOUBLE PRECISION,
  status          TEXT NOT NULL DEFAULT 'running',
  config_yaml     TEXT,
  json_path       TEXT
);

-- Continuous Aggregates (hierarchical)
-- NOTE: GROUP BY is positional on purpose. `GROUP BY bucket` in the 1h/1d
-- views resolves to the *source* CAGG's bucket column (not the new
-- time_bucket output), which makes TimescaleDB reject the definition with
-- "continuous aggregate view must include a valid time bucket function".
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  run_id,
  endpoint,
  avg(rps)        AS rps,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY p50)  AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY p95)  AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY p99)  AS p99,
  avg(error_rate) AS error_rate,
  count(*)        AS samples
FROM metrics
GROUP BY 1, 2, 3
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', bucket) AS bucket,
  run_id,
  endpoint,
  avg(rps)        AS rps,
  avg(p50)        AS p50,
  avg(p95)        AS p95,
  avg(p99)        AS p99,
  avg(error_rate) AS error_rate,
  sum(samples)    AS samples
FROM metrics_1m
GROUP BY 1, 2, 3
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', bucket) AS bucket,
  run_id,
  endpoint,
  avg(rps)        AS rps,
  avg(p50)        AS p50,
  avg(p95)        AS p95,
  avg(p99)        AS p99,
  avg(error_rate) AS error_rate,
  sum(samples)    AS samples
FROM metrics_1h
GROUP BY 1, 2, 3
WITH NO DATA;

-- Refresh policies
SELECT add_continuous_aggregate_policy('metrics_1m',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('metrics_1h',
  start_offset => INTERVAL '12 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('metrics_1d',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- Real-time CAGGs (union materialized + live)
ALTER MATERIALIZED VIEW metrics_1m SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW metrics_1h SET (timescaledb.materialized_only = false);

-- Compression
ALTER TABLE metrics SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'run_id, endpoint'
);
SELECT add_compression_policy('metrics',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Retention
SELECT add_retention_policy('metrics',
  drop_after => INTERVAL '90 days',
  if_not_exists => TRUE
);
