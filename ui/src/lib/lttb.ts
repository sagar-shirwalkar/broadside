import type { ChartPoint } from "../types.ts";

/**
 * LTTB (Largest-Triangle-Three-Buckets) decimation for long raw series.
 * The zoomed/raw path can carry 100k points; rendering that many SVG
 * segments is slow, and ~2 points per pixel is invisible. LTTB preserves
 * the visual shape (peaks and troughs) at a fraction of the nodes.
 */
export function lttb(data: ChartPoint[], threshold: number): ChartPoint[] {
  if (data.length <= threshold) return data;
  if (threshold < 3) return data.slice(0, Math.max(0, threshold));

  const sampled: ChartPoint[] = [data[0]!];
  const bucketSize = (data.length - 2) / (threshold - 2);
  let anchor = 0;

  for (let i = 0; i < threshold - 2; i += 1) {
    // Adjacent windows over the middle points; candidates exclude the
    // final point so the appended last point is always distinct and the
    // output is exactly `threshold` long.
    const windowStart = Math.floor(i * bucketSize) + 1;
    const windowEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length - 1,
    );
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(
      Math.floor((i + 2) * bucketSize) + 1,
      data.length,
    );
    const avgX = (nextStart + nextEnd - 1) / 2;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j += 1) {
      avgY += data[j]!.value;
    }
    avgY /= Math.max(1, nextEnd - nextStart);

    let maxArea = -1;
    let maxIdx = windowStart;
    const a = data[anchor]!;
    for (let j = windowStart; j < windowEnd; j += 1) {
      const p = data[j]!;
      const area = Math.abs(
        (a.time - avgX) * (p.value - a.value) -
          (a.time - p.time) * (avgY - a.value),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }
    if (windowStart < windowEnd) {
      sampled.push(data[maxIdx]!);
      anchor = maxIdx;
    }
  }
  sampled.push(data[data.length - 1]!);
  return sampled;
}

/** Render cap: ~2 points per plot pixel on wide charts. */
export const RENDER_POINT_CAP = 800;

/** Decimate long zoomed series to the render cap. */
export function decimateForRender(points: ChartPoint[]): ChartPoint[] {
  return points.length > RENDER_POINT_CAP
    ? lttb(points, RENDER_POINT_CAP)
    : points;
}
