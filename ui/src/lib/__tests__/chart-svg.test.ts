import { describe, expect, it } from "vitest";
import {
  areaPathFrom,
  linScale,
  linePathFrom,
  nearestTime,
  niceTicks,
  tickStep,
} from ".././chart-svg.ts";

describe("linScale", () => {
  it("maps domain onto range and inverts", () => {
    const scale = linScale([0, 100], [0, 1000]);
    expect(scale(0)).toBe(0);
    expect(scale(50)).toBe(500);
    expect(scale.invert(250)).toBe(25);
  });

  it("supports descending ranges (y axis)", () => {
    const scale = linScale([0, 10], [200, 0]);
    expect(scale(0)).toBe(200);
    expect(scale(10)).toBe(0);
  });
});

describe("tickStep / niceTicks", () => {
  it("picks 1/2/5×10^n steps", () => {
    expect(tickStep(0, 100, 5)).toBe(20);
    expect(tickStep(0, 10, 5)).toBe(2);
  });

  it("aligns ticks to multiples of the step", () => {
    expect(niceTicks(0, 8.8, 5)).toEqual([0, 2, 4, 6, 8]);
  });

  it("returns a single tick for a degenerate range", () => {
    expect(niceTicks(5, 5, 5)).toEqual([5]);
  });
});

describe("linePathFrom / areaPathFrom", () => {
  const points = [
    { time: 0, value: 0 },
    { time: 10, value: 10 },
    { time: 20, value: 5 },
  ];
  const x = (t: number) => t;
  const y = (v: number) => 100 - v;

  it("builds a polyline", () => {
    expect(linePathFrom(points, x, y)).toBe(
      "M0.00,100.00 L10.00,90.00 L20.00,95.00",
    );
  });

  it("closes the area along the bottom", () => {
    expect(areaPathFrom(points, x, y, 100)).toBe(
      "M0.00,100.00 L10.00,90.00 L20.00,95.00 L20.00,100 L0.00,100 Z",
    );
  });

  it("returns an empty area for fewer than two points", () => {
    expect(areaPathFrom(points.slice(0, 1), x, y, 100)).toBe("");
  });
});

describe("nearestTime", () => {
  const times = [100, 200, 300];

  it("returns null for empty input", () => {
    expect(nearestTime([], 150)).toBeNull();
  });

  it("picks the closer of the bracketing points", () => {
    expect(nearestTime(times, 160)).toBe(200);
    expect(nearestTime(times, 140)).toBe(100);
    expect(nearestTime(times, 500)).toBe(300);
    expect(nearestTime(times, 0)).toBe(100);
  });
});
