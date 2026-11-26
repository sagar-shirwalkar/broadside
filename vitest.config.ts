import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["source", "import", "module", "browser", "default"],
  },
  // Vitest loads modules through Vite's SSR pipeline, which resolves package
  // exports with `ssr.resolve.conditions` (not `resolve.conditions`). Include
  // "source" so @broadside/fp resolves to its .ts sources and tests do not
  // require packages/fp/dist, which is absent on a fresh checkout.
  ssr: {
    resolve: {
      conditions: ["source", "import", "module", "node", "default"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "packages/fp/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/**/*.test.ts",
        "test/**/*.test.ts",
        "packages/fp/**/*.test.ts",
        "src/config.ts",
        "src/db/client.ts",
        "src/lib/ring-buffer.ts",
        "src/lib/normalize.ts",
        "src/lib/artillery.ts",
        "src/lib/flusher.ts",
        "src/server/app.ts",
        "src/server/middleware/auth.ts",
        "src/server/grpc.ts",
        "src/server/kafka.ts",
        "src/server/routes/health.ts",
        "src/server/routes/runs.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
