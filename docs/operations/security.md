# Security and trust boundaries

Broadside is designed for trusted/internal environments by default. Authentication is opt-in and some surfaces (notably gRPC) are not protected by the shared token.

## Authentication (`API_TOKEN`)

- **Disabled by default:** if `API_TOKEN` is empty/unset, API auth is not enforced.
- **When enabled:** requests to `/api/runs/*` (including SSE `/api/runs/:id/live`) and `/ws` must provide `Authorization: Bearer <token>`.
  - WebSocket and SSE clients that cannot set headers may pass `?token=` as a fallback. Prefer headers; query parameters can appear in logs/proxies.
  - Tokens are compared in constant time (`crypto.timingSafeEqual` with length checks).
- **Public probes:** health/readiness/liveness probes remain unauthenticated for load balancers and monitors:
  - `/api/health`, `/api/health/live`, `/api/health/ready`
  - `/livez`, `/readyz`

## CORS (`CORS_ORIGINS`)

- `CORS_ORIGINS` is a comma-separated allow-list of browser origins.
- Defaults target the Vite dev server (`http://localhost:5173,http://127.0.0.1:5173`).
- `*` allows any origin; use only when you intentionally accept cross-origin browser access.
- CORS/preflight handling runs before auth so `OPTIONS` requests (which do not carry credentials) can succeed.

## Network exposure and TLS

- Bind to localhost or place Broadside behind an authenticated reverse proxy with TLS when exposing beyond a trusted network.
- The **gRPC/Connect port (`PORT + 1`, default `3001`) has no Bearer-token auth check**. Keep it on a trusted network, or front it with infrastructure that enforces authentication/TLS/policy.
- The default Docker Compose stack does not publish the gRPC port.

## Ingestion and abuse hardening

Broadside applies boundary validation and caps to reduce accidental/malicious resource exhaustion:

- JSON ingestion is normalized/validated at the boundary (`src/lib/normalize.ts`, fail closed with `TypeError`).
- WebSocket message size cap: `INGEST_MAX_MESSAGE_BYTES`.
- Batch point cap: `INGEST_MAX_BATCH_POINTS` (WS/gRPC/Kafka paths).
- Concurrent orchestrated runs: `ARTILLERY_MAX_CONCURRENT`.
- Orchestration config payload size limits (e.g. stored config body caps in API).

These controls bound input, but they do not replace network-level access control.

## Secrets and data handling

- Keep `DATABASE_URL`, `API_TOKEN`, Kafka credentials, and other secrets in `.env` or secret stores; never commit them.
- Persisted Artillery reports may contain environment/config details from test runs; store and protect `ARTILLERY_REPORT_DIR` / report volumes appropriately.
- Logs are structured (Pino). Avoid logging sensitive payloads/tokens.

## Related docs

- [Getting started](../getting-started.md)
- [Operations: deployment](deployment.md)
- [API reference](../api-reference.md)
