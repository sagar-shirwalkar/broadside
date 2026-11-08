/**
 * Branded (nominal) primitive types — A brand is a phantom marker that makes specific strings
 * INCOMPATIBLE with plain strings (and with each other) at compile time while costing nothing
 * at runtime — the marker exists only in the type system.
 *
 * When to reach for it: a boundary where two strings must never swap (DAO ids vs display
 * fields, encoded vs raw payloads) or a domain concept whose validity is established once at
 * the edge and then assumed (`brand(parseIdOrThrow(raw))`). When NOT: everyday strings —
 * branding everything turns the codebase into cast-land; brand only where confusion has a
 * real failure mode.
 *
 * Pure TypeScript (no platform/Web/Node globals), so it is safe in the scoped runtime.
 */

/** The unique phantom key brands hang from. Not exported on purpose: users can never forge it. */
declare const __brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [__brand]: B }

/** Lift a plain value into a branded one. Call this ONLY after whatever check makes the
 * brand true — the runtime does nothing; the proof obligation is yours (that is the deal). */
export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>
}

/** Demote back to the unbranded type (brands flow INTO plain strings implicitly; use unbrand
 * only when a generic API's inference needs the explicit downgrade). */
export function unbrand<T, B extends string>(branded: Brand<T, B>): T {
  return branded as T
}
