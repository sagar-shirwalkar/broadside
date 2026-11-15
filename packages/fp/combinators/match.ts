// Never → Never
export function assertUnreachable(value: never): never {
  throw new Error(`Unreachable case: ${JSON.stringify(value)}`)
}

// T → Record T (T → R) → R
export function match<T extends string, R>(value: T, handlers: Record<T, (value: T) => R>): R {
  return handlers[value](value)
}

type TypeGuard<A> = (value: unknown) => value is A

// Existential: `any` here is the erased narrowed type, enforced per call-site at construction.
type InstanceCase<A, R> = readonly [TypeGuard<A>, (value: A) => R]

export function matchInstance<R>(
  value: unknown,
  cases: readonly InstanceCase<any, R>[],
  fallback: (value: unknown) => R,
): R {
  for (const [test, handler] of cases) {
    if (test(value)) return handler(value)
  }
  return fallback(value)
}

export function isInstanceOf<C extends abstract new (...args: never[]) => unknown>(
  ctor: C,
): TypeGuard<InstanceType<C>> {
  return (value): value is InstanceType<C> => value instanceof ctor
}
