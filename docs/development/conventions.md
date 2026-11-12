# Conventions

## TypeScript

- `strict: true`, ESM with `module: NodeNext` (server/root). Relative imports in TS use `.js` extensions.
- Prefer `import type` for type-only imports.
- Keep shared domain shapes in `src/types.ts` (server) and `ui/src/types.ts` (UI). Map external payloads (JSON/proto/Kafka/reports) to domain types at boundaries.
- Do not edit generated code in `src/gen/**`.

## Formatting and structure

- 2-space indentation.
- Match surrounding style (server code commonly uses semicolons and double quotes).
- Keep modules focused; comments should explain invariants/tradeoffs/non-obvious behavior.

## SQL and database access

- Use postgres.js tagged templates for values (e.g. `` sql`... WHERE id = ${id}` ``).
- Use `sql.identifier(...)` for dynamic identifiers (e.g. allow-listed view names only).
- Never concatenate untrusted input into SQL.
- Bind ID lists as arrays/values (e.g. `id = ANY(${ids})`) after validation.
- Treat `src/db/schema.sql` as schema source of truth; keep schema, types, and queries in sync.
- Store timestamps in UTC.

## Query parameter validation

- Parse and bound all query params before DB access (`limit`, `offset`, `cursor` decoding, `interval_ms`, `granularity`, compare ID lists, etc.).
- Return `400` with stable `{ error: "..." }` responses for invalid input.
- Distinguish omitted params (defaults) from supplied-but-invalid values.
- Register static routes (e.g. `/compare`) before parameterized routes (e.g. `/:id`) where needed.

## Ingestion and runtime safety

- Normalize/validate untrusted JSON at boundaries (`normalizePoint`/`normalizeBatch`) and fail closed on malformed shapes.
- All ingestion paths must call `metricsFlusher.ingest(...)`; never write to `metrics` directly from routes/consumers.
- Enforce ingestion bounds/caps (message size, batch points, run concurrency, payload limits).
- Keep orchestration/report parsing robust across Artillery report shape variants (`period`/`timestamp`, `histograms`/`summaries`, missing plugin data => aggregate-only).
- Guard run lifecycle with settled/killed/state checks to avoid double-processing.
- Use stable log prefixes where helpful (`[flusher]`, `[kafka]`, `[artillery]`, `[server]`, `[ingest]`, `[readyz]`).

## Configuration and security

- Read environment variables only in `src/config.ts`.
- Document new env vars in `.env.example` and relevant docs.
- Keep optional features safely defaulted/off where applicable (e.g. empty `API_TOKEN`, unset `KAFKA_BROKERS`).
- Compare secrets in constant time; do not log secrets/tokens.
- Keep health/liveness probes public as designed; protect data/control surfaces appropriately.

## UI conventions (`ui/`)

- TypeScript strict, bundler resolution; relative imports use `.js` extension for consistency.
- Follow TEA/MVU structure: `core/` (runtime), `app/` (composition), `features/<name>/` (types/update/cmds/view), `components/` (stateless primitives), `services/` (IO boundary), `styles/` (tokens/theme/base).
- Keep `update` pure; perform IO in commands/services. Avoid ad-hoc `fetch` in views.
- Use CSS custom properties for chart/theme colors (no hardcoded hex where theme tokens apply).
- UI deps stay minimal (Lit/Vite, hand-rolled SVG charts).

## Logging

- Use shared Pino logger (`src/logger.ts`); no `console.*` in server code.
- Log errors as `logger.error({ err }, "message")`.
- Request logging is handled by Hono structured logging middleware.

## Quality gates

- Run `pnpm task lint` before finishing code changes.
- Run relevant tests and keep coverage healthy (`pnpm test:coverage`, UI tests as applicable).
- Run `pnpm task proto:check` when proto/generated files change.
- Update docs when commands, configuration, APIs, architecture, schema, or behavior change.
