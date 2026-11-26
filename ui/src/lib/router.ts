import { Maybe } from "@broadside/fp/maybe";

/** Hash router. Keeps navigation client-side (no page reloads) and works
 *  behind any static host without rewrite rules. */

export type Route =
  | { name: "overview" }
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "live"; id: string }
  | { name: "compare" }
  | { name: "not-found"; path: string };

function normalizePath(hash: string): string {
  return hash.replace(/^#/, "") || "/";
}

/** Match a known route. Unknown paths yield Nothing (fold to not-found at boundary). */
export function matchRoute(hash: string): Maybe<Exclude<Route, { name: "not-found" }>> {
  const path = normalizePath(hash);
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (segments.length === 0) return Maybe.just({ name: "overview" as const });
  if (segments[0] === "overview" && segments.length === 1) {
    return Maybe.just({ name: "overview" as const });
  }
  if (segments[0] === "runs" && segments.length === 1) {
    return Maybe.just({ name: "list" as const });
  }
  if (segments[0] === "compare" && segments.length === 1) {
    return Maybe.just({ name: "compare" as const });
  }
  if (segments[0] === "runs" && segments[1]) {
    if (segments.length === 2) return Maybe.just({ name: "detail" as const, id: segments[1] });
    if (segments.length === 3 && segments[2] === "live") {
      return Maybe.just({ name: "live" as const, id: segments[1] });
    }
  }
  return Maybe.nothing<Exclude<Route, { name: "not-found" }>>();
}

export function parseHash(hash: string): Route {
  const path = normalizePath(hash);
  return matchRoute(hash).match<Route>({
    just: (route) => route,
    nothing: () => ({ name: "not-found", path }),
  });
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}
