/**
 * Predicate combinators — first-class boolean-returning functions you can compose with `and`,
 * `or`, `not` instead of writing a fresh nested-conditional one-off at every call site. A
 * Predicate<A> is just `(a: A) => boolean`, but naming it unlocks algebras conveniently.
 *
 * When to reach for it: the SAME predicate gets reused/composed across call sites, or a filter
 * reads as prose when written combinatorially.
 *
 * When NOT: a single inline `(x) => x > 0` used once — that is already the right code.
 */

export type Predicate<A> = (value: A) => boolean

export const alwaysTrue =
  <A>(): Predicate<A> =>
  () =>
    true
export const alwaysFalse =
  <A>(): Predicate<A> =>
  () =>
    false

/** Negation. */
export function not<A>(p: Predicate<A>): Predicate<A> {
  return (value) => !p(value)
}

/** Conjunction — short-circuits left to right, like `&&`. */
export function and<A>(...ps: ReadonlyArray<Predicate<A>>): Predicate<A> {
  return (value) => ps.every((p) => p(value))
}

/** Disjunction — short-circuits left to right, like `||`. */
export function or<A>(...ps: ReadonlyArray<Predicate<A>>): Predicate<A> {
  return (value) => ps.some((p) => p(value))
}

/** Contravariant map: turn a Predicate<B> into a Predicate<A> by pre-projecting A → B
 * (`contramap((a) => a.state)(isOneOf('PUBLISHED'))`). */
export function contramap<A, B>(project: (value: A) => B): (p: Predicate<B>) => Predicate<A> {
  return (p) => (value) => p(project(value))
}

/** Membership as a predicate — replaces `['A','B'].includes(x)` chains with a named value. */
export function isOneOf<A>(candidates: readonly A[]): Predicate<A> {
  return (value) => candidates.includes(value)
}
