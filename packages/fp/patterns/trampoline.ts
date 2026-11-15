/**
 * Trampoline<A> — stack-safe recursion for engines with no durable tail-call elimination.
 * Modeled on Scala's standard-library `scala.util.control.TailCalls` (`TailRec[A]`, constructors
 * `done`/`tailcall`, driver method `.result`) — the closest real, proven precedent, not an
 * invented shape. `done(a)` is the final value; `call(next)` defers one step behind a zero-arg
 * thunk, so the recursive call is described as DATA rather than actually made; `run(t)` is the
 * driver — a genuinely iterative `while` loop, never recursion itself, so it carries no depth
 * obligation of its own (recursion-and-tail-calls.md §7).
 *
 * Why this exists, not just "recursion is risky in general": V8 shipped Proper Tail Calls in
 * Chrome 54 (2016), then removed them in 2017 over debugger-stack-trace and JIT-performance
 * concerns; SpiderMonkey never shipped them; only Safari/JavaScriptCore does today
 * (recursion-and-tail-calls.md §2 — this is the pre-existing, cited house position). ServiceNow's
 * own Rhino runtime makes the risk concrete rather than theoretical: Rhino DOES implement real
 * tail-call elimination, but only in its interpreted execution mode, never when compiled to JVM
 * bytecode (Mozilla Bugzilla #257128, shipped Rhino 1.6R1) — and regardless of which mode is in
 * effect, ServiceNow's own platform enforces a FLAT, hard call-depth ceiling of exactly 1000
 * frames ("RhinoStackOverflowException: Maximum JavaScript call depth of 1000 exceeded" —
 * corroborated by independent ServiceNow Community reports), which is not a JVM `-Xss`-tunable
 * limit and is not documented as exempting tail position. A function whose honest recursion bound
 * is itself at or near 1000 (e.g. a Zod schema's own `.max(1000)`) is not "probably fine, engines
 * are usually generous" — it is running directly at a platform wall, at the schema's own stated
 * maximum, on every call that actually reaches it.
 *
 * When to reach for this vs. plain bounded recursion (recursion-and-tail-calls.md §3 already
 * covers the ordinary case): a SMALL, internally-fixed bound — `setValuesStep`'s ~40 columns,
 * `assembleColumns`'s fixed lifecycle-field count, `assembleOwnerEditable`'s fixed key count —
 * stays plain direct recursion; wrapping those in a Trampoline would be ceremony without payoff,
 * the same "don't force it" note every other newer pattern in this skill carries. Reach for
 * Trampoline when the stated bound, though real and provable, is LARGE and caller-influenced
 * (a schema cap on an array/batch size, not a fixed type's field count) — the shape
 * `addOrConditionsStep` (dao/asset.ts) has, bounded by `ResolveAssetBatchBodySchema`'s
 * `.max(1000)`.
 *
 * Pure TypeScript (no platform/Web/Node globals), so it is safe in the scoped runtime.
 */

interface Done<A> {
  readonly done: true
  readonly value: A
}

interface Call<A> {
  readonly done: false
  readonly next: () => Trampoline<A>
}

export type Trampoline<A> = Done<A> | Call<A>

// A → Trampoline A — the final value; every Trampoline-returning function's base case.
export function done<A>(value: A): Trampoline<A> {
  return { done: true, value }
}

// (() → Trampoline A) → Trampoline A — one deferred step. The thunk is not invoked here — it is
// invoked by `run`'s driver loop, one bounce at a time, which is exactly what keeps the real JS
// call stack at O(1) regardless of how many steps the logical recursion has.
export function call<A>(next: () => Trampoline<A>): Trampoline<A> {
  return { done: false, next }
}

// Trampoline A → A — run a trampoline to completion. A `while` loop, not recursion: this function
// itself never appears in any depth-bound argument, because it never grows the call stack no
// matter how many bounces `t` unwinds into.
export function run<A>(t: Trampoline<A>): A {
  let step = t
  while (!step.done) {
    step = step.next()
  }
  return step.value
}
