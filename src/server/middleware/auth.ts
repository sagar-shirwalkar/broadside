import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../../logger.js";

/** Failed-attempt budget per client: after this many bad tokens inside one
 *  window, further attempts get a 429 until the window rolls over. */
const FAILURE_LIMIT = 30;
const FAILURE_WINDOW_MS = 60_000;

interface FailureWindow {
  count: number;
  resetAt: number;
}

/**
 * Bearer-token authentication for the HTTP API and the WebSocket ingest
 * endpoint. `GET /api/health` is intentionally left unauthenticated so
 * load balancers and uptime monitors can probe it.
 *
 * A token may be presented as `Authorization: Bearer <token>`, or — for
 * WebSocket and EventSource clients that cannot set headers — as the
 * `token` query parameter. Query parameters can appear in access logs, so
 * prefer the header wherever the client allows it.
 *
 * An empty `token` disables authentication entirely (local development).
 * Register CORS before this middleware so preflight requests, which never
 * carry credentials, are answered before authentication runs.
 */
export function createAuthMiddleware(
  token: string,
): MiddlewareHandler<AppEnv> {
  // Per-client failure counters, in memory only. This is a blunt instrument
  // against token guessing on a shared-secret service, not a substitute for
  // putting the service behind a proper identity proxy.
  const failures = new Map<string, FailureWindow>();

  return async (c, next) => {
    if (token === "") {
      await next();
      return;
    }

    const client = clientKey(c.req.header("x-forwarded-for"));
    const presented = bearerToken(c.req.header("authorization")) ??
      c.req.query("token");

    // A correct token always succeeds; only failed attempts count toward
    // the budget, so one client's guessing cannot lock out another user
    // behind the same NAT.
    if (presented !== undefined && tokensMatch(presented, token)) {
      failures.delete(client);
      await next();
      return;
    }

    const now = Date.now();
    const window = failures.get(client);
    const count = window && now < window.resetAt ? window.count : 0;
    if (count >= FAILURE_LIMIT) {
      return c.json({ error: "too many attempts" }, 429);
    }
    failures.set(client, {
      count: count + 1,
      resetAt: count === 0 ? now + FAILURE_WINDOW_MS : window!.resetAt,
    });
    c.header("WWW-Authenticate", "Bearer");
    return c.json({ error: "unauthorized" }, 401);
  };
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  return header.startsWith("Bearer ") ? header.slice(7) : undefined;
}

function tokensMatch(presented: string, expected: string): boolean {
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  if (presentedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(presentedBuf, expectedBuf);
}

function clientKey(forwarded: string | undefined): string {
  const first = forwarded?.split(",")[0]?.trim();
  return first || "local";
}
