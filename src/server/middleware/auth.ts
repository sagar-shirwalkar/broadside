import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../../logger.js";

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
  return async (c, next) => {
    if (token === "") {
      await next();
      return;
    }

    const presented = bearerToken(c.req.header("authorization")) ??
      c.req.query("token");

    if (presented === undefined || !tokensMatch(presented, token)) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
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
