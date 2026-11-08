# Security policy

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting][gh-pvr] for this repository.
It creates a private advisory visible only to you and the maintainer, and
keeps the discussion in one place.

If you cannot use GitHub's reporting flow, email
`security@example.invalid` with `broadside` in the subject.

**Do not open a public issue for a security problem.**

[gh-pvr]: https://github.com/sagar-shirwalkar/broadside/security/advisories/new

## What to expect

- **Acknowledgement** within 7 days.
- **Initial assessment** within 30 days: whether the report is accepted,
  what the impact is, and a rough severity.
- **A fix or a decision not to fix** within 90 days for accepted reports.

This is a small project maintained in spare time. The timings above are
what can be met reliably, not what would be ideal. If a report is
time-sensitive — an actively exploited vulnerability, a live key
compromise — say so in the report and it will be handled first.

## What is in scope

The Broadside backend, dashboard UI, and deployment tooling:

- **The API server and its auth surface.** The optional Bearer-token gate
  (`API_TOKEN`), CORS allow-list, the `/ws` ingestion endpoint, and the
  gRPC service. Misconfigurations that let an attacker reach data they
  should not, or mute the surface silently, are in scope.
- **The database boundary.** TimescaleDB holds run metadata and metrics.
  SQL injection through the REST layer, the streaming endpoint's pagination
  arithmetic, and any report parsing that touches the database.
- **Artillery orchestration.** Script-path validation, concurrent-run caps,
  JSON-report parsing (bucket/percentile math), report persistence.
- **The dashboard.** XSS surface, the Content-Security-Policy served with
  the UI, the auth-handling wrapper (token storage and 401 flow), the
  toast system.
- **The build and release pipeline.** Workflow permissions, artifact
  integrity, the SHA pinning policy on actions.

## What is not in scope

- **Artillery itself.** Load-test scripts are data; script-side issues
  belong in the Artillery project.
- **TimescaleDB itself.** Report core TimescaleDB flaws upstream, but
  tell us about any interaction our usage has with them anyway.
- **ChatGPT/Codex/Claude-assisted code you generated with them** — that
  belongs to you and your provider, not this project.
- **Third-party relays, brokers, and services.** Kafka topics, upstream
  producers, and anything you point your own producers at.
- **Upstream dependencies.** Node, pnpm, postgres.js, Hono, Lit, etc.
  Report to the maintainers of the affected package. Tell us as well so
  the pin can move, but the fix belongs upstream.
- **The docker image as delivered by the registry.** If you find a
  vulnerability in the image that is not present in the source, report
  it — but issues in the `timescale/timescaledb` base image itself are
  upstream unless our usage triggers them.

## Please do not

- **Send a real Bearer token or any secret.** If a report involves
  `API_TOKEN` or a leaked credential, describe the vulnerability without
  including the secret. Generate a test token and share that if a
  reproduction is needed.
- **Test against services or deployments you do not control.** The scope
  above is the Broadside codebase, not the networks it talks to.
- **Run automated scanners against any hosted instance** without prior
  arrangement. A local instance you started yourself is fine.

## No bug bounty

There is no financial reward for reports. Credit will be given in the
advisory and in release notes unless you ask not to be named.

## Disclosure

Fixes are published as a new release, with the advisory describing the
vulnerability and its impact. The advisory is published at the same time
as the fix, not before. If a fix requires coordination with a maintainer
of a dependency, the timeline is extended and the reporter is kept
informed.
