/**
 * Drop every entry whose value is `undefined`, preserving key order. Typed `Partial<T>` because a
 * key that was `undefined` is genuinely ABSENT from the result, not present-and-undefined — exactly
 * the shape an `exactOptionalPropertyTypes`-style consumer expects, and what makes it safe to fold
 * straight into an options object without sending spurious `key: undefined` keys downstream.
 *
 * Only `undefined` means "not supplied": `null`, `''`, `0`, and `[]` are all supplied values and
 * survive. For "an empty array means absent" call the transform that produces it (e.g. a
 * sort-dedupe that returns `undefined` for the empty case) rather than widening this helper.
 */
export function compactRecord<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as Partial<T>
}
