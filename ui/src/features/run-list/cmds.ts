import type { Cmd } from "../../core/types.js";
import { api, apiGet } from "../../services/api.js";
import type { RunRow } from "../../types.js";
import type { Action } from "./types.js";

export function loadRuns(limit: number, offset: number): Cmd<Action> {
  return async () => {
    try {
      const runs = await apiGet<RunRow[]>(
        `/api/runs?limit=${limit}&offset=${offset}`,
      );
      return { type: "load_succeeded", runs };
    } catch {
      return { type: "load_failed" };
    }
  };
}

export function deleteRun(target: RunRow): Cmd<Action> {
  return async () => {
    try {
      await api(`/api/runs/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      return { type: "delete_finished", removedId: target.id };
    } catch {
      return { type: "delete_finished", removedId: null };
    }
  };
}
