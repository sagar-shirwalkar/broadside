/** Small display helpers shared by the views. */

export function formatDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  if (minutes < 60) return `${minutes}m ${rest.toFixed(0)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (value < 1000) return `${value.toFixed(0)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRps(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)} req/s`;
}

/** "3m ago" / "2h ago" / "yesterday" */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return "in the future";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/**
 * X-axis tick format: clock time for spans under a day, day labels above.
 */
export function formatTick(ms: number, spanMs: number): string {
  return spanMs > 24 * 60 * 60 * 1000
    ? formatDay(ms)
    : formatClock(ms);
}

/**
 * Latency color band used by the run list and KPI cards:
 * green < 200ms, amber < 500ms, red ≥ 500ms.
 */
export function latencyClass(ms: number | null): "lat-ok" | "lat-warn" | "lat-bad" | "" {
  if (ms === null || Number.isNaN(ms)) return "";
  return ms < 200 ? "lat-ok" : ms < 500 ? "lat-warn" : "lat-bad";
}
