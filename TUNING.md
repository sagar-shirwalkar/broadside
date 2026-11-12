# Tuning & Self-Load Guidance

This document collects practical tuning notes for running Broadside under load, especially when using Broadside to orchestrate Artillery runs against itself (self-load) on a single host or Docker Desktop.

## Self-load warning

**Broadside's own load test against itself on Docker Desktop can saturate the loopback/network stack before it saturates the application.** In this mode, Artillery (spawned by Broadside), the API/control plane, `/ws` ingest, the dashboard/SSE clients, and TimescaleDB all contend for the same CPU, memory, sockets, and ephemeral ports on the same VM/host.

Connection-level failures such as `ECONNRESET`, `EAGAIN`, or `EPIPE` at peak (with zero 5xx responses) often indicate **socket/accept/ephemeral-port exhaustion** rather than application logic regressions. Treat peak-failure self-load results as an environment signal unless reproduced with a clean baseline.

**Recommendations:**
- Run a **clean baseline** profile first (keep-alive enabled, minimal/no ingest/DB path, stable target) to isolate server capacity.
- Compare baseline vs full self-load (ingest + dashboard + DB writes enabled).
- Prefer separating ingest/control plane (dedicated `INGEST_PORT` or dedicated ingest container/service) for sustained high-volume runs.
- On Docker Desktop/macOS, loopback and VM limits can dominate; validate production-like deployments on Linux hosts or separate machines/containers.

## Artillery (load generator) keep-alive / pooling

Connection reuse is critical. Without keep-alive/pooling, high arrival rates can churn short-lived sockets into `TIME_WAIT` and exhaust ephemeral ports.

Example (Artillery v2 script):

```yaml
config:
  target: "http://localhost:3000"
  http:
    # Reuse sockets to reduce TIME_WAIT / ephemeral-port churn.
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
- Set `http.pool` high enough for peak virtual user/concurrency but not unbounded.
- Keep request/idle timeouts aligned with server behavior (`SERVER_KEEP_ALIVE_TIMEOUT_MS`, load balancer idle timeouts).
- For self-benchmark runs, disable or minimize non-essential metrics traffic where possible to reduce loopback contention.

## Broadside server tuning (env)

- `SERVER_KEEP_ALIVE_TIMEOUT_MS` (default `65000`): keep-alive idle timeout. Set **above** client/LB idle timeout to avoid connection races.
- `SERVER_HEADERS_TIMEOUT_MS` (default `66000`): must be **greater than** keep-alive timeout.
- `SERVER_REQUEST_TIMEOUT_MS` (default `120000`): request timeout (`0` disables).
- `SERVER_MAX_REQUESTS_PER_SOCKET` (default `1000`): rotate sockets to bound per-connection resource creep (`0` disables).
- `INGEST_PORT`: run `/ws` ingest on a dedicated listener (separate accept/socket budget from REST/control/SSE). `0` keeps ingest on the main port.
- `FLUSH_SHARDS`, `RING_CAPACITY`, `FLUSH_BATCH_SIZE`, `FLUSH_INTERVAL_MS`, `INGEST_SLOWDOWN_THRESHOLD`: tune ingestion buffering/flush behavior (see `.env.example`).

## OS / kernel tuning

> Apply carefully and validate for your environment. Values below are common starting points for high-connection local/load-test scenarios; production systems should be tuned based on observed limits.

### macOS

Check current values:

```bash
sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last
sysctl kern.ipc.somaxconn
sysctl net.inet.tcp.msl
```

Suggested adjustments (temporary until reboot, requires sudo):

```bash
# Expand ephemeral port range (defaults vary by macOS version)
sudo sysctl -w net.inet.ip.portrange.first=10000
sudo sysctl -w net.inet.ip.portrange.last=65535

# Increase listen backlog ceiling (app/server must also set backlog appropriately)
sudo sysctl -w kern.ipc.somaxconn=4096

# Reduce TIME_WAIT duration impact (MSL in ms; default often 15000 = 15s)
# Lowering reduces TIME_WAIT occupancy but be cautious on lossy networks.
sudo sysctl -w net.inet.tcp.msl=1000
```

Notes:
- Docker Desktop on macOS runs inside a Linux VM; host `sysctl` changes do not tune the VM kernel. Container/VM networking limits may still apply.
- Prefer connection reuse (keep-alive) over aggressive kernel tweaks.

### Linux

Check current values:

```bash
sysctl net.ipv4.ip_local_port_range
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_tw_reuse
sysctl net.core.netdev_max_backlog
```

Suggested adjustments (temporary; persist via `/etc/sysctl.d/*.conf`):

```bash
# Ephemeral port range
sudo sysctl -w net.ipv4.ip_local_port_range="10000 65535"

# Accept backlog
sudo sysctl -w net.core.somaxconn=4096
sudo sysctl -w net.core.netdev_max_backlog=4096

# Reuse TIME_WAIT sockets for outbound connections when safe
# (helpful for load generators making many short-lived connections to same targets)
sudo sysctl -w net.ipv4.tcp_tw_reuse=1

# Optional (use with care): faster FIN timeout
sudo sysctl -w net.ipv4.tcp_fin_timeout=15
```

Notes:
- `tcp_tw_recycle` is removed/unsupported on modern kernels and should not be used.
- Increase file descriptor limits (`ulimit -n`) for high-concurrency clients/servers.
- In containers, some sysctls are namespaced/tunable only on the host or with specific privileges.

## Interpreting results

- **Zero 5xx + `ECONNRESET`/`EAGAIN`/`EPIPE` clustered at peak:** likely socket/accept/ephemeral-port exhaustion or upstream connection resets.
- **p99 rises before failures:** queueing/backpressure at network or accept layers.
- **Truncated/short run with UI disconnects:** check run `failure_reason`, `/readyz` flusher telemetry (`ringDepth`, `flushLatencyMs`, `dropped`, `dbWriteErrors`, `slowDownSent`), SSE/live connectivity, and container restarts/logs.
- **SLO pass with small peak-failure rate:** can still indicate environment limits; compare against a clean baseline.

## Quick checklist

- [ ] Keep-alive/pooling enabled in Artillery (`config.http.pool`, timeouts)
- [ ] Server keep-alive/headers/request timeouts aligned (`SERVER_*`)
- [ ] Ingest isolated (`INGEST_PORT` or dedicated ingest service/container)
- [ ] `/livez` for liveness, `/readyz` for readiness (DB + flusher) in probes/healthchecks
- [ ] Watch `/readyz` flusher telemetry during runs (drops, ring depth, flush latency/errors, slow_down_sent)
- [ ] Treat Docker Desktop self-load results cautiously; validate with clean baselines
