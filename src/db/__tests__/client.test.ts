import { describe, expect, it, vi } from "vitest";

const { postgresMock, client } = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return { postgresMock: vi.fn(() => client), client };
});

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("../../config.ts", () => ({
  config: { databaseUrl: "postgres://user:pass@db:5432/broadside" },
}));

describe("database client", () => {
  it("creates a pooled postgres client from the configured URL", async () => {
    vi.resetModules();
    postgresMock.mockClear();
    postgresMock.mockReturnValue(client);

    const { sql } = await import(".././client.ts");

    expect(postgresMock).toHaveBeenCalledWith(
      "postgres://user:pass@db:5432/broadside",
      {
        max: 10,
        idle_timeout: 30,
        connect_timeout: 10,
      },
    );
    expect(sql).toBe(client);
  });
});
