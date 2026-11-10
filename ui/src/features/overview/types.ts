import type { ChartPoint } from "../../types.js";

export interface SloEntry {
  key: string;
  label: string;
  threshold: number;
  unit: string;
  total: number;
  met: number;
  metPct: number;
  status: "pass" | "warn" | "fail" | "nodata";
}

export interface TrendPoint {
  time: string;
  value: number;
  runId: string;
}

export interface FrequencyPoint {
  day: string;
  runs: number;
}

export interface WorstEndpoint {
  endpoint: string;
  avgP95: number;
  avgErrorRate: number;
  runs: number;
}

export interface Regression {
  endpoint: string;
  latestP95: number;
  baselineP95: number;
  deltaPct: number;
  runId: string;
  baselineRuns: number;
}

export interface RecentRun {
  id: string;
  started_at: string;
  duration_ms: number | null;
  total_requests: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
  status: string;
}

export interface OverviewData {
  slo: SloEntry[];
  trends: { p95: TrendPoint[]; errorRate: TrendPoint[] };
  frequency: FrequencyPoint[];
  worst: WorstEndpoint[];
  regressions: Regression[];
  recentRuns: RecentRun[];
  meta: { trendDays: number; frequencyInterval: string };
}

export interface State {
  readonly data: OverviewData | null;
  readonly error: string | null;
  readonly trendDays: string;
  readonly frequencyInterval: string;
  readonly loading: boolean;
}

export const initialState: State = {
  data: null,
  error: null,
  trendDays: "30",
  frequencyInterval: "week",
  loading: true,
};

export type Action =
  | { type: "load_started" }
  | { type: "load_succeeded"; data: OverviewData }
  | { type: "load_failed"; error: string }
  | { type: "trend_days_changed"; value: string }
  | { type: "frequency_changed"; value: string };
