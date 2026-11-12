# Getting started

## Requirements

- [Node.js](https://nodejs.org/) 22+ (Docker image uses Node 22; CI uses Node 24)
- [pnpm](https://pnpm.io/) 12.18+
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for TimescaleDB / full stack)
- `psql` on your `PATH` for `pnpm task db:init`
- Ports `3000` (REST/WebSocket/UI) and `3001` (gRPC) available for local defaults
- [`artillery`](https://www.artillery.io/docs/get-started/install) CLI on `PATH` if you want to launch runs via `POST /api/runs`

`task` and `buf` are provided by dev dependencies (no global install required).

## Setup (local development)

1. **Clone and enter the repo**

   ```bash
   git clone https://github.com/your-org/broadside.git
   cd broadside
   ```

2. **Create environment file**

   ```bash
   cp .env.example .env
   # Edit .env if Postgres is not at localhost:5432
   ```

   For host-local dev, `DATABASE_URL` should point to `localhost` (TimescaleDB port-mapped by Compose). The Docker Compose stack sets container database URLs to the internal `db` service.

3. **Run one-command setup**

   ```bash
   pnpm task setup
   ```

   `setup` runs: install deps, generate proto, start DB (`db` service), wait for readiness, and apply schema (`src/db/schema.sql`).

   `pnpm task setup` starts only the database; it does **not** start the API/UI processes.

4. **Start services**

   **Development (API + Vite dashboard):**

   ```bash
   pnpm task dev:full
   ```

   - API server: `http://localhost:3000` (REST/WS, gRPC on `:3001`)
   - Dashboard dev server (Vite): `http://localhost:5173` (proxies `/api`, `/ws`, `/readyz`, `/livez` to `:3000`)

   Individual processes:

   ```bash
   pnpm task dev      # API only (:3000 REST/WS, :3001 gRPC)
   pnpm task ui:dev   # UI dev server only (:5173)
   ```

   **Production-style (built artifacts):**

   ```bash
   pnpm task build          # server + UI (ui/dist)
   pnpm task db:up          # ensure TimescaleDB is running
   node dist/server.js      # serves API + built UI
   ```

   **Docker Compose (split stack):**

   ```bash
   docker compose up --build -d   # dashboard + ingest + db
   docker compose logs -f
   docker compose down
   ```

5. **Verify health**

   ```bash
   # Liveness (static, no DB)
   curl -s http://localhost:3000/api/health

   # Readiness (DB + flusher telemetry; dashboard aggregates ingest/db in split setups)
   curl -s http://localhost:3000/readyz
   ```

   - `/api/health` and `/livez` are liveness probes.
   - `/readyz` and `/api/health/ready` are readiness probes (return `503` when unhealthy/degraded).

## First load test (orchestrated)

Broadside can spawn Artillery and ingest the generated report (requires `artillery` on `PATH`):

```bash
curl -s -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"script_path":"./load-test.yml"}'
```

Then inspect:

```bash
curl -s http://localhost:3000/api/runs
curl -s "http://localhost:3000/api/runs/<id>/metrics?granularity=1m"
```

If `API_TOKEN` is set, include `Authorization: Bearer <token>` for `/api/runs*` and `/ws` (and `?token=` for SSE/WS clients that cannot set headers).

## Next steps

- [API reference](api-reference.md) — REST, SSE, WebSocket, Kafka, gRPC surfaces
- [Architecture](architecture.md) — runtime roles, ingestion, flusher, data flow
- [Operations: deployment](operations/deployment.md) — Compose, env vars, probes, volumes
- [Operations: performance](operations/performance.md) — tuning and self-load guidance
- [Development workflow](development/workflow.md) — commands, DB/proto/test workflows
