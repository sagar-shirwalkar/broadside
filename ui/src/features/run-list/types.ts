import type { RunRow } from "../../types.ts";

export interface State {
  readonly runs: RunRow[];
  readonly loading: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly confirmOpen: boolean;
  readonly confirmTarget: RunRow | null;
  readonly confirmBusy: boolean;
}

export const initialState: State = {
  runs: [],
  loading: true,
  limit: 50,
  offset: 0,
  confirmOpen: false,
  confirmTarget: null,
  confirmBusy: false,
};

export type Action =
  | { type: "load_started" }
  | { type: "load_succeeded"; runs: RunRow[] }
  | { type: "load_failed" }
  | { type: "set_limit"; limit: number }
  | { type: "set_offset"; offset: number }
  | { type: "ask_delete"; target: RunRow }
  | { type: "close_confirm" }
  | { type: "delete_started" }
  | { type: "delete_finished"; removedId: string | null };
