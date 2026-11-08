import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createAuthMiddleware } from "../src/server/middleware/auth.js";

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
});
