/**
 * drain — bounded accumulator-passing recursion over lazily-fetched pages. The FP replacement
 * for paging loops: instead of "page until the table runs dry (NO provable depth bound), each
 * drain ALSO carries an explicit `maxPages` budget, so the recursion has a small, stated,
 * property-tunable depth bound: at most `maxPages` nested calls, each frame tiny. V8 has no
 * tail-call elimination, so that written bound is the safety argument — never "the engine optimizes it".
 *
 * Termination is three-way and reported as a closed set (fold it with a handler table):
 *   - EXHAUSTED   — the state reports no further work (`exhausted` predicate held)
 *   - TIME_BUDGET — the wall-clock veto fired AFTER a step (between-steps check), or a step
 *                   flagged `timedOut`
 *   - PAGE_CAP    — maxPages steps ran; more data may remain, the next run resumes
 *
 * A run always attempts its first step — the budget veto is checked between steps, never
 * before the first one, matching "start the sweep, stop when the clock says so".
 *
 * Purity boundary: `step` may perform the job's writes (that IS the job); everything this
 * module itself does is pure control flow threading an immutable state value.
 */
export type DrainStop = 'EXHAUSTED' | 'TIME_BUDGET' | 'PAGE_CAP'

// DrainResult S ≅ S × DrainStop — final threaded state + why the drain ended
export interface DrainResult<S> {
  readonly state: S
  readonly stop: DrainStop
}

export interface DrainOptions<S> {
  // S → S — one page of work; returns the next accumulated state
  step: (state: S) => S
  // S → Bool — true when the state reports no further work (set by a step that found none,
  // or by a per-item budget flag the caller wants to treat as done)
  exhausted: (state: S) => boolean
  // () → Bool — the wall-clock veto, checked BETWEEN steps
  budgetExceeded: () => boolean
  // S → Bool — optional step-level stop flag (a time budget hit INSIDE a page); checked after
  // each step and reported as TIME_BUDGET
  timedOut?: (state: S) => boolean
  // the stated depth bound — REQUIRED, never defaulted: an unbounded drain would reintroduce
  // exactly the loop shape this combinator exists to retire
  maxPages: number
}

// ∀S. S → DrainOptions S → DrainResult S
// bounded recursion: depth ≤ options.maxPages (property-tunable)
export function drain<S>(initial: S, options: DrainOptions<S>): DrainResult<S> {
  return drainStep(initial, options, options.maxPages)
}

function drainStep<S>(state: S, options: DrainOptions<S>, remaining: number): DrainResult<S> {
  if (options.exhausted(state)) return { state, stop: 'EXHAUSTED' }
  if (remaining <= 0) return { state, stop: 'PAGE_CAP' }
  const next = options.step(state)
  if (options.timedOut?.(next)) return { state: next, stop: 'TIME_BUDGET' }
  if (options.budgetExceeded()) return { state: next, stop: 'TIME_BUDGET' }
  if (options.exhausted(next)) return { state: next, stop: 'EXHAUSTED' }
  return drainStep(next, options, remaining - 1)
}
