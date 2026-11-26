// Reducer Acc B ≅ Acc → B → Acc
export type Reducer<Acc, B> = (acc: Acc, value: B) => Acc
// Transducer A B ≅ ∀Acc. Reducer Acc B → Reducer Acc A
export type Transducer<A, B> = <Acc>(reducer: Reducer<Acc, B>) => Reducer<Acc, A>

// (A → B) → Transducer A B
export function mapT<A, B>(fn: (value: A) => B): Transducer<A, B> {
  return (reducer) => (acc, value) => reducer(acc, fn(value))
}

// (A → Bool) → Transducer A A
export function filterT<A>(predicate: (value: A) => boolean): Transducer<A, A> {
  return (reducer) => (acc, value) => (predicate(value) ? reducer(acc, value) : acc)
}

// (A → [B]) → Transducer A B
export function flatMapT<A, B>(fn: (value: A) => B[]): Transducer<A, B> {
  return (reducer) => (acc, value) => fn(value).reduce(reducer, acc)
}

// [Transducer] → Transducer A Z  (n-ary composition, left-to-right data-flow order)
export function composeT<A, Z>(...transducers: unknown[]): Transducer<A, Z> {
  const impl = (reducer: Reducer<unknown, unknown>): Reducer<unknown, unknown> =>
    transducers.reduceRight<Reducer<unknown, unknown>>((acc, t) => (t as Transducer<unknown, unknown>)(acc), reducer)
  return impl as unknown as Transducer<A, Z>
}

// Transducer A B → [A] → [B]
export function toArray<A, B>(transducer: Transducer<A, B>): (values: A[]) => B[] {
  return (values) =>
    values.reduce(
      transducer((acc: B[], value: B) => {
        acc.push(value)
        return acc
      }),
      [] as B[],
    )
}

// Transducer A B → Reducer Acc B → Acc → [A] → Acc
export function transduce<A, B, Acc>(
  transducer: Transducer<A, B>,
  reducer: Reducer<Acc, B>,
  seed: Acc,
  values: A[],
): Acc {
  return values.reduce(transducer(reducer), seed)
}
