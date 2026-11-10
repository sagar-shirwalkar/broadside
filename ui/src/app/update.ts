import type { AppAction, AppState } from "./types.js";

export function update(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "route_changed":
      return {
        ...state,
        route: action.route,
        runStatus: null,
        sidebarOpen: false,
      };
    case "unauthorized":
      return { ...state, needsAuth: true };
    case "login_success":
      return { ...state, needsAuth: false };
    case "run_status":
      return { ...state, runStatus: action.status };
    case "toggle_theme":
      return { ...state, theme: action.theme };
    case "set_sidebar":
      return { ...state, sidebarOpen: action.open };
    case "set_trigger":
      return { ...state, triggerOpen: action.open };
  }
}
