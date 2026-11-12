import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const registry = new Map<string, unknown>();
  class MockLitElement {
    requestUpdate = vi.fn();
    connectedCallback() {}
  }
  return {
    registry,
    MockLitElement,
    define: vi.fn((name: string, ctor: unknown) => {
      registry.set(name, ctor);
    }),
    get: vi.fn((name: string) => registry.get(name)),
  };
});

vi.mock("lit", () => ({ LitElement: h.MockLitElement }));

import { createTeaComponent } from "./runtime.js";

describe("createTeaComponent", () => {
  beforeEach(() => {
    h.registry.clear();
    h.define.mockClear();
    h.get.mockClear();
    vi.stubGlobal("customElements", { define: h.define, get: h.get } as any);
  });

  it("registers a custom element once and wires init/update/render", async () => {
    const initFn = vi.fn(() => ({ model: { count: 0 } }));
    const updateFn = vi.fn((model: { count: number }, action: { type: "inc" }) => ({
      count: model.count + 1,
    }));
    const viewFn = vi.fn((model: { count: number }) => `count:${model.count}` as any);

    createTeaComponent("test-tea-a", initFn, updateFn, viewFn);
    createTeaComponent("test-tea-a", initFn, updateFn, viewFn); // no duplicate define

    expect(h.define).toHaveBeenCalledTimes(1);
    expect(h.define).toHaveBeenCalledWith("test-tea-a", expect.any(Function));

    const Ctor = h.define.mock.calls[0][1] as new () => any;
    const el = new Ctor();
    el.connectedCallback();

    expect(initFn).toHaveBeenCalledTimes(1);
    expect(el.requestUpdate).toHaveBeenCalledTimes(1);
    expect(el.render()).toBe("count:0");
    expect(viewFn).toHaveBeenLastCalledWith({ count: 0 }, el.dispatch, el.run);

    el.dispatch({ type: "inc" });
    expect(updateFn).toHaveBeenCalledWith({ count: 0 }, { type: "inc" });
    expect(el.requestUpdate).toHaveBeenCalledTimes(2);
    expect(el.render()).toBe("count:1");
  });

  it("runs init cmd and run(cmd) effects through dispatch", async () => {
    const initCmd = vi.fn(async () => ({ type: "ready" } as const));
    const initFn = () => ({ model: { ready: false }, cmd: initCmd });
    const updateFn = vi.fn((model: { ready: boolean }, action: { type: string }) =>
      action.type === "ready" ? { ready: true } : model,
    );
    const viewFn = vi.fn(() => "v" as any);

    createTeaComponent("test-tea-b", initFn, updateFn, viewFn);
    const Ctor = h.define.mock.calls.find((c) => c[0] === "test-tea-b")![1] as new () => any;
    const el = new Ctor();
    el.connectedCallback();

    await Promise.resolve();
    await Promise.resolve();

    expect(updateFn).toHaveBeenCalledWith({ ready: false }, { type: "ready" });
    expect(el.requestUpdate).toHaveBeenCalledTimes(2); // connect + dispatched cmd
    expect(el.render()).toBe("v");

    const manualCmd = vi.fn(async () => ({ type: "ready" } as const));
    el.run(manualCmd);
    await Promise.resolve();
    await Promise.resolve();

    expect(manualCmd).toHaveBeenCalledTimes(1);
    expect(updateFn).toHaveBeenCalledTimes(2);
  });
});
