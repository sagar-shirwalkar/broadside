/**
 * Record helpers — object-level combinators for an "absent = undefined" convention, and
 * one-field conditional spreads. `compactRecord` is the object-shaped fold of that same
 * convention: it drops every `undefined`-valued entry so a bag of optional
 * fields can be assembled as ONE pure expression, instead of a mutable accumulator a
 * reader has to track statement by statement (`const o = {...}; if (q.a) o.a = q.a; if (q.b) o.b = q.b; …`).
 */

/**
 * Drop every entry whose value is `undefined`, preserving key order. Typed `Partial<T>` because a
 * key that was `undefined` is genuinely ABSENT from the result, not present-and-undefined.
 * Only `undefined` means "not supplied": `null`, `''`, `0`, and `[]` are all supplied values and
 * survive. For "an empty array means absent" call the transform that produces it (e.g. a
 * sort-dedupe that returns `undefined` for the empty case) rather than widening this helper.
 */
export function compactRecord<T extends object>(source: T): Partial<T> {
  const result = {} as Partial<T>
  const sourceRecord = source as Record<PropertyKey, unknown>
  const resultRecord = result as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(source)) {
    const value = sourceRecord[key]
    if (value !== undefined) {
      resultRecord[key] = value
    }
  }
  return result
}
