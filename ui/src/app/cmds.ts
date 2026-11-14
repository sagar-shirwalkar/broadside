import type { Cmd } from "../core/types.ts";
import { parseHash, type Route } from "../lib/router.ts";
import { RUN_STATUS_EVENT, UNAUTHORIZED_EVENT } from "../services/api.ts";
import type { RunStatus } from "../types.ts";
import { currentTheme, toggleTheme } from "../theme.ts";
import type { AppAction } from "./types.ts";

/** Subscribe to hash changes and global app events, dispatching actions. */
export function startSubscriptions(): Cmd<AppAction> {
  return () =>
    new Promise<AppAction>(() => {
      // We dispatch via window events bridged to a custom dispatcher; this cmd
      // never resolves because subscriptions are long-lived. Instead we wire
      // listeners that call a global dispatcher set by the runtime wrapper.
      // See app/index bootstrap.
    });
}

export function readRoute(): Route {
  return parseHash(window.location.hash);
}

export function readTheme() {
  return currentTheme();
}

export function doToggleTheme(): ReturnType<typeof currentTheme> {
  toggleTheme();
  return currentTheme();
}

export { UNAUTHORIZED_EVENT, RUN_STATUS_EVENT };
export type { RunStatus };
