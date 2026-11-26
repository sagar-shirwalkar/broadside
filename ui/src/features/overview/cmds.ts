import type { Cmd } from "../../core/types.ts";
import { apiGet } from "../../services/api.ts";
import type { Action, OverviewData } from "./types.ts";

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
