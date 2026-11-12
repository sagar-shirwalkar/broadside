import type { Route } from "../lib/router.js";
import type { RunStatus } from "../types.js";
import type { Theme } from "../theme.js";

export interface AppState {
  readonly route: Route;
  readonly runStatus: RunStatus | null;
  readonly needsAuth: boolean;
  readonly triggerOpen: boolean;
  readonly sidebarOpen: boolean;
  readonly theme: Theme;
}

export type AppAction =
  | { type: "route_changed"; route: Route }
  | { type: "unauthorized" }
  | { type: "login_success" }
  | { type: "run_status"; status: RunStatus }
  | { type: "toggle_theme"; theme: Theme }
  | { type: "set_sidebar"; open: boolean }
  | { type: "set_trigger"; open: boolean };
