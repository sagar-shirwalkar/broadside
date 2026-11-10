import type { Cmd } from "../../core/types.js";
import { apiGet } from "../../services/api.js";
import type { Action, OverviewData } from "./types.js";

export function loadOverview(trendDays: string, frequency: string): Cmd<Action> {
  return async () => {
    try {
      const data = await apiGet<OverviewData>(
        `/api/overview?days=${trendDays}&frequency=${frequency}`,
      );
      return { type: "load_succeeded", data };
    } catch {
      return { type: "load_failed", error: "Could not load overview data" };
    }
  };
}
