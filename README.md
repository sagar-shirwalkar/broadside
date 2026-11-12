# <p align="center">Broadside</p>

<p align="center"><strong>Self-hosted dashboard for <a href="https://www.artillery.io">Artillery</a> load-test metrics.</strong></p>

<div align="center">

[![Lit](https://img.shields.io/badge/Lit-324FFF?style=for-the-badge&logo=Lit&logoColor=white)](https://lit.dev/)
[![Hono](https://img.shields.io/badge/hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-003B77?style=for-the-badge&logo=timescale&logoColor=white)](https://docs.timescale.com/)
[![GitHub License](https://img.shields.io/github/license/sagar-shirwalkar/broadside?style=for-the-badge&color=purple)](LICENSE)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/sagar-shirwalkar/broadside/ci.yml?style=for-the-badge&labelColor=black)](https://github.com/sagar-shirwalkar/broadside/actions)

</div>

<div align="center">

<img width="2895" height="1719" alt="broadside-dashboard" src="https://github.com/user-attachments/assets/86f1aba3-480d-4db2-9559-1be7db1015bf" />

</div>

<br/>

Broadside ingests Artillery metrics over WebSocket, Connect/gRPC, or Kafka; buffers and stores them in TimescaleDB; and serves a REST API with a Lit dashboard. It can also orchestrate Artillery runs and persist reports.

## Quick start

```bash
git clone https://github.com/your-org/broadside.git
cd broadside
cp .env.example .env
pnpm task setup        # install, proto, db up/wait/init
pnpm task dev:full     # API (:3000) + UI dev (:5173)
```

Verify health:

```bash
curl -s http://localhost:3000/api/health   # liveness
curl -s http://localhost:3000/readyz       # readiness (DB + flusher + services)
```

For production/Docker:

```bash
docker compose up --build -d   # dashboard + ingest + db
```

## Documentation

| Area | Docs |
| --- | --- |
| **Start here** | [docs/getting-started.md](docs/getting-started.md) |
| **Architecture & data** | [docs/architecture.md](docs/architecture.md), [docs/data-model.md](docs/data-model.md) |
| **API** | [docs/api-reference.md](docs/api-reference.md) |
| **Operations** | [docs/operations/security.md](docs/operations/security.md), [docs/operations/deployment.md](docs/operations/deployment.md), [docs/operations/performance.md](docs/operations/performance.md) |
| **Development** | [docs/development/workflow.md](docs/development/workflow.md), [docs/development/testing.md](docs/development/testing.md), [docs/development/conventions.md](docs/development/conventions.md) |
| **Project** | [docs/roadmap.md](docs/roadmap.md), [docs/contributing.md](docs/contributing.md), [docs/README.md](docs/README.md) |

## Contributing

See [docs/contributing.md](docs/contributing.md). Before opening a PR, run `pnpm task proto:check`, `pnpm task lint`, `pnpm test:coverage`, and `pnpm build`.

## License

[Mozilla Public License 2.0](LICENSE).
