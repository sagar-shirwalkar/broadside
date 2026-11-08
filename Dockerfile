FROM node:22-alpine AS base
RUN corepack enable

WORKDIR /app

# Install deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY . .

# Generate proto
RUN pnpm proto

# Build
RUN pnpm build

# Production
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json .

EXPOSE 3000
CMD ["node", "dist/index.js"]
