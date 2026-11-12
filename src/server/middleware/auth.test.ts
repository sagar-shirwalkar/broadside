import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createAuthMiddleware } from "./auth.js";

function appWith(token: string) {
  const app = new Hono();
  app.use(createAuthMiddleware(token));
  app.get("/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("createAuthMiddleware", () => {
  it("allows every request when no token is configured", async () => {
    const app = appWith("");

    const res = await app.request("/protected");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects requests without credentials", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("accepts a matching bearer token", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer secret" },
    });

    expect(res.status).toBe(200);
  });

  it("rejects a wrong bearer token", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer nope" },
    });

    expect(res.status).toBe(401);
  });

  it("rejects a bearer token of a different length", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer s" },
    });

    expect(res.status).toBe(401);
  });

  it("rejects a non-bearer authorization scheme", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected", {
      headers: { Authorization: "Basic secret" },
    });

    expect(res.status).toBe(401);
  });

  it("accepts the token as a query parameter", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected?token=secret");

    expect(res.status).toBe(200);
  });

  it("rejects a wrong query token", async () => {
    const app = appWith("secret");

    const res = await app.request("/protected?token=nope");

    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failures and recovers after a success", async () => {
    const app = appWith("secret");

    for (let i = 0; i < 30; i += 1) {
      const res = await app.request("/protected", {
        headers: { Authorization: "Bearer wrong" },
      });
      expect(res.status).toBe(401);
    }

    const limited = await app.request("/protected", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many attempts" });

    const otherClient = await app.request("/protected", {
      headers: {
        Authorization: "Bearer wrong",
        "x-forwarded-for": "203.0.113.7",
      },
    });
    expect(otherClient.status).toBe(401);

    const success = await app.request("/protected", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(success.status).toBe(200);
  });
});
