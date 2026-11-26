import { describe, expect, it } from "vitest";
import { Either } from "../either.ts";

describe("Either", () => {
  it("constructs left/right and reports channel", () => {
    const r = Either.right<string, number>(1);
    const l = Either.left<string, number>("err");
    expect(r.isRight()).toBe(true);
    expect(r.isLeft()).toBe(false);
    expect(l.isLeft()).toBe(true);
    expect(l.isRight()).toBe(false);
  });

  it("maps over right and preserves left", () => {
    expect(Either.right<string, number>(2).map((n) => n + 1).getOrElse(0)).toBe(3);
    expect(Either.left<string, number>("e").map((n) => n + 1).isLeft()).toBe(true);
  });

  it("mapLeft transforms left only", () => {
    expect(Either.left<string, number>("e").mapLeft((e) => e + "!").match({ left: (e) => e, right: () => "" })).toBe("e!");
    expect(Either.right<string, number>(1).mapLeft((e) => e + "!").isRight()).toBe(true);
  });

  it("flatMap chains on right and short-circuits on left", () => {
    const ok = Either.right<string, number>(2).flatMap((n) => Either.right(n * 2));
    expect(ok.getOrElse(0)).toBe(4);
    const short = Either.left<string, number>("e").flatMap((n) => Either.right(n * 2));
    expect(short.match({ left: (e) => e, right: () => "" })).toBe("e");
  });

  it("match, getOrElse, orElse, tap/tapLeft behave correctly", () => {
    expect(Either.right<string, number>(5).match({ left: () => 0, right: (v) => v })).toBe(5);
    expect(Either.left<string, number>("x").match({ left: (e) => e, right: () => "" })).toBe("x");
    expect(Either.left<string, number>("x").getOrElse(9)).toBe(9);
    expect(Either.left<string, number>("x").orElse((e) => Either.right(e.length)).getOrElse(0)).toBe(1);

    let seenR = 0;
    let seenL = "";
    Either.right<string, number>(3).tap((v) => (seenR = v)).tapLeft((e) => (seenL = e));
    Either.left<string, number>("e").tap((v) => (seenR = v + 10)).tapLeft((e) => (seenL = e));
    expect(seenR).toBe(3);
    expect(seenL).toBe("e");
  });
});
