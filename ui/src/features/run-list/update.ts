import type { Action, State } from "./types.ts";

export function update(state: State, action: Action): State {
  switch (action.type) {
    case "load_started":
      return { ...state, loading: true };
    case "load_succeeded":
      return { ...state, loading: false, runs: action.runs };
    case "load_failed":
      return { ...state, loading: false };
    case "set_limit":
      return { ...state, limit: action.limit, offset: 0 };
    case "set_offset":
      return { ...state, offset: Math.max(0, action.offset) };
    case "ask_delete":
      return { ...state, confirmOpen: true, confirmTarget: action.target };
    case "close_confirm":
      return { ...state, confirmOpen: false };
    case "delete_started":
      return { ...state, confirmBusy: true };
    case "delete_finished":
      return {
        ...state,
        confirmBusy: false,
        confirmOpen: action.removedId ? false : state.confirmOpen,
        runs: action.removedId
          ? state.runs.filter((r) => r.id !== action.removedId)
          : state.runs,
      };
  }
}
