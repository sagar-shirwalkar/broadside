export interface State {
  readonly message: string;
}

export const initialState = (message = "Page not found"): State => ({ message });

export type Action = { type: "set_message"; message: string };
