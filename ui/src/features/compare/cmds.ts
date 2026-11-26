import type { Cmd } from "../../core/types.ts";
import { apiGet } from "../../services/api.ts";
import type { CompareResponse, EndpointRow, Granularity, RunRow } from "../../types.ts";
import type { Action } from "./types.ts";

export function loadRuns(): Cmd<Action> {
  return async () => {
    try {
      const runs = await apiGet<RunRow[]>("/api/runs?limit=100");
      return { type: "runs_loaded", runs };
    } catch {
      return { type: "runs_loaded", runs: [] };
    }
  };
}

export function compareRuns(ids: string[], granularity: Granularity, endpoint: string): Cmd<Action> {
  return async () => {
    try {
      const params = new URLSearchParams({ ids: ids.join(","), granularity });
      if (endpoint !== "") params.set("endpoint", endpoint);
      const data = await apiGet<CompareResponse>(`/api/runs/compare?${params}`);
      return { type: "compare_succeeded", data };
    } catch {
      return { type: "compare_failed" };
    }
  };
}

export function loadEndpointOptions(runId: string): Cmd<Action> {
  return async () => {
    try {
      const options = await apiGet<EndpointRow[]>(`/api/runs/${encodeURIComponent(runId)}/endpoints`);
      return { type: "endpoint_options_loaded", options };
    } catch {
      return { type: "endpoint_options_loaded", options: [] };
    }
  };
}
