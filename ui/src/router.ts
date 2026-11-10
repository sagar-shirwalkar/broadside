/** Hash router. Keeps navigation client-side (no page reloads) and works
 *  behind any static host without rewrite rules. */

export type Route =
  | { name: "overview" }
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "live"; id: string }
  | { name: "compare" }
  | { name: "not-found"; path: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (segments.length === 0) return { name: "overview" };
  if (segments[0] === "overview" && segments.length === 1) {
    return { name: "overview" };
  }
  if (segments[0] === "runs" && segments.length === 1) {
    return { name: "list" };
  }
  if (segments[0] === "compare" && segments.length === 1) {
    return { name: "compare" };
  }
  if (segments[0] === "runs" && segments[1]) {
    if (segments.length === 2) return { name: "detail", id: segments[1] };
    if (segments.length === 3 && segments[2] === "live") {
      return { name: "live", id: segments[1] };
    }
  }
  return { name: "not-found", path };
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}
