/**
 * Maybe<T> — a hand-written option monad for systematic null/undefined handling. Models a
 * value that may be absent so "did this exist?" is expressed in the type, not by scattering
 * `x == null` guards. Haskell-flavoured: `just` / `nothing` constructors, `map` (fmap),
 * `flatMap` (>>=/bind), `getOrElse` (fromMaybe), `match` (the `maybe` catamorphism),
 * `orElse` (<|>). Its error-carrying companion is `Result<T, E>` (this dir) — reach for
 * `Result` when the absent case has a *reason* the caller must handle; bridge with `toResult`.
 *
 * Representation invariant: a Maybe is **Nothing iff its internal value is `null`**. The
 * constructor normalises `undefined → null`, so there is no distinct "Just(null)" state —
 * `just(null)` is Nothing. Every combinator preserves this.
 */
import { Either } from './either.ts'

export class Maybe<T> {
  /** Nothing ⟺ `value === null`. `undefined` is normalised to `null` at construction. */
  private constructor(private readonly value: T | null) {}

  /** Wrap a definite value (`Just x`). Note: `just(null)` is Nothing, by the invariant. */
  static just<T>(value: T): Maybe<T> {
    return new Maybe<T>(value ?? null)
  }

  /** The absent value (`Nothing`). */
  static nothing<T>(): Maybe<T> {
    return new Maybe<T>(null)
  }

  /** Lift a nullable into a Maybe — the workhorse at the edge of null-returning APIs. */
  static fromNullable<T>(value: T | null | undefined): Maybe<T> {
    return new Maybe<T>(value ?? null)
  }

  /**
   * Haskell `catMaybes`: collect the present values from a list of Maybes, dropping the
   * Nothings. Folds several independent optional results into just the subset that actually
   * materialised (e.g. averaging only the quality dimensions that produced a score).
   */
  static catMaybes<T>(maybes: Maybe<T>[]): T[] {
    const present: T[] = []
    for (const m of maybes) m.tap((value) => present.push(value))
    return present
  }

  /** True when a value is present. */
  isJust(): boolean {
    return this.value !== null
  }

  /** True when absent. */
  isNothing(): boolean {
    return this.value === null
  }

  /** fmap: transform the value if present; a `null`/`undefined` result collapses to Nothing. */
  map<U>(f: (value: T) => U): Maybe<U> {
    return this.value === null ? Maybe.nothing<U>() : Maybe.fromNullable(f(this.value))
  }

  /** bind / `>>=`: chain a Maybe-returning step, flattening the result. */
  flatMap<U>(f: (value: T) => Maybe<U>): Maybe<U> {
    return this.value === null ? Maybe.nothing<U>() : f(this.value)
  }

  /** Keep the value only if it satisfies the predicate; otherwise Nothing. */
  filter(predicate: (value: T) => boolean): Maybe<T> {
    return this.value !== null && predicate(this.value) ? this : Maybe.nothing<T>()
  }

  /** True when a value is present AND satisfies the predicate (Scala `exists`). */
  exists(predicate: (value: T) => boolean): boolean {
    return this.value !== null && predicate(this.value)
  }

  /** fromMaybe: the value if present, else the fallback. */
  getOrElse(fallback: T): T {
    return this.value === null ? fallback : this.value
  }

  /** `<|>`: this if present, else the (lazily-evaluated) alternative Maybe. */
  orElse(alternative: () => Maybe<T>): Maybe<T> {
    return this.value === null ? alternative() : this
  }

  /**
   * The `maybe` catamorphism: fold to a single value by handling both cases. The primary
   * bridge from Maybe back to imperative/HTTP code (e.g. `just → 200`, `nothing → 404`).
   */
  match<U>(handlers: { just: (value: T) => U; nothing: () => U }): U {
    return this.value === null ? handlers.nothing() : handlers.just(this.value)
  }

  /**
   * Bridge to the Either error-channel: `Just x → Right x`, `Nothing → Left (onNothing())`. The
   * idiomatic way a service turns "absent" into a typed domain error *as a value* — e.g.
   * `dao.get(id).toEither(() => new NotFoundError(id))` — so the error rides the Either
   * channel and is folded to HTTP once, at the handler edge, rather than thrown mid-flow.
   */
  toEither<L>(onNothing: () => L): Either<L, T> {
    return this.value === null ? Either.left<L, T>(onNothing()) : Either.right<L, T>(this.value)
  }

  /** Run a side-effect when present (returns `this` for chaining). */
  tap(f: (value: T) => void): Maybe<T> {
    if (this.value !== null) f(this.value)
    return this
  }

  /** Bridge to the DTO/wire contract: the value, or `null` when absent. */
  toNullable(): T | null {
    return this.value
  }

  /**
   * Unsafe extraction for a **system invariant**, not domain flow: the value if present,
   * else throw `makeError()`. Use ONLY where absence signals a bug / 500 that cannot be a
   * domain outcome (e.g. a row that vanished immediately after its own insert). For expected
   * absence use `toResult` / `match` / `getOrElse` — never this. It is the single honest
   * escape hatch, kept out of the `match` fold precisely so folds stay total and pure.
   */
  getOrThrow(makeError: () => Error): T {
    if (this.value === null) throw makeError()
    return this.value
  }
}
