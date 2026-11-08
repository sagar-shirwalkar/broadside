// Never → Never
export function assertUnreachable(value: never): never {
  throw new Error(`Unreachable case: ${JSON.stringify(value)}`)
}

// T → Record T (T → R) → R
export function match<T extends string, R>(value: T, handlers: Record<T, (value: T) => R>): R {
  return handlers[value](value)
}

// InstanceCase R ≅ (Unknown → Bool) × (Unknown → R)
type InstanceCase<R> = readonly [(value: unknown) => boolean, (value: never) => R]

// Unknown → [InstanceCase R] → (Unknown → R) → R
export function matchInstance<R>(
  value: unknown,
  cases: readonly InstanceCase<R>[],
  fallback: (value: unknown) => R,
): R {
  for (const [test, handler] of cases) {
    if (test(value)) return handler(value as never)
  }
  return fallback(value)
}

// Ctor C → (Unknown → Bool)
export function isInstanceOf<C extends abstract new (...args: never[]) => unknown>(
  ctor: C,
): (value: unknown) => value is InstanceType<C> {
  return (value): value is InstanceType<C> => value instanceof ctor
}
