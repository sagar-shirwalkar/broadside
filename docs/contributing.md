# Contributing

Contributions are welcome. For bugs, feature requests, or questions, open an issue. For larger changes, open an issue first to discuss the approach.

## Before opening a pull request

Run the relevant checks for your change:

```bash
pnpm task proto:check      # if proto/generated files are involved
pnpm task lint
pnpm test:coverage
pnpm build
```

For UI changes, also run as applicable:

```bash
cd ui && pnpm typecheck
pnpm task ui:test
pnpm task ui:test:e2e
```

## Guidelines

- Keep changes focused and consistent with existing patterns.
- Do not edit generated files in `src/gen/` by hand; update `proto/` and regenerate with `pnpm task proto`.
- Update documentation when behavior, configuration, APIs, architecture, or workflows change (see [`docs/`](README.md)).
- Follow project conventions in [development/conventions.md](development/conventions.md).
- Keep tests and coverage healthy; add/update tests for behavior changes.

## License

By contributing, you agree that your contributions are licensed under the repository license ([Mozilla Public License 2.0](../LICENSE)).
