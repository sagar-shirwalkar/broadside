# Performance, tuning, and scaling

This guide covers runtime tuning, self-load caveats, and horizontal-scaling considerations for Broadside.

## Self-load warning

Running Broadside's load test against itself on the same host (especially Docker Desktop/macOS loopback) can saturate the **loopback/network stack, ephemeral ports, sockets, CPU, or VM limits** before saturating application logic. Artillery, API/control plane, `/ws` ingest, dashboard/SSE clients, and TimescaleDB may all contend for the same resources.

Symptoms that often indicate environment/socket pressure rather than application bugs:
- `ECONNRESET`, `EAGAIN`, `EPIPE` clustered at peak with **zero 5xx**
- p99 inflation before failures
- Truncated runs or UI/live-stream disconnects under local contention

Recommendations:
- Run a **clean baseline** profile first (keep-alive enabled, minimal/no ingest/DB path where possible).
- Compare baseline vs full self-load (ingest + dashboard + DB writes).
- Isolate ingest/control plane (`INGEST_PORT` in-process, or dedicated `ingest` service/container with `SERVICE_ROLE=ingest`).
- Validate production-like behavior on Linux hosts or separate machines/containers; treat Docker Desktop loopback self-load results cautiously.

## Artillery client tuning (keep-alive / pooling)

Connection reuse is critical to avoid TIME_WAIT and ephemeral-port churn.

Example:

```yaml
config:
  target: "http://localhost:3000"
  http:
    pool: 250          # tune to expected concurrency
    timeout: 10        # seconds
  phases:
    - duration: 25
      rampTo: 1000
    - duration: 20
      arrivalRate: 1000
    - duration: 20
      rampTo: 0
```

Guidelines:
- Size `http.pool` to expected peak concurrency (high enough for reuse, not unbounded).
- Align client/LB idle timeouts with server keep-alive settings.
- For self-benchmarking, minimize unnecessary metric/UI traffic when isolating server capacity.

## Broadside server and ingestion tuning

### HTTP server (`SERVER_*`)

- `SERVER_KEEP_ALIVE_TIMEOUT_MS` (default `65000`): keep-alive idle timeout. Set **above** client/LB idle timeout.
- `SERVER_HEADERS_TIMEOUT_MS` (default `66000`): must be greater than keep-alive timeout.
- `SERVER_REQUEST_TIMEOUT_MS` (default `120000`, `0` disables).
- `SERVER_MAX_REQUESTS_PER_SOCKET` (default `1000`, `0` disables): rotates sockets to bound per-connection creep.

### Ingestion/flusher (`RING_*`, `FLUSH_*`, `INGEST_*`)

- `INGEST_PORT`: dedicated in-process `/ws` ingest listener (separate accept/socket budget from REST/control/SSE).
- `INGEST_SERVICE_PORT`: compose port for the dedicated ingest container/service.
- `RING_CAPACITY`, `FLUSH_BATCH_SIZE`, `FLUSH_INTERVAL_MS`: control buffering, batch size, and flush cadence.
- `FLUSH_SHARDS`: independent flusher shards (hash-mod by `run_id`) to reduce cross-run interference.
- `INGEST_SLOWDOWN_THRESHOLD`: ring-depth ratio that triggers best-effort WS `slow_down` control frames.
- `INGEST_MAX_MESSAGE_BYTES`, `INGEST_MAX_BATCH_POINTS`: ingestion boundary caps.

### Readiness telemetry to watch

`/readyz` (and `/api/health/ready`) expose flusher/runtime telemetry useful during load:
- `buffered`, `dropped`, `flushed`, `dbWriteErrors`
- `lastFlushAt`, `lastFlushDurationMs`, `flushLatencyMs` (p50/p95/p99)
- `ringDepth` (current/max recent), `slowDownSent`, `shards`
- aggregate `services`/`healthy` status in split deployments

## OS / kernel tuning

> Apply carefully and validate for your environment. Prefer connection reuse before aggressive kernel changes.

### macOS

Check values:

```bash
sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last
sysctl kern.ipc.somaxconn
sysctl net.inet.tcp.msl
```

Example temporary adjustments:

```bash
sudo sysctl -w net.inet.ip.portrange.first=10000
sudo sysctl -w net.inet.ip.portrange.last=65535
sudo sysctl -w kern.ipc.somaxconn=4096
sudo sysctl -w net.inet.tcp.msl=1000
```

Notes:
- Docker Desktop on macOS runs containers in a Linux VM; host `sysctl` changes do not tune the VM kernel.
- `cpuset` behavior in Docker Desktop can differ from native Linux; validate pinning assumptions.

### Linux

Check values:

```bash
sysctl net.ipv4.ip_local_port_range
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_tw_reuse
sysctl net.core.netdev_max_backlog
```

Example temporary adjustments:

```bash
sudo sysctl -w net.ipv4.ip_local_port_range="10000 65535"
sudo sysctl -w net.core.somaxconn=4096
sudo sysctl -w net.core.netdev_max_backlog=4096
sudo sysctl -w net.ipv4.tcp_tw_reuse=1
sudo sysctl -w net.ipv4.tcp_fin_timeout=15
```

Notes:
- Do not use `tcp_tw_recycle` (removed on modern kernels).
- Raise file descriptor limits (`ulimit -n`) for high concurrency.
- Container sysctls may be host/privilege dependent.

## Horizontal scaling

Broadside can scale horizontally as **stateless replicas over a shared TimescaleDB** (TimescaleDB is the system of record).

- **API/control-plane replicas (`SERVICE_ROLE=api`)**: serve REST/UI/SSE and read from DB behind a load balancer.
- **Ingest replicas (`SERVICE_ROLE=ingest`)**: accept `/ws` (and other ingest paths as configured) and flush to shared DB; point producers to ingest endpoints (`INGEST_URL`).
- **Shared vs local state**: metrics/runs/aggregates live in TimescaleDB; ring buffers, flusher state, and active Artillery process tracking are process-local. Restarts can lose in-flight buffered points despite best-effort drain.
- **Operational requirements**: readiness/liveness healthchecks, restart policies, and persistent volumes for `data/` and `data/reports`.
- **Limits**: more ingest replicas increase DB write concurrency/contention; tune DB resources, flush/shard settings, and batch sizes accordingly. For very high scale, consider external buffering/queueing and stronger delivery/idempotency guarantees.

## Interpreting results

- **Zero 5xx + connection errors at peak (`ECONNRESET`/`EAGAIN`/`EPIPE`)**: likely socket/accept/ephemeral-port exhaustion or local loopback pressure.
- **p99 rises before failures**: queueing/backpressure.
- **Truncated runs/UI disconnects**: inspect `failure_reason`, `partial_data`, `dropped_points`, `/readyz` telemetry, container restarts/logs, and SSE behavior.
- **SLO pass with small peak-failure rate**: may still reflect environment limits; compare with a clean baseline.

## Quick checklist

- [ ] Keep-alive/pooling enabled in Artillery
- [ ] `SERVER_*` timeouts aligned with clients/LB
- [ ] Ingest isolated (`INGEST_PORT` or dedicated ingest service)
- [ ] `/livez` for liveness, `/readyz` for readiness
- [ ] Monitor `/readyz` flusher telemetry (drops, depth, latency, DB errors, slow-downs)
- [ ] Compare self-load against a clean baseline before concluding app regressions
