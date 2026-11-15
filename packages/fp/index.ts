/**
 * `@broadside/fp` — barrel export for the workspace FP package.
 *
 * Two consumption styles, both supported, both resolving through `package.json#exports`:
 *
 *   - Subpath (preferred when pulling from one module):
 *       import { Either } from "@broadside/fp/either"
 *     Explicit about the source; best for tree-shaking in per-file bundlers.
 *
 *   - Barrel (convenient when pulling several modules, or in docs/examples):
 *       import { Either, Maybe, pipe } from "@broadside/fp"
 *
 * Every module only exports what is meant to be public — internal helpers stay
 * unexported at the module level and cannot leak through this barrel.
 */

export * from "./monads/either.ts"
export * from "./monads/maybe.ts"

export * from "./applicatives/validation.ts"

export * from "./combinators/match.ts"
export * from "./combinators/pipe.ts"
export * from "./combinators/predicate.ts"
export * from "./combinators/record.ts"
export * from "./combinators/tuple.ts"

export * from "./patterns/drain.ts"
export * from "./patterns/monoid.ts"
export * from "./patterns/trampoline.ts"
export * from "./patterns/transducers.ts"

export * from "./typesystem/brand.ts"
