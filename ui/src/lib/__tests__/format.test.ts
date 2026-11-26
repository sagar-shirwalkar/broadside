import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatMs,
  formatPercent,
  latencyClass,
  relativeTime,
} from ".././format.ts";

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(250)).toBe("250 ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.5 s");
  });

  it("formats minutes", () => {
    expect(formatDuration(95_000)).toBe("1m 35s");
  });

  it("formats hours", () => {
    expect(formatDuration(3_660_000)).toBe("1h 1m");
  });

  it("handles null", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("latencyClass", () => {
  it("is green below 200ms", () => {
    expect(latencyClass(199)).toBe("lat-ok");
  });

  it("is amber from 200 to 499ms", () => {
    expect(latencyClass(200)).toBe("lat-warn");
    expect(latencyClass(499)).toBe("lat-warn");
  });

  it("is red at 500ms and above", () => {
    expect(latencyClass(500)).toBe("lat-bad");
  });

  it("handles null", () => {
    expect(latencyClass(null)).toBe("");
  });
});

describe("formatMs / formatPercent", () => {
  it("formats milliseconds and seconds", () => {
    expect(formatMs(120)).toBe("120 ms");
    expect(formatMs(1500)).toBe("1.50 s");
    expect(formatMs(null)).toBe("—");
  });

  it("formats fractions as percents", () => {
    expect(formatPercent(0.023)).toBe("2.3%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("relativeTime", () => {
  it("says seconds for recent timestamps", () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(iso)).toBe("30s ago");
  });

  it("says minutes and hours", () => {
    const minutes = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(minutes)).toBe("5m ago");
    const hours = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(relativeTime(hours)).toBe("3h ago");
  });

  it("says days for older timestamps", () => {
    const days = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(relativeTime(days)).toBe("4d ago");
  });
});
