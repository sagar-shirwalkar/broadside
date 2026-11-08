/**
 * Pure geometry for the time-series chart. Kept free of the DOM so it can
 * be unit-tested; the component injects the generated markup into the
 * `<svg>` element via `unsafeHTML` (Lit nested templates lose the SVG
 * namespace — see line-chart.ts).
 */

export interface YDomainArgs {
  values: number[];
}

export interface Scale {
  (value: number): number;
  invert(pixel: number): number;
}

/** Linear scale with inverse. */
export function linScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dSpan = d1 - d0 || 1;
  const rSpan = r1 - r0 || 1;
  const scale = ((value: number) =>
    r0 + ((value - d0) / dSpan) * rSpan) as Scale;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / rSpan) * dSpan;
  return scale;
}

/** "Nice" tick step in the d3 style (1/2/5 × 10^n). */
export function tickStep(start: number, stop: number, count: number): number {
  const step0 = Math.abs(stop - start) / Math.max(0, count);
  let step1 = Math.pow(10, Math.floor(Math.log10(step0 || 1)));
  const error = step0 / step1;
  if (error >= Math.sqrt(50)) step1 *= 10;
  else if (error >= Math.sqrt(10)) step1 *= 5;
  else if (error >= Math.sqrt(2)) step1 *= 2;
  return step1;
}

export function niceTicks(start: number, stop: number, count: number): number[] {
  if (start === stop) return [start];
  const step = tickStep(start, stop, count);
  const lo = Math.ceil(start / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= stop + step * 0.5; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

export function timeTicks(start: number, stop: number, count: number): number[] {
  const span = stop - start;
  const n = Math.max(2, count);
  const ticks: number[] = [];
  for (let i = 0; i < n; i += 1) {
    ticks.push(start + (span * i) / (n - 1));
  }
  return ticks;
}

export function linePathFrom(
  points: Array<{ time: number; value: number }>,
  x: (time: number) => number,
  y: (value: number) => number,
): string {
  return points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`,
    )
    .join(" ");
}

export function areaPathFrom(
  points: Array<{ time: number; value: number }>,
  x: (time: number) => number,
  y: (value: number) => number,
  bottom: number,
): string {
  if (points.length < 2) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const top = linePathFrom(points, x, y);
  return `${top} L${x(last.time).toFixed(2)},${bottom} L${x(first.time).toFixed(2)},${bottom} Z`;
}

/** Binary-search nearest timestamp (times must be sorted ascending). */
export function nearestTime(times: number[], target: number): number | null {
  if (times.length === 0) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [
    times[Math.max(0, lo - 1)],
    times[Math.min(times.length - 1, lo)],
  ].filter((t): t is number => t !== undefined);
  return candidates.reduce((best, t) =>
    Math.abs(t - target) < Math.abs(best - target) ? t : best,
  );
}
