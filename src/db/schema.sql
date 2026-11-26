CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw hypertable
CREATE TABLE IF NOT EXISTS metrics (
  time             TIMESTAMPTZ NOT NULL,
  run_id           TEXT NOT NULL,
  endpoint         TEXT,
  rps              DOUBLE PRECISION,
  p50              DOUBLE PRECISION,
  p95              DOUBLE PRECISION,
  p99              DOUBLE PRECISION,
  error_rate       DOUBLE PRECISION,
  -- Per-bucket VU counters (deltas within the interval). Summed by the
  -- CAGGs so the UI can derive cumulative VUsers-active/error-count.
  vusers_started   BIGINT,
  vusers_stopped   BIGINT,
  vusers_created   BIGINT,
  vusers_completed BIGINT,
  error_count      BIGINT,
  -- Raw response-time histogram quantiles (for CDF/histogram charts).
  hist_min         DOUBLE PRECISION,
  hist_max         DOUBLE PRECISION,
  hist_p75         DOUBLE PRECISION,
  hist_p90         DOUBLE PRECISION,
  hist_p999        DOUBLE PRECISION
);

-- Existing volumes picked up before the columns existed: upgrade in place.
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS vusers_started   BIGINT;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS vusers_stopped   BIGINT;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS vusers_created   BIGINT;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS vusers_completed BIGINT;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS error_count      BIGINT;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS hist_min         DOUBLE PRECISION;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS hist_max         DOUBLE PRECISION;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS hist_p75         DOUBLE PRECISION;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS hist_p90         DOUBLE PRECISION;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS hist_p999        DOUBLE PRECISION;

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
  failure_reason  TEXT,
  partial_data    BOOLEAN NOT NULL DEFAULT FALSE,
  dropped_points  BIGINT NOT NULL DEFAULT 0,
  config_yaml     TEXT,
  json_path       TEXT
);

-- Existing volumes: upgrade in place.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS partial_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS dropped_points BIGINT NOT NULL DEFAULT 0;

-- Continuous Aggregates (hierarchical)
-- NOTE: GROUP BY is positional on purpose. `GROUP BY bucket` in the 1h/1d
-- views resolves to the *source* CAGG's bucket column (not the new
-- time_bucket output), which makes TimescaleDB reject the definition with
-- "continuous aggregate view must include a valid time bucket function".
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_10s
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('10 seconds', time) AS bucket,
  run_id,
  endpoint,
  avg(rps)        AS rps,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY p50)  AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY hist_p75) AS hist_p75,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY hist_p90) AS hist_p90,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY p95)  AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY p99)  AS p99,
  percentile_cont(0.999) WITHIN GROUP (ORDER BY hist_p999) AS hist_p999,
  min(hist_min) AS hist_min,
  max(hist_max) AS hist_max,
  avg(error_rate) AS error_rate,
  sum(vusers_started)   AS vusers_started,
  sum(vusers_stopped)   AS vusers_stopped,
  sum(vusers_created)   AS vusers_created,
  sum(vusers_completed) AS vusers_completed,
  sum(error_count)      AS error_count,
  count(*)        AS samples
FROM metrics
GROUP BY 1, 2, 3
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  run_id,
  endpoint,
  avg(rps)        AS rps,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY p50)  AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY hist_p75) AS hist_p75,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY hist_p90) AS hist_p90,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY p95)  AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY p99)  AS p99,
  percentile_cont(0.999) WITHIN GROUP (ORDER BY hist_p999) AS hist_p999,
  min(hist_min) AS hist_min,
  max(hist_max) AS hist_max,
  avg(error_rate) AS error_rate,
  sum(vusers_started)   AS vusers_started,
  sum(vusers_stopped)   AS vusers_stopped,
  sum(vusers_created)   AS vusers_created,
  sum(vusers_completed) AS vusers_completed,
  sum(error_count)      AS error_count,
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
  avg(hist_p75)   AS hist_p75,
  avg(hist_p90)   AS hist_p90,
  avg(p95)        AS p95,
  avg(p99)        AS p99,
  avg(hist_p999)  AS hist_p999,
  min(hist_min)   AS hist_min,
  max(hist_max)   AS hist_max,
  avg(error_rate) AS error_rate,
  sum(vusers_started)   AS vusers_started,
  sum(vusers_stopped)   AS vusers_stopped,
  sum(vusers_created)   AS vusers_created,
  sum(vusers_completed) AS vusers_completed,
  sum(error_count)      AS error_count,
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
  avg(hist_p75)   AS hist_p75,
  avg(hist_p90)   AS hist_p90,
  avg(p95)        AS p95,
  avg(p99)        AS p99,
  avg(hist_p999)  AS hist_p999,
  min(hist_min)   AS hist_min,
  max(hist_max)   AS hist_max,
  avg(error_rate) AS error_rate,
  sum(vusers_started)   AS vusers_started,
  sum(vusers_stopped)   AS vusers_stopped,
  sum(vusers_created)   AS vusers_created,
  sum(vusers_completed) AS vusers_completed,
  sum(error_count)      AS error_count,
  sum(samples)    AS samples
FROM metrics_1h
GROUP BY 1, 2, 3
WITH NO DATA;

-- Refresh policies
SELECT add_continuous_aggregate_policy('metrics_10s',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '10 seconds',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);

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
ALTER MATERIALIZED VIEW metrics_10s SET (timescaledb.materialized_only = false);
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
