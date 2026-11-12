# Deployment

## Docker Compose (recommended for production-like runs)

The repository ships a split Compose stack:

- **`dashboard`**: API/UI/control plane (`SERVICE_ROLE=api`), serves REST/UI and gRPC (internal port `PORT+1`) and depends on `db` and `ingest`.
- **`ingest`**: dedicated ingestion service (`SERVICE_ROLE=ingest`) for `/ws` ingest and flusher writes to TimescaleDB.
- **`db`**: TimescaleDB (`timescale/timescaledb:latest-pg16`) with schema mounted for first-run initialization.

Common commands:

```bash
docker compose up --build -d   # dashboard + ingest + db
docker compose logs -f
docker compose down
```

`pnpm task db:up` starts only the `db` service (useful for local dev).

### Ports and service wiring

- `dashboard` publishes `${PORT:-3000}` (REST/UI/WS on API role) and `${GRPC_PORT:-3001}` mapping in compose config; default published API/UI access is port `3000`.
- `ingest` publishes `${INGEST_SERVICE_PORT:-3002}` (defaults to `3002`) and listens as the dedicated ingest container port.
- `INGEST_URL` for dashboard defaults to `ws://ingest:${INGEST_SERVICE_PORT:-3002}/ws` in compose so producers/orchestrator paths can target the ingest service.
- **`INGEST_SERVICE_PORT` vs `INGEST_PORT`:** `INGEST_SERVICE_PORT` configures the compose ingest container's published/listen port. `INGEST_PORT` is the in-process/host-runtime setting for running a separate ingest listener in `SERVICE_ROLE=all` mode (or `0` to disable separate in-process listener).

### Healthchecks, startup, and restart

- `dashboard` and `ingest` use HTTP readiness probes (`/readyz`) in container healthchecks.
- Compose `depends_on` uses health conditions (`db` healthy before dependents; `dashboard` waits for `ingest` and `db`).
- Services are configured with `restart: unless-stopped`.
- TimescaleDB healthcheck uses `pg_isready`.

### Volumes and persistence

- `pgdata`: TimescaleDB data.
- `appdata`: shared app data volume mounted at `/app/data`.
- `reports`: persisted Artillery reports at `/app/data/reports` (`ARTILLERY_REPORT_DIR`).

`src/db/schema.sql` is mounted into `/docker-entrypoint-initdb.d/` for `db`; it runs only on first initialization of the DB volume. For schema changes on existing volumes, run `db:init`/apply SQL explicitly or recreate the volume.

### Resource tuning and overrides

Compose supports env-driven resource settings (see `.env.example`), including:

- `DASHBOARD_CPUS`, `DASHBOARD_MEM_LIMIT`, `DASHBOARD_CPU_RESERVATION`, `DASHBOARD_MEM_RESERVATION`
- `INGEST_CPUS`, `INGEST_MEM_LIMIT`, `INGEST_CPU_RESERVATION`, `INGEST_MEM_RESERVATION`

`cpuset` pinning is platform-dependent and intentionally not hardcoded in `docker-compose.yml`. Use [`docker-compose.override.example.yml`](../../docker-compose.override.example.yml) as a template:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
# edit as needed, then run compose normally
```

`docker-compose.override.yml` is gitignored for local, machine-specific tuning.

## Runtime roles (`SERVICE_ROLE`)

`SERVICE_ROLE` selects process responsibilities:

| Role | Starts | Typical use |
| --- | --- | --- |
| `all` | REST/UI + WS ingest (+ optional separate in-process ingest listener when `INGEST_PORT` differs) + gRPC + Kafka consumer (if enabled) | Local/dev single-process mode |
| `api` | REST/UI/control plane + gRPC; no WS ingest server role | Dashboard/API replica behind shared DB |
| `ingest` | Dedicated WS ingest server + flusher/ingest path + Kafka consumer (if enabled) | Isolated ingest replica/service |

Notes:
- Flusher and ingest tracking are process-local components; replicas share durability/state via TimescaleDB, not in-memory buffers.
- Readiness (`/readyz`) behavior is role-aware (dashboard can aggregate DB + ingest probe; ingest reports its own readiness).

## Environment configuration

All runtime configuration is read in `src/config.ts` from environment variables (`.env` via `dotenv`). Document new variables in `.env.example` and relevant docs.

Key groups:
- **Ports/roles:** `PORT`, `INGEST_PORT`, `INGEST_SERVICE_PORT` (compose), `SERVICE_ROLE`, `INGEST_URL`
- **Database:** `DATABASE_URL`
- **HTTP tuning:** `SERVER_KEEP_ALIVE_TIMEOUT_MS`, `SERVER_HEADERS_TIMEOUT_MS`, `SERVER_REQUEST_TIMEOUT_MS`, `SERVER_MAX_REQUESTS_PER_SOCKET`
- **Auth/CORS/UI:** `API_TOKEN`, `CORS_ORIGINS`, `UI_DIST_DIR`
- **Ingestion/flusher:** `RING_CAPACITY`, `FLUSH_BATCH_SIZE`, `FLUSH_INTERVAL_MS`, `FLUSH_SHARDS`, `INGEST_SLOWDOWN_THRESHOLD`, `INGEST_MAX_MESSAGE_BYTES`, `INGEST_MAX_BATCH_POINTS`
- **Orchestration:** `ARTILLERY_REPORT_DIR`, `ARTILLERY_MAX_CONCURRENT`, `ARTILLERY_CHILD_MAX_OLD_MB`, `ARTILLERY_CHILD_MAX_YOUNG_MB`
- **Ingest stall detection:** `INGEST_STALL_TIMEOUT_MS`, `INGEST_STALL_CHECK_MS`
- **Kafka:** `KAFKA_BROKERS`, `KAFKA_TOPIC`
- **SLO/overview:** `SLO_P95_MS`, `SLO_ERROR_RATE`, `SLO_WINDOW_RUNS`, `SLO_REGRESSION_DELTA`
- **Logging:** `LOG_LEVEL`, `LOG_PRETTY`

## Probes

- **Liveness:** `GET /livez`, `GET /api/health/live`, `GET /api/health` (static/no DB)
- **Readiness:** `GET /readyz`, `GET /api/health/ready` (DB + flusher telemetry; dashboard role aggregates ingest probe; returns `503` when unhealthy/degraded)

Use liveness for process-up checks and readiness for traffic gating/healthchecks.

## Related docs

- [Getting started](../getting-started.md)
- [Operations: performance & scaling](performance.md)
- [Architecture](../architecture.md)
