# Development Workflow

## First-time setup

Prerequisites: Node.js 22+, pnpm 12.18+, Docker/Compose, and `psql` on `PATH`.

```bash
cp .env.example .env
# Edit DATABASE_URL if Postgres is not at localhost:5432

pnpm task setup
```

`setup` runs `pnpm install`, `pnpm task proto`, `pnpm task db:up`, `pnpm task db:wait`, and `pnpm task db:init`.

## Daily commands

| Command | Purpose |
| --- | --- |
| `pnpm task dev` | Run the server in watch mode (REST/WS `:3000`, gRPC `:3001`). |
| `pnpm task lint` | Type-check with `tsc --noEmit`. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:coverage` | Run tests with the 80% coverage gate. |
| `pnpm build` | Compile the server to `dist/`. |
| `pnpm task proto` | Regenerate `src/gen/` from `proto/`. |
| `pnpm task proto:check` | Fail if generated proto files are stale. |
| `pnpm task db:up` / `db:down` | Start / stop TimescaleDB. |
| `pnpm task db:init` | Apply `src/db/schema.sql` with `psql`. |
| `pnpm task db:logs` | Tail database logs. |
| `pnpm task docker:build` / `docker:up` / `docker:down` | Build / run / stop the Docker stack. |
| `pnpm task clean` | Remove `dist`, `ui/dist`, and `.task`. |
| `pnpm task --list` | List every task. |

## Database lifecycle

- `docker-compose.yml` mounts `src/db/schema.sql` into `/docker-entrypoint-initdb.d/`. That only runs when the Postgres data volume is first created.
- After changing the schema, apply it explicitly with `pnpm task db:init`, or reset the volume with `docker compose down -v` for a clean rebuild.
- `db:init` requires the `psql` client; it is not bundled with the project.
- TimescaleDB runs as `timescale/timescaledb:latest-pg16`.

## Proto workflow

1. Edit `proto/metrics/v1/ingest.proto`.
2. Run `pnpm task proto` to regenerate `src/gen/`.
3. Commit both the proto change and the regenerated TypeScript.
4. Run `pnpm task proto:check` before finishing.

`src/gen/` is excluded from `tsconfig.json` but is imported by `src/server/grpc.ts`. Do not edit generated files manually.

## Testing

- Tests live in `test/` and use Vitest plus Hono's `testClient` from `hono/testing`.
- `pnpm test` runs the suite; `pnpm test:coverage` enforces 80% statements, branches, functions, and lines.
- Database and Kafka dependencies are mocked. Unit tests do not require a running TimescaleDB.
- `src/index.ts`, `src/gen/**`, and `src/lib/fplib/**` are excluded from coverage. `src/index.ts` starts real servers and exits the process.

## Build and CI

- CI runs `pnpm task proto:check`, `pnpm task lint`, `pnpm test:coverage`, and its server build step.
- A separate CI job builds the Docker image on pushes to `main`.
- `pnpm task build` includes the UI build and currently fails because `ui/` is a placeholder. Use `pnpm build` until the UI exists.

## Docker

- `pnpm task docker:build` builds the production image.
- `pnpm task docker:up` runs the full Compose stack; `docker:down` stops it.
- The Dockerfile is multi-stage: install deps and generate/build in the first stage, then copy `node_modules`, `dist`, and `package.json` into the runtime stage.
- The default Compose stack publishes only port `3000`.

## Adding features

- **New REST route:** add a Hono router under `src/server/routes/`, then mount it in `src/server/app.ts`.
- **New ingestion path:** normalize JSON at the boundary, then call `metricsFlusher.ingest`. Do not write to the database directly.
- **New config value:** add it to `src/config.ts` and document it in `.env.example` and the README.
- **Schema change:** update `src/db/schema.sql`, apply it with `pnpm task db:init`, and update the README data-model section if behavior changes.
- **New proto RPC:** update the proto, regenerate, implement the handler in `src/server/grpc.ts`, and update the README API table.

## Gotchas

- The project is ESM with `module: NodeNext`; relative imports in TypeScript must use the `.js` extension (for example `./config.js`).
- Tests use Vitest and Hono's `testClient`; run `pnpm test` or `pnpm test:coverage`.
- `pnpm task dev:full` depends on the UI dev server and will not work until `ui/` is implemented.
- `src/lib/fplib/` is not currently imported by the server; treat it as a standalone utility library.
