# Roadmap

## Known limitations

- **Dashboard testing depth:** covered by Vitest unit tests and Playwright E2E scenarios with a stubbed API; chart/SVG rendering is not pixel-asserted and very long metric series are not windowed/virtualized.
- **Orchestrated run streaming:** `POST /api/runs` streams live stats to ingest via a per-run Artillery reporter plugin (`-p`) and the UI merges `/api/runs/:id/live` (SSE) while a run is `running`, then reloads authoritative CAGG-backed metrics on completion (streamed provisional rows are replaced by the final report). In split deployments the orchestrator needs `INGEST_URL` (and the ingest service reachable); a crash before report processing/reconciliation can still lose or leave incomplete orchestrated-run metrics.
- **Percentile approximations in coarse rollups:** `metrics_1h` and `metrics_1d` aggregate already-aggregated percentiles with `avg(...)`; they are approximations, not recomputed percentiles from raw data.
- **Docker Compose networking:** the default stack publishes REST/WS/UI (`3000`) and the ingest service port, but does not publish the gRPC port (`3001`).
- **Authentication scope:** authentication is an opt-in shared Bearer token (`API_TOKEN`, disabled by default) for REST/SSE and `/ws`; the gRPC port has no token check. See [operations/security.md](operations/security.md).
- **In-memory orchestration state:** active Artillery children are tracked in process memory. Restarting Broadside while a run is in flight leaves the run row `running` and loses the in-process handle/report processing for that run.
- **Pagination model:** runs listing supports offset and cursor pagination, but very large datasets may still benefit from additional indexing/query tuning.

## Planned work

- [ ] Harden the dashboard: chart/rendering tests, windowing/virtualization for very long metric series.
- [ ] Improve orchestrated run durability (reconcile/recover if the orchestrator or ingest path crashes before final report processing).
- [ ] Make retention, compression, and refresh policies configurable.
- [ ] Publish/document gRPC exposure patterns in Docker Compose and production deployments.
- [ ] Extend Bearer authentication to the gRPC port, or document a recommended reverse-proxy/TLS setup that covers it.
- [ ] Improve durability/idempotency for high-scale ingestion (external buffering/queueing options, stronger delivery guarantees).

## Related docs

- [Architecture](architecture.md)
- [Operations: performance & scaling](operations/performance.md)
- [Operations: security](operations/security.md)
