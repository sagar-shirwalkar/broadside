# Roadmap

## Known limitations

- **Dashboard testing depth:** covered by Vitest unit tests and Playwright E2E scenarios with a stubbed API; chart/SVG rendering is not pixel-asserted and very long metric series are not windowed/virtualized.
- **Orchestrated run streaming:** `GET /api/runs/:id/live` streams points once the flusher writes them, which works well for WS/gRPC/Kafka-fed runs. Runs started via `POST /api/runs` still parse the Artillery report at process exit, so their live stream stays quiet until completion. A crash before report processing can lose an orchestrated run's metrics.
- **Percentile approximations in coarse rollups:** `metrics_1h` and `metrics_1d` aggregate already-aggregated percentiles with `avg(...)`; they are approximations, not recomputed percentiles from raw data.
- **Docker Compose networking:** the default stack publishes REST/WS/UI (`3000`) and the ingest service port, but does not publish the gRPC port (`3001`).
- **Authentication scope:** authentication is an opt-in shared Bearer token (`API_TOKEN`, disabled by default) for REST/SSE and `/ws`; the gRPC port has no token check. See [operations/security.md](operations/security.md).
- **In-memory orchestration state:** active Artillery children are tracked in process memory. Restarting Broadside while a run is in flight leaves the run row `running` and loses the in-process handle/report processing for that run.
- **Pagination model:** runs listing supports offset and cursor pagination, but very large datasets may still benefit from additional indexing/query tuning.

## Planned work

- [ ] Harden the dashboard: chart/rendering tests, windowing/virtualization for very long metric series.
- [ ] Stream orchestrated Artillery metrics live instead of waiting for the final report.
- [ ] Make retention, compression, and refresh policies configurable.
- [ ] Publish/document gRPC exposure patterns in Docker Compose and production deployments.
- [ ] Extend Bearer authentication to the gRPC port, or document a recommended reverse-proxy/TLS setup that covers it.
- [ ] Improve durability/idempotency for high-scale ingestion (external buffering/queueing options, stronger delivery guarantees).

## Related docs

- [Architecture](architecture.md)
- [Operations: performance & scaling](operations/performance.md)
- [Operations: security](operations/security.md)
