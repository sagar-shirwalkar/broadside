/**
 * pipe / identity / tapWith — left-to-right function composition. The missing baseline of any
 * FP library: `pipe(f, g, h)` is `(x) => h(g(f(x)))`, typed so the output type of each stage
 * must feed the next (the compiler enforces the pipeline actually connects). Replaces
 * single-use intermediate variables when the intermediates have no name worth saying aloud,
 * and makes dataflow order read top-to-bottom.
 *
 * When to reach for it: ≥2 pure stages where the value just flows. When NOT: a chain with a
 * monadic step in the middle — fold through Maybe/Either/Transaction instead; piping into
 * `.flatMap` lambdas is ceremony, not composition.
 */

export function identity<A>(a: A): A {
  return a
}

// Overloads give real inference for the common arities; the implementation is a plain reduce.
export function pipe<A, B>(ab: (a: A) => B): (a: A) => B
export function pipe<A, B, C>(ab: (a: A) => B, bc: (b: B) => C): (a: A) => C
export function pipe<A, B, C, D>(ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): (a: A) => D
export function pipe<A, B, C, D, E>(ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D, de: (d: D) => E): (a: A) => E
export function pipe<A, B, C, D, E, F>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
): (a: A) => F
export function pipe<A, B, C, D, E, F, G>(
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
): (a: A) => G
export function pipe(...fns: ReadonlyArray<(value: unknown) => unknown>): (value: unknown) => unknown {
  return (value) => fns.reduce((acc, f) => f(acc), value)
}

/** Run a side-effecting observer INSIDE a pipeline without breaking the flow
 * (`pipe(parse, tapWith(gs.info), respond)`). Returns the value unchanged. */
export function tapWith<A>(observe: (value: A) => void): (value: A) => A {
  return (value) => {
    observe(value)
    return value
  }
}
