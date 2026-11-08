# Broadside

Dashboard for Artillery metrics

## Install via pnpm (no system binary needed):

### 1. Clone

```bash
git clone https://github.com/your-org/broadside.git
cd broadside
```

### 2. Create .env

```bash
cp .env.example .env # Edit .env if your Postgres isn't at localhost:5432
```

### 3. One command does everything:

```bash
pnpm task setup
```

It runs:

```bash
pnpm install          # installs all deps (server + tooling)
task proto            # buf generate → src/gen/ (already committed, this is a no-op unless protos changed)
task db:up            # docker compose up db -d
task db:wait          # polls pg_isready until ready
task db:init          # psql $DATABASE_URL -f src/db/schema.sql   
```

### 4. Start developing

```bash
pnpm task dev         # server on :3000 (REST+WS), :3001 (gRPC)
pnpm task lint        # type-check
pnpm task build       # production build
pnpm task --list      # see all tasks
```
