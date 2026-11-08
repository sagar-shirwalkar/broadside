import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/config.ts",
        "src/db/client.ts",
        "src/lib/ring-buffer.ts",
        "src/lib/normalize.ts",
        "src/lib/artillery.ts",
        "src/lib/flusher.ts",
        "src/server/app.ts",
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
