import { describe, expect, it } from "vitest";
import { Maybe } from "../maybe.ts";

describe("Maybe", () => {
  it("constructs just/nothing/fromNullable", () => {
    expect(Maybe.just(1).isJust()).toBe(true);
    expect(Maybe.nothing<number>().isNothing()).toBe(true);
    expect(Maybe.fromNullable(null).isNothing()).toBe(true);
    expect(Maybe.fromNullable(undefined).isNothing()).toBe(true);
    expect(Maybe.fromNullable(5).isJust()).toBe(true);
    expect(Maybe.just(null as any).isNothing()).toBe(true);
  });

  it("map, flatMap, filter, exists", () => {
    expect(Maybe.just(2).map((n) => n + 1).getOrElse(0)).toBe(3);
    expect(Maybe.nothing<number>().map((n) => n + 1).isNothing()).toBe(true);
    expect(Maybe.just(2).flatMap((n) => Maybe.just(n * 2)).getOrElse(0)).toBe(4);
    expect(Maybe.just(2).filter((n) => n > 5).isNothing()).toBe(true);
    expect(Maybe.just(2).exists((n) => n === 2)).toBe(true);
    expect(Maybe.nothing<number>().exists(() => true)).toBe(false);
  });

  it("getOrElse, orElse, match, toNullable", () => {
    expect(Maybe.nothing<number>().getOrElse(7)).toBe(7);
    expect(Maybe.nothing<number>().orElse(() => Maybe.just(8)).getOrElse(0)).toBe(8);
    expect(Maybe.just(3).match({ just: (v) => v + 1, nothing: () => 0 })).toBe(4);
    expect(Maybe.nothing<number>().match({ just: (v) => v, nothing: () => -1 })).toBe(-1);
    expect(Maybe.just(9).toNullable()).toBe(9);
    expect(Maybe.nothing<number>().toNullable()).toBeNull();
  });

  it("toEither bridges absence to typed error", () => {
    const r = Maybe.just(1).toEither(() => "missing");
    expect(r.isRight()).toBe(true);
    expect(r.getOrElse(0)).toBe(1);
    const l = Maybe.nothing<number>().toEither(() => "missing");
    expect(l.isLeft()).toBe(true);
    expect(l.match({ left: (e) => e, right: () => "" })).toBe("missing");
  });

  it("catMaybes collects present values", () => {
    expect(Maybe.catMaybes([Maybe.just(1), Maybe.nothing<number>(), Maybe.just(3)])).toEqual([1, 3]);
  });
});
