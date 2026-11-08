/**
 * Either<L, R> — a hand-written either monad for **errors-as-values**. Models a computation
 * that yields either a failure (`Left<L>`) or a success (`Right<R>`), so "can this fail, and
 * how?" lives in the type instead of a thrown exception smuggled up the call stack. It is the
 * error-carrying companion to `Maybe<T>` (absence): reach for `Either` when the failed case
 * carries a *reason* a caller must handle (a 404/409/403 value, say).
 *
 * Haskell's `Either a b`: by convention the error is on the **`Left`** and the success on the
 * **`Right`** (mnemonic: "right" = correct). The type params follow that order — `L` first
 * (the error), `R` second (the value) — matching `Either e a`. Haskell-flavoured combinators:
 * `left` / `right` constructors, `map` (fmap over Right), `mapLeft` (fmap over the error),
 * `flatMap` (>>=/bind over Right), `getOrElse`, `orElse` (recover), `match` (the `either`
 * catamorphism). Mirrors the naming discipline of `maybe.ts` in this dir.
 *
 * Representation invariant: exactly one channel is inhabited — `tag === 'right'` ⟺ a value is
 * present; `tag === 'left'` ⟺ an error is present, never both. Every combinator preserves this
 * and short-circuits on `Left`: a `Left` flows through `map` / `flatMap` untouched, carrying
 * its error forward — exactly Haskell's `Either` monad (which is right-biased).
 *
 * Boundary rule (important): keep `Either` for INTERNAL control flow and fold it to an outcome
 * exactly ONCE, at the edge — a REST handler ends with
 * `either.match({ left: …respondError…, right: …respond… })`, the single place the error
 * becomes an HTTP status. Do NOT `throw` inside a `map` / `flatMap` / `match` — that re-smuggles
 * the error through the stack and defeats errors-as-values; return a `Left` and let the edge
 * fold decide. Bridge from absence with `Maybe.toEither(() => makeError())`.
 *
 * Pure TypeScript (no platform/Web/Node globals), so it is safe in the scoped runtime.
 */
export class Either<L, R> {
  /** `tag === 'right'` ⟺ a success value; `tag === 'left'` ⟺ an error — exactly one, never both. */
  private constructor(
    private readonly tag: 'left' | 'right',
    private readonly value: L | R,
  ) {}

  /** Wrap a failure (`Left e`) — the typed error travels as a value, not a throw. */
  static left<L, R = never>(error: L): Either<L, R> {
    return new Either<L, R>('left', error)
  }

  /** Wrap a success (`Right x`). */
  static right<L = never, R = never>(value: R): Either<L, R> {
    return new Either<L, R>('right', value)
  }

  /** True when this is a success (`Right`). */
  isRight(): boolean {
    return this.tag === 'right'
  }

  /** True when this is a failure (`Left`). */
  isLeft(): boolean {
    return this.tag === 'left'
  }

  /** fmap: transform the Right value; a `Left` passes through untouched, carrying its error. */
  map<U>(f: (value: R) => U): Either<L, U> {
    return this.tag === 'right' ? Either.right<L, U>(f(this.value as R)) : Either.left<L, U>(this.value as L)
  }

  /** fmap over the error channel: transform the Left; a `Right` passes through untouched. */
  mapLeft<F>(f: (error: L) => F): Either<F, R> {
    return this.tag === 'left' ? Either.left<F, R>(f(this.value as L)) : Either.right<F, R>(this.value as R)
  }

  /** bind / `>>=`: chain an Either-returning step on Right; a `Left` short-circuits it. */
  flatMap<U>(f: (value: R) => Either<L, U>): Either<L, U> {
    return this.tag === 'right' ? f(this.value as R) : Either.left<L, U>(this.value as L)
  }

  /** The Right value, or the fallback when this is a `Left`. */
  getOrElse(fallback: R): R {
    return this.tag === 'right' ? (this.value as R) : fallback
  }

  /** Recover: this if `Right`, else the (lazily-evaluated) alternative Either from the error. */
  orElse(alternative: (error: L) => Either<L, R>): Either<L, R> {
    return this.tag === 'right' ? this : alternative(this.value as L)
  }

  /**
   * The `either` catamorphism: fold to a single value by handling both channels (`left` then
   * `right`, as in Haskell's `either f g`). The primary bridge from Either back to
   * imperative/HTTP code at the edge (e.g. `left → the typed error's status`, `right → 200`).
   * Keep the fold side-effect-free except at that outermost boundary.
   */
  match<U>(handlers: { left: (error: L) => U; right: (value: R) => U }): U {
    return this.tag === 'right' ? handlers.right(this.value as R) : handlers.left(this.value as L)
  }

  /** Run a side-effect on the Right value (returns `this` for chaining). */
  tap(f: (value: R) => void): Either<L, R> {
    if (this.tag === 'right') f(this.value as R)
    return this
  }

  /** Run a side-effect on the Left error (returns `this` for chaining). */
  tapLeft(f: (error: L) => void): Either<L, R> {
    if (this.tag === 'left') f(this.value as L)
    return this
  }
}
