import type { Action, State } from "./types.ts";

export function update(state: State, action: Action): State {
  switch (action.type) {
    case "set_run_id":
      return { ...state, runId: action.runId };
    case "load_started":
      return { ...state, loading: true, missing: false };
    case "run_loaded":
      return {
        ...state,
        run: action.run,
        granularity: (action.run.duration_ms ?? Infinity) < 120_000 ? "10s" : "1m",
      };
    case "missing":
      return { ...state, missing: true };
    case "metrics_loaded":
      return { ...state, rows: action.rows };
    case "previous_loaded":
      return { ...state, previous: action.previous };
    case "annotations_loaded":
      return { ...state, annotations: action.annotations };
    case "endpoint_series_loaded":
      return { ...state, endpointSeries: action.series, endpointsLoaded: true };
    case "set_endpoint":
      return { ...state, endpoint: action.endpoint, zoomByPanel: new Map(), rawByPanel: new Map() };
    case "set_granularity":
      return { ...state, granularity: action.granularity, zoomByPanel: new Map(), rawByPanel: new Map() };
    case "zoom_loaded": {
      const zoomByPanel = new Map(state.zoomByPanel).set(action.key, action.range);
      const rawByPanel = new Map(state.rawByPanel).set(action.key, action.raw);
      return { ...state, zoomByPanel, rawByPanel };
    }
    case "zoom_reset": {
      const zoomByPanel = new Map(state.zoomByPanel).set(action.key, null);
      const rawByPanel = new Map(state.rawByPanel);
      rawByPanel.delete(action.key);
      return { ...state, zoomByPanel, rawByPanel };
    }
    case "confirm_open":
      return { ...state, confirmOpen: action.open };
    case "confirm_busy":
      return { ...state, confirmBusy: action.busy };
    case "loading_done":
      return { ...state, loading: false };
  }
}
