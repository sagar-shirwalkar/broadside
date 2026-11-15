/**
 * Validation<V, A> — an applicative result that accumulates ALL violations.
 * A `fail` carries every violation collected across all rules, not just the first.
 * The violation type `V` is generic.
 *
 * Two channels, exactly one inhabited:
 *   - `ok(value)`    — the computation succeeded; `value` is present.
 *   - `fail(vs)`     — one or more violations; `vs` is a non-empty array.
 *
 * **Why not Either?** `Either.flatMap` short-circuits on the first Left — correct for
 * sequential error handling, wrong for "collect all validation failures." Validation is
 * an accumulating Applicative — ap collects all violations. flatMap (bind) short-circuits
 * on the first failure, matching Either's semantics. The class is intentionally not
 * a Monad in the accumulating sense; that's why flatMap and ap differ. making it the
 * right primitive for a rule engine where every violation matters.
 *
 * Laws (the tests pin them):
 *   - `ok(a).map(f)` ≡ `ok(f(a))`
 *   - `fail(vs).map(f)` ≡ `fail(vs)`  (violation shape unchanged by fmap)
 *   - `ok(a).ap(ok(b))` ≡ `ok(b)`  (applicative apply)
 *   - `fail(v1).ap(fail(v2))` ≡ `fail([...v1, ...v2])`  (violation accumulation)
 *   - associativity of concat in flatMap/ap
 */
export class Validation<V, A> {
  private constructor(
    private readonly tag: 'ok' | 'fail',
    private readonly value: A | undefined,
    private readonly violations: readonly V[],
  ) {
    // Invariant: fail ⟺ violations.length ≥ 1; ok ⟺ violations.length = 0.
    // Enforced at the single construction site so no combinator can violate it.
    if (tag === 'fail' && violations.length === 0) {
      throw new Error('Validation invariant: fail requires at least one violation')
    }
  }

  /** Wrap a success value. */
  static ok<V, A>(value: A): Validation<V, A> {
    return new Validation<V, A>('ok', value, [])
  }

  /** Wrap one or more violations. At least one is required — enforced at the type level. */
  static fail<V, A = never>(first: V, ...rest: V[]): Validation<V, A> {
    return new Validation<V, A>('fail', undefined, [first, ...rest])
  }

  /**
   * @internal For call sites that spread an already-known-non-empty `V[]`
   * (combining violations from two sources, retyping via `mapViolation`, etc).
   * User code should call `fail(...)` directly.
   */
  static failFromArray<V, A = never>(vs: readonly V[]): Validation<V, A> {
    if (vs.length === 0) {
      throw new Error('Validation.failFromArray: empty violations')
    }
    return new Validation<V, A>('fail', undefined, vs as V[])
  }

  /** True when this is a success. */
  isOk(): boolean {
    return this.tag === 'ok'
  }

  /** True when this has violations. */
  isFail(): boolean {
    return this.tag === 'fail'
  }

  /** The success value, or `undefined` when this is a fail. */
  get valueOrUndefined(): A | undefined {
    return this.tag === 'ok' ? this.value : undefined
  }

  /** The violations (empty when this is ok). */
  get violationArray(): readonly V[] {
    return this.violations
  }

  map<B>(f: (value: A) => B): Validation<V, B> {
    return this.tag === 'ok'
      ? Validation.ok<V, B>(f(this.value as A))
      : Validation.failFromArray<V, B>(this.violations)
  }

  /**
   * bind: chain a Validation-returning step. **Short-circuits** on the first fail
   * (like `Either.flatMap`) — correct for sequential dependencies where step B
   * needs step A's value. For "collect all failures" (applicative), use `ap` instead.
   */
  flatMap<B>(f: (value: A) => Validation<V, B>): Validation<V, B> {
    if (this.tag === 'ok') return f(this.value as A)
    return Validation.failFromArray<V, B>(this.violations)
  }

  /**
   * Applicative apply: `this` carries a function in `ok`; `that` carries the argument.
   * Both channels are evaluated — violations accumulate from BOTH sides.
   *
   * `ok(fn).ap(ok(a))`     → `ok(fn(a))`             — success applies the function.
   * `fail(vs1).ap(ok(a))`  → `fail(...vs1)`           — fn failed, arg's value ignored.
   * `ok(fn).ap(fail(vs2))` → `fail(...vs2)`           — fn succeeded but arg failed.
   * `fail(vs1).ap(fail(vs2))` → `fail([...vs1,...vs2])` — both failed, all collected.
   */
  ap<B>(that: Validation<V, B>): Validation<V, A> {
    if (this.tag === 'ok' && that.tag === 'ok') {
      return Validation.ok<V, A>((this.value as unknown as (a: B) => A)(that.value as B))
    }
    if (this.tag === 'fail' && that.tag === 'fail') {
      return Validation.failFromArray<V, A>([...this.violations, ...that.violations])
    }
    if (this.tag === 'fail') {
      return Validation.failFromArray<V, A>(this.violations)
    }
    return Validation.failFromArray<V, A>(that.violations)
  }

  /**
   * Recover from a fail: if this is `ok`, return as-is; if `fail`, pass the violations
   * to the alternative function which may produce a new Validation.
   */
  orElse(alternative: (vs: readonly V[]) => Validation<V, A>): Validation<V, A> {
    return this.tag === 'ok' ? this : alternative(this.violations)
  }

  /**
   * The catamorphism: fold both channels to a single value. The primary bridge from
   * Validation back to imperative code — e.g. `ok → the value`, `fail → throw/return error`.
   */
  match<U>(handlers: { ok: (value: A) => U; fail: (violations: readonly V[]) => U }): U {
    return this.tag === 'ok' ? handlers.ok(this.value as A) : handlers.fail(this.violations)
  }
}
