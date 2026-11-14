import { describe, expect, it } from "vitest";
import { update } from ".././update.ts";
import { initialState, type State } from ".././types.ts";

function baseState(): State {
  return { ...initialState("run-1") };
}

describe("run-detail update", () => {
  it("sets run and chooses 10s granularity for short runs", () => {
    const state = baseState();
    const next = update(state, {
      type: "run_loaded",
      run: { id: "run-1", duration_ms: 60_000, started_at: "2026-01-01T00:00:00Z" } as any,
    });
    expect(next.run?.id).toBe("run-1");
    expect(next.granularity).toBe("10s");
  });

  it("sets endpoint and clears zoom state", () => {
    const state = {
      ...baseState(),
      zoomByPanel: new Map([["rps", { from: 1, to: 2 }]] as const),
    } as State;
    const next = update(state, { type: "set_endpoint", endpoint: "/api" });
    expect(next.endpoint).toBe("/api");
    expect(next.zoomByPanel.size).toBe(0);
    expect(next.rawByPanel.size).toBe(0);
  });

  it("marks missing and loading transitions", () => {
    let state = update(baseState(), { type: "load_started" });
    expect(state.loading).toBe(true);
    expect(state.missing).toBe(false);
    state = update(state, { type: "missing" });
    expect(state.missing).toBe(true);
    state = update(state, { type: "loading_done" });
    expect(state.loading).toBe(false);
  });
});
