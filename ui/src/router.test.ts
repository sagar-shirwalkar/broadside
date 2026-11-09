import { describe, expect, it } from "vitest";
import { parseHash } from "./router.js";

describe("parseHash", () => {
  it("maps the root hash to the overview", () => {
    expect(parseHash("#/")).toEqual({ name: "overview" });
    expect(parseHash("")).toEqual({ name: "overview" });
  });

  it("parses the overview and runs routes", () => {
    expect(parseHash("#/overview")).toEqual({ name: "overview" });
    expect(parseHash("#/runs")).toEqual({ name: "list" });
  });

  it("parses a run detail route", () => {
    expect(parseHash("#/runs/abc-123")).toEqual({
      name: "detail",
      id: "abc-123",
    });
  });

  it("parses a live route", () => {
    expect(parseHash("#/runs/abc-123/live")).toEqual({
      name: "live",
      id: "abc-123",
    });
  });

  it("parses the compare route", () => {
    expect(parseHash("#/compare")).toEqual({ name: "compare" });
  });

  it("url-decodes ids", () => {
    expect(parseHash("#/runs/a%20b")).toEqual({ name: "detail", id: "a b" });
  });

  it("falls back to not-found for unknown paths", () => {
    expect(parseHash("#/nope")).toEqual({
      name: "not-found",
      path: "/nope",
    });
  });

  it("maps bare /runs (no id) to the run list", () => {
    expect(parseHash("#/runs")).toEqual({ name: "list" });
  });

  it("treats extra segments as not-found", () => {
    expect(parseHash("#/runs/abc/extra")).toEqual({
      name: "not-found",
      path: "/runs/abc/extra",
    });
  });
});
