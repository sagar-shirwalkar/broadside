import type { Action, State } from "./types.ts";

export function update(state: State, action: Action): State {
  switch (action.type) {
    case "token_changed":
      return { ...state, token: action.token };
    case "submit_started":
      return { ...state, submitting: true, error: null };
    case "submit_failed":
      return { ...state, submitting: false, error: action.error };
    case "submit_succeeded":
      return { ...state, submitting: false, error: null };
  }
}
