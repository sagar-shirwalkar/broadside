FROM node:26-alpine AS base
RUN corepack enable

WORKDIR /app

# Install deps (server + UI + workspace packages).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/fp/package.json ./packages/fp/package.json
COPY ui/package.json ./ui/package.json
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY . .

# Generate proto
RUN pnpm proto

# Build fp + server + UI
RUN pnpm --filter @broadside/fp build
RUN pnpm build
RUN cd ui && pnpm build

# Production
FROM node:26-alpine
RUN corepack enable
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/fp ./packages/fp
COPY --from=base /app/dist ./dist
COPY --from=base /app/ui/dist ./ui/dist
COPY --from=base /app/package.json .

EXPOSE 3000
CMD ["node", "dist/index.js"]
