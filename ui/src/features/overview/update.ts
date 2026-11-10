import type { Action, State } from "./types.js";

export function update(state: State, action: Action): State {
  switch (action.type) {
    case "load_started":
      return { ...state, loading: true, error: null };
    case "load_succeeded":
      return { ...state, loading: false, data: action.data, error: null };
    case "load_failed":
      return { ...state, loading: false, error: action.error };
    case "trend_days_changed":
      return { ...state, trendDays: action.value };
    case "frequency_changed":
      return { ...state, frequencyInterval: action.value };
  }
}
