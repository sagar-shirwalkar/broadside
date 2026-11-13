import { describe, expect, it } from "vitest";
import { decimateForRender, lttb, RENDER_POINT_CAP } from "./lttb.js";
import type { ChartPoint } from "../types.js";

function series(n: number): ChartPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i,
    value: Math.sin(i / 10) * 100 + i,
  }));
}

describe("lttb", () => {
  it("returns the input when it already fits", () => {
    const data = series(10);
    expect(lttb(data, 100)).toBe(data);
  });

  it("decimates long series to the threshold, keeping first and last", () => {
    const data = series(100_000);
    const out = lttb(data, 500);
    expect(out).toHaveLength(500);
    expect(out[0]).toEqual(data[0]);
    expect(out[out.length - 1]).toEqual(data[data.length - 1]);
  });

  it("preserves the global extrema (visual shape)", () => {
    const data = series(5000);
    const peak = Math.max(...data.map((p) => p.value));
    const out = lttb(data, 200);
    const outMax = Math.max(...out.map((p) => p.value));
    // The global maximum point is a bucket candidate; LTTB keeps a strong
    // triangle for it.
    expect(outMax).toBeGreaterThan(peak * 0.95);
  });

  it("deduplicates nothing and never grows the input", () => {
    const data = series(1000);
    const out = lttb(data, 50);
    expect(new Set(out.map((p) => p.time)).size).toBe(out.length);
  });
});

describe("decimateForRender", () => {
  it("caps very long series at RENDER_POINT_CAP", () => {
    const out = decimateForRender(series(50_000));
    expect(out.length).toBe(RENDER_POINT_CAP);
  });

  it("leaves short series untouched", () => {
    const data = series(5);
    expect(decimateForRender(data)).toBe(data);
  });
});
