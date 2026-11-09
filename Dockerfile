FROM node:26-alpine AS base
RUN corepack enable

WORKDIR /app

# Install deps (server + UI). pnpm-workspace.yaml carries the build-script
# approvals (esbuild/buf/task); without it the install fails.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./ui/
RUN cd ui && pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate proto
RUN pnpm proto

# Build server
RUN pnpm build

# Build UI
RUN cd ui && pnpm build

# Production
FROM node:26-alpine
RUN corepack enable
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/ui/dist ./ui/dist
COPY --from=base /app/package.json .

EXPOSE 3000
CMD ["node", "dist/index.js"]
