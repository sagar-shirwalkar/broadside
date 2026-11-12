import { Hono } from "hono";
import { sql } from "../../db/client.js";
import { config } from "../../config.js";
import { metricsFlusher } from "../../lib/flusher.js";
import { logger } from "../../logger.js";

const health = new Hono();

function livenessPayload() {
  return {
    status: "ok" as const,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

function deriveIngestHealthUrl(): string | null {
  const raw = config.ingestUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "ws:" || url.protocol === "wss:") {
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "/readyz";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function probeIngest(): Promise<"ok" | "error"> {
  // In ingest-only role this process is the ingest service.
  if (config.serviceRole === "ingest") return "ok";

  const url = deriveIngestHealthUrl();
  // No separate ingest endpoint configured: treat ingest as co-located/healthy in this process.
  if (!url) return "ok";

  // Avoid probing self when pointing to local listener in same process.
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? "443" : "80"));
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (isLoopback && config.serviceRole === "all") {
      const localIngestPort = config.ingestPort > 0 ? config.ingestPort : config.port;
      if (port === localIngestPort || port === config.port) return "ok";
    }
  } catch {
    // fall through to probe
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return "error";
    return "ok";
  } catch {
    return "error";
  }
}

async function readinessPayload() {
  let database: "ok" | "error" = "ok";
  try {
    await sql`SELECT 1`;
  } catch (err) {
    database = "error";
    logger.error({ err }, "[readyz] database check failed");
  }

  const ingest = await probeIngest();
  const dashboard: "ok" = "ok";
  const services = { dashboard, ingest, database } as const;
  const healthy = services.dashboard === "ok" && services.ingest === "ok" && services.database === "ok";
  const status: "ok" | "degraded" = healthy ? "ok" : "degraded";

  return {
    status,
    healthy,
    services,
    uptime: process.uptime(),
    database: { status: database },
    flusher: metricsFlusher.stats,
    timestamp: new Date().toISOString(),
  };
}

// Liveness: static, no DB.
health.get("/", (c) => c.json(livenessPayload()));
health.get("/live", (c) => c.json(livenessPayload()));

// Readiness: DB + flusher telemetry + service health.
health.get("/ready", async (c) => {
  const payload = await readinessPayload();
  return c.json(payload, payload.healthy ? 200 : 503);
});

export default health;
