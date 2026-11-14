import { describe, expect, it, vi } from "vitest";
import { runCmd } from ".././cmd.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runCmd", () => {
  it("dispatches the resolved action", async () => {
    const dispatch = vi.fn();
    runCmd(async () => ({ type: "loaded", value: 1 }) as const, dispatch);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "loaded", value: 1 });
  });

  it("ignores rejected commands (runtime does not throw)", async () => {
    const dispatch = vi.fn();
    runCmd(async () => {
      throw new Error("boom");
    }, dispatch);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches actions in resolution order when commands complete out of order", async () => {
    const dispatch = vi.fn();
    const a = deferred<string>();
    const b = deferred<string>();

    runCmd(() => a.promise, dispatch);
    runCmd(() => b.promise, dispatch);

    b.resolve("b");
    await Promise.resolve();
    await Promise.resolve();
    a.resolve("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(["b", "a"]);
  });
});
