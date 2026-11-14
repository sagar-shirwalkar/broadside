import type {
  ChartSeries,
  EndpointRow,
  Granularity,
  MetricRow,
  PhaseAnnotation,
  RawRow,
  RunRow,
} from "../../types.ts";

export type PanelKey = "rps" | "latency" | "errors" | "volume";
export type ZoomRange = { from: number; to: number } | null;

export interface State {
  readonly runId: string;
  readonly run: RunRow | null;
  readonly missing: boolean;
  readonly rows: MetricRow[];
  readonly rawByPanel: ReadonlyMap<PanelKey, RawRow[]>;
  readonly endpoint: string;
  readonly granularity: Granularity;
  readonly zoomByPanel: ReadonlyMap<PanelKey, ZoomRange>;
  readonly previous: RunRow | null;
  readonly loading: boolean;
  readonly annotations: PhaseAnnotation[];
  readonly endpointSeries: ChartSeries[];
  readonly endpointsLoaded: boolean;
  readonly confirmOpen: boolean;
  readonly confirmBusy: boolean;
}

export const initialState = (runId = ""): State => ({
  runId,
  run: null,
  missing: false,
  rows: [],
  rawByPanel: new Map(),
  endpoint: "",
  granularity: "1m",
  zoomByPanel: new Map(),
  previous: null,
  loading: true,
  annotations: [],
  endpointSeries: [],
  endpointsLoaded: false,
  confirmOpen: false,
  confirmBusy: false,
});

export type Action =
  | { type: "set_run_id"; runId: string }
  | { type: "load_started" }
  | { type: "run_loaded"; run: RunRow }
  | { type: "missing" }
  | { type: "metrics_loaded"; rows: MetricRow[] }
  | { type: "previous_loaded"; previous: RunRow | null }
  | { type: "annotations_loaded"; annotations: PhaseAnnotation[] }
  | { type: "endpoint_series_loaded"; series: ChartSeries[] }
  | { type: "set_endpoint"; endpoint: string }
  | { type: "set_granularity"; granularity: Granularity }
  | { type: "zoom_loaded"; key: PanelKey; range: { from: number; to: number }; raw: RawRow[] }
  | { type: "zoom_reset"; key: PanelKey }
  | { type: "confirm_open"; open: boolean }
  | { type: "confirm_busy"; busy: boolean }
  | { type: "loading_done" };
