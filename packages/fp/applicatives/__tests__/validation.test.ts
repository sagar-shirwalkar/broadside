import { describe, expect, it } from "vitest";
import { Validation } from "../validation.ts";

describe("Validation", () => {
  it("constructs ok values", () => {
    const v = Validation.ok<string, number>(42);
    expect(v.isOk()).toBe(true);
    expect(v.isFail()).toBe(false);
    expect(v.valueOrUndefined).toBe(42);
    expect(v.violationArray).toEqual([]);
  });

  it("constructs fail values and enforces non-empty violations", () => {
    const v = Validation.fail<string, number>("bad");
    expect(v.isFail()).toBe(true);
    expect(v.isOk()).toBe(false);
    expect(v.valueOrUndefined).toBeUndefined();
    expect(v.violationArray).toEqual(["bad"]);
    expect(() => Validation.failFromArray([])).toThrow();
  });

  it("maps over ok and preserves failures", () => {
    expect(Validation.ok<string, number>(2).map((n) => n + 1).valueOrUndefined).toBe(3);
    const failed = Validation.fail<string, number>("e1").map((n) => n + 1);
    expect(failed.isFail()).toBe(true);
    expect(failed.violationArray).toEqual(["e1"]);
  });

  it("flatMap short-circuits on failure", () => {
    const ok = Validation.ok<string, number>(2).flatMap((n) => Validation.ok(n * 3));
    expect(ok.valueOrUndefined).toBe(6);
    const left = Validation.fail<string, number>("e1").flatMap((n) => Validation.ok(n * 3));
    expect(left.violationArray).toEqual(["e1"]);
    const right = Validation.ok<string, number>(2).flatMap(() => Validation.fail("e2"));
    expect(right.violationArray).toEqual(["e2"]);
  });

  it("ap applies function in ok and accumulates violations from both sides", () => {
    const fn = Validation.ok<string, (n: number) => number>((n) => n * 2) as any;
    const applied = fn.ap(Validation.ok<string, number>(21));
    expect(applied.isOk()).toBe(true);
    expect(applied.valueOrUndefined).toBe(42);

    const bothFail = Validation.fail<string, any>("a").ap(Validation.fail<string, any>("b"));
    expect(bothFail.isFail()).toBe(true);
    expect(bothFail.violationArray).toEqual(["a", "b"]);

    const leftFail = Validation.fail<string, any>("a").ap(Validation.ok<string, number>(1));
    expect(leftFail.violationArray).toEqual(["a"]);
    const rightFail = (Validation.ok<string, (n: number) => number>((n) => n) as any).ap(
      Validation.fail<string, number>("b"),
    );
    expect(rightFail.violationArray).toEqual(["b"]);
  });

  it("match folds both channels", () => {
    expect(
      Validation.ok<string, number>(1).match({ ok: (v) => v + 1, fail: () => 0 }),
    ).toBe(2);
    expect(
      Validation.fail<string, number>("x").match({ ok: () => "ok", fail: (vs) => vs.join(",") }),
    ).toBe("x");
  });
});
