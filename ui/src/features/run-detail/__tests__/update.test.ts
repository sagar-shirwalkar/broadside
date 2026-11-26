import { describe, expect, it } from "vitest";
import { update } from ".././update.ts";
import { initialState, type State } from ".././types.ts";

function baseState(): State {
  return { ...initialState("run-1") };
}

import { Maybe } from "@broadside/fp/maybe";

describe("run-detail update", () => {
  it("resolves a run and chooses 10s granularity for short runs", () => {
    const state = baseState();
    const next = update(state, {
      type: "run_resolved",
      run: Maybe.just({ id: "run-1", duration_ms: 60_000, started_at: "2026-01-01T00:00:00Z" } as any),
    });
    expect(next.loading).toBe(false);
    expect(next.run.isJust()).toBe(true);
    expect(next.run.toNullable()?.id).toBe("run-1");
    expect(next.granularity).toBe("10s");
  });

  it("resolves absence as Maybe.nothing and stops loading", () => {
    let state = update(baseState(), { type: "load_started" });
    expect(state.loading).toBe(true);
    state = update(state, { type: "run_resolved", run: Maybe.nothing() });
    expect(state.loading).toBe(false);
    expect(state.run.isNothing()).toBe(true);
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
});
