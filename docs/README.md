# Broadside documentation

This directory contains the detailed documentation for Broadside. The root [README](../README.md) is the front door (overview + quick start); use the docs below for reference and operational detail.

## Getting started

- [Getting started](getting-started.md) — prerequisites, setup, first run, and health verification

## Reference

- [Architecture](architecture.md) — runtime topology, roles, ingestion/write/query paths, run lifecycle
- [Data model](data-model.md) — hypertable, runs table, continuous aggregates, retention/compression
- [API reference](api-reference.md) — REST endpoints, query params, SSE, WebSocket, Kafka, gRPC/Connect

## Operations

- [Security](operations/security.md) — auth, CORS, trust boundaries, network exposure
- [Performance & scaling](operations/performance.md) — tuning, self-load guidance, horizontal scaling notes
- [Deployment](operations/deployment.md) — Docker Compose, roles, env vars, probes, volumes, resource tuning

## Development

- [Workflow](development/workflow.md) — daily commands, DB/proto workflows, build/CI, adding features
- [Testing](development/testing.md) — test layers, commands, conventions, when to run what
- [Conventions](development/conventions.md) — TypeScript/SQL/logging/UI conventions and quality gates

## Project

- [Roadmap](roadmap.md) — known limitations and planned work
- [Contributing](contributing.md) — contribution workflow and checks
