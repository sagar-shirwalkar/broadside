import type { Action, State } from "./types.js";

const MAX_COMPARE = 5;

export function update(state: State, action: Action): State {
  switch (action.type) {
    case "runs_loaded":
      return { ...state, runs: action.runs };
    case "toggle_selected": {
      const next = new Set(state.selected);
      if (action.checked) {
        if (next.size >= MAX_COMPARE) return state;
        next.add(action.id);
      } else {
        next.delete(action.id);
      }
      return { ...state, selected: next };
    }
    case "compare_started":
      return { ...state, loading: true };
    case "compare_succeeded":
      return { ...state, loading: false, data: action.data };
    case "compare_failed":
      return { ...state, loading: false };
    case "endpoint_changed":
      return { ...state, endpoint: action.endpoint };
    case "granularity_changed":
      return { ...state, granularity: action.granularity };
    case "endpoint_options_loaded":
      return { ...state, endpointOptions: action.options };
  }
}
