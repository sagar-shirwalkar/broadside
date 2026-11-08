/**
 * Monoid<A> — an associative binary operation with a two-sided identity. The algebra behind
 * "combine many values into one": every foldMap, every log accumulation, every record merge in
 * this codebase is a monoid in disguise; naming it lets the combining rule travel with the data
 * instead of being re-derived inside each reduce callback.
 *
 * Laws (the tests pin them):
 *   - associativity:  concat(concat(a,b),c) ≡ concat(a,concat(b,c))
 *   - left identity:  concat(empty,a) ≡ a
 *   - right identity: concat(a,empty) ≡ a
 *
 * Pure TypeScript (no platform/Web/Node globals), so it is safe in the scoped runtime.
 */

export interface Monoid<A> {
  /** The neutral element: folding it in changes nothing. */
  readonly empty: A
  /** An associative combination of two values. */
  readonly concat: (left: A, right: A) => A
}

// Monoid Number  (+)
export const sumMonoid: Monoid<number> = { empty: 0, concat: (l, r) => l + r }

// Monoid Number  (×)
export const productMonoid: Monoid<number> = { empty: 1, concat: (l, r) => l * r }

// Monoid String  (++)
export const stringMonoid: Monoid<string> = { empty: '', concat: (l, r) => l + r }

// Monoid Bool under && / ||
export const allMonoid: Monoid<boolean> = { empty: true, concat: (l, r) => l && r }
export const anyMonoid: Monoid<boolean> = { empty: false, concat: (l, r) => l || r }

// ∀A. Monoid [A]  (++)
export function arrayMonoid<A>(): Monoid<A[]> {
  return { empty: [], concat: (l, r) => [...l, ...r] }
}

// ∀V. Monoid (Record String V)  ({...} merge; RIGHT wins on key conflicts — the same
// later-columns-override-earlier convention the DAO write maps already follow)
export function recordMonoid<V>(): Monoid<Record<string, V>> {
  return { empty: {}, concat: (l, r) => ({ ...l, ...r }) }
}

// ∀A. Ord A ⇒ Monoid A  (min/max; empty = ±Infinity — honest for numbers, which is the only
// Ord this runtime gives us without an ordering class)
export const minMonoid: Monoid<number> = {
  empty: Number.POSITIVE_INFINITY,
  concat: (l, r) => Math.min(l, r),
}
export const maxMonoid: Monoid<number> = {
  empty: Number.NEGATIVE_INFINITY,
  concat: (l, r) => Math.max(l, r),
}

// ∀A B. Monoid B → (A → B) → [A] → B — map each element into the monoid and fold. The general
// shape of every counting/tallying reduce ("count of OK", "sum of scores"): name the algebra,
// then foldMap replaces the hand-written accumulator.
export function foldMap<A, B>(M: Monoid<B>, f: (a: A) => B): (as: readonly A[]) => B {
  return (as) => mconcat(M, as.map(f))
}

// ∀A. Monoid A → [A] → A — fold with the monoid's own identity (so [] folds to empty, not a crash)
export function mconcat<A>(M: Monoid<A>, as: readonly A[]): A {
  return as.reduce((acc, a) => M.concat(acc, a), M.empty)
}
