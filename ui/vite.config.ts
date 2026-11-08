import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // In dev, proxy API calls to the backend so the browser never hits
    // CORS. Production answers come from the API server itself, which
    // also serves the built bundle from ui/dist.
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
