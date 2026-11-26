/**
 * Tuple helpers — small combinators over fixed-arity pairs `[A, B]`.
 * These helpers let pairs be destructured and reshaped without index
 * magic (`pair[1][0]`) at call sites.
 */

/** First component. */
export function fst<A, B>(pair: readonly [A, B]): A {
  return pair[0]
}

/** Second component. */
export function snd<A, B>(pair: readonly [A, B]): B {
  return pair[1]
}

/** Flip the components. */
export function swap<A, B>(pair: readonly [A, B]): readonly [B, A] {
  return [pair[1], pair[0]]
}

/** Map both components in one pass (bifunctor `bimap`). */
export function bimap<A, B, C, D>(pair: readonly [A, B], f: (a: A) => C, g: (b: B) => D): readonly [C, D] {
  return [f(pair[0]), g(pair[1])]
}
