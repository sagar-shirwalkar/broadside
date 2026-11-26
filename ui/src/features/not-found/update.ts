import type { Action, State } from "./types.ts";

export function update(state: State, action: Action): State {
  switch (action.type) {
    case "set_message":
      return { ...state, message: action.message };
  }
}
