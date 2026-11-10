export interface State {
  readonly token: string;
  readonly error: string | null;
  readonly submitting: boolean;
}

export const initialState: State = {
  token: "",
  error: null,
  submitting: false,
};

export type Action =
  | { type: "token_changed"; token: string }
  | { type: "submit_started" }
  | { type: "submit_failed"; error: string }
  | { type: "submit_succeeded" };
