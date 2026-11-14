import type { CompareResponse, EndpointRow, Granularity, RunRow } from "../../types.ts";

export interface State {
  readonly runs: RunRow[];
  readonly selected: Set<string>;
  readonly data: CompareResponse | null;
  readonly loading: boolean;
  readonly endpoint: string;
  readonly granularity: Granularity;
  readonly endpointOptions: EndpointRow[];
}

export const initialState: State = {
  runs: [],
  selected: new Set(),
  data: null,
  loading: false,
  endpoint: "",
  granularity: "10s",
  endpointOptions: [],
};

export type Action =
  | { type: "runs_loaded"; runs: RunRow[] }
  | { type: "toggle_selected"; id: string; checked: boolean }
  | { type: "compare_started" }
  | { type: "compare_succeeded"; data: CompareResponse }
  | { type: "compare_failed" }
  | { type: "endpoint_changed"; endpoint: string }
  | { type: "granularity_changed"; granularity: Granularity }
  | { type: "endpoint_options_loaded"; options: EndpointRow[] };
