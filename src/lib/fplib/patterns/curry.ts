// CurryFunction [Head,...Tail] R ≅ Head → CurryFunction Tail R  (base case: [] → R)
export type CurryFunction<T extends unknown[], R> = T extends [infer Head, ...infer Tail]
  ? (arg: Head) => CurryFunction<Tail, R>
  : R

// (A₁ × A₂ × ... × Aₙ → R) → (A₁ → A₂ → ... → Aₙ → R)
export function curry<T extends unknown[], R>(fn: (...args: T) => R): CurryFunction<T, R> {
  return curryStep(fn as (...args: unknown[]) => unknown, []) as CurryFunction<T, R>
}

// (unknown[] → unknown) → unknown[] → unknown
function curryStep(fn: (...args: unknown[]) => unknown, collected: unknown[]): unknown {
  if (collected.length >= fn.length) return fn(...collected)
  return (arg: unknown) => curryStep(fn, [...collected, arg])
}
