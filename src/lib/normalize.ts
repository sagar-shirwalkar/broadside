import * as z from "@zod/mini";
import type { MetricPoint } from "../types.ts";

/**
 * Runtime validation for the single untrusted ingress point.
 *
 * WebSocket (and, later, Kafka) consumers hand their raw JSON payloads
 * to {@link normalizeBatch} — this module is the only place untrusted
 * JSON is parsed into {@link MetricPoint}. Validation fails closed:
 * malformed shapes throw a plain {@link TypeError} ("not-an-object"
 * messages included), which the WS handler converts into a
 * `"invalid message"` reply instead of ingesting NaN or wrongly-typed
 * values. Aliasing (snake_case *or* camelCase) and numeric-string
 * coercion remain part of the accepted wire contract and are enforced,
 * not re-litigated, here.
 *
 * Implementation notes:
 * - Schemas are module-level constants so per-message cost is a single
 *   parse, never per-message schema construction.
 * - `@zod/mini` is tree-shakeable; only the used primitives ship.
 * - `z.coerce.number()` rejects `undefined`, `NaN`, and any
 *   non-numeric string (`invalid_type`), so `"abc"` and `NaN` fail.
 * - `z.nullable` + `??` coercion preserves an existing producer
 *   quirk: explicit `null` behaves exactly like an absent key.
 *   Numbers-as-strings are coerced; wrongly-typed scalars (e.g.
 *   `run_id: 42`) are rejected.
 * - The zero-valued fields (`rps`, `p50`, `p95`, `p99`, `errorRate`)
 *   use `z.prefault(..., 0)` so absence means 0 as before; truly
 *   optional counters stay `z.optional` so `undefined` is honest
 *   "not supplied" downstream. Unknown keys are stripped by the
 *   object schema — extra fields never reach the flusher.
 */

/**
 * Optional number that still accepts numeric strings (`"1.5"` → 1.5).
 *
 * `undefined` stays `undefined` ("not supplied"); explicit `null` rides
 * through and is normalized away by the caller's `??` chain, so it
 * behaves like "not supplied" instead of `Number(null) === 0`.
 */
const optionalNumber = z.optional(z.nullable(z.coerce.number()));

/**
 * Zero-defaulted number, used for the required metric fields.
 *
 * Absent (`undefined`) picks up the default via `z.prefault`;
 * non-numeric garbage (`"abc"`, `NaN`) fails the coerce and surfaces
 * as a boundary validation error.
 */
const defaultedNumber = z.prefault(z.coerce.number(), 0);

/**
 * Optional string that treats explicit `null` as absent.
 */
const optionalString = z.optional(z.nullable(z.string()));

/**
 * Raw wire format of one metric point (before alias resolution).
 *
 * Every snake_case key sits beside its camelCase alias; the caller
 * coalesces (`snake_case ?? camelCase ?? fallback`). Time fields accept
 * any coerceable number (epoch millis as string or number).
 */
const rawPointSchema = z.object({
  /** Epoch milliseconds, snake_case. */
  time_ms: optionalNumber,
  /** Epoch milliseconds, camelCase. */
  time: optionalNumber,
  /** Owning run id, snake_case. */
  run_id: optionalString,
  /** Owning run id, camelCase. */
  runId: optionalString,
  /** Endpoint pattern; `""` for the aggregate row. */
  endpoint: optionalString,
  /** Requests per second for this bucket. */
  rps: defaultedNumber,
  /** Median latency (ms). */
  p50: defaultedNumber,
  /** 95th-percentile latency (ms). */
  p95: defaultedNumber,
  /** 99th-percentile latency (ms). */
  p99: defaultedNumber,
  /** Error ratio in [0, 1], snake_case. */
  error_rate: optionalNumber,
  /** Error ratio in [0, 1], camelCase. */
  errorRate: optionalNumber,
  /** Virtual users started, snake_case. */
  vusers_started: optionalNumber,
  /** Virtual users started, camelCase. */
  vusersStarted: optionalNumber,
  /** Virtual users stopped, snake_case. */
  vusers_stopped: optionalNumber,
  /** Virtual users stopped, camelCase. */
  vusersStopped: optionalNumber,
  /** Virtual users created, snake_case. */
  vusers_created: optionalNumber,
  /** Virtual users created, camelCase. */
  vusersCreated: optionalNumber,
  /** Virtual users completed, snake_case. */
  vusers_completed: optionalNumber,
  /** Virtual users completed, camelCase. */
  vusersCompleted: optionalNumber,
  /** Absolute error count, snake_case. */
  error_count: optionalNumber,
  /** Absolute error count, camelCase. */
  errorCount: optionalNumber,
  /** Histogram minimum (ms), snake_case. */
  hist_min: optionalNumber,
  /** Histogram minimum (ms), camelCase. */
  histMin: optionalNumber,
  /** Histogram maximum (ms), snake_case. */
  hist_max: optionalNumber,
  /** Histogram maximum (ms), camelCase. */
  histMax: optionalNumber,
  /** Histogram 75th percentile (ms), snake_case. */
  hist_p75: optionalNumber,
  /** Histogram 75th percentile (ms), camelCase. */
  histP75: optionalNumber,
  /** Histogram 90th percentile (ms), snake_case. */
  hist_p90: optionalNumber,
  /** Histogram 90th percentile (ms), camelCase. */
  histP90: optionalNumber,
  /** Histogram 99.9th percentile (ms), snake_case. */
  hist_p999: optionalNumber,
  /** Histogram 99.9th percentile (ms), camelCase. */
  histP999: optionalNumber,
});

/**
 * Raw wire format of a batch envelope: an optional top-level run id
 * plus an optional points array.
 *
 * `points` items are validated by {@link normalizePoint} via
 * {@link rawPointSchema}, so each point is parsed exactly once. A
 * payload without `points` is treated by the caller as a single point
 * (the raw object itself), preserving the pre-validation contract for
 * single-point senders.
 */
const rawBatchSchema = z.object({
  /** Batch-default run id, snake_case. */
  run_id: optionalString,
  /** Batch-default run id, camelCase. */
  runId: optionalString,
  /** Points carried by the message; absent means "the message is one point". */
  points: z.optional(z.array(z.unknown())),
});

/**
 * Parsed output of {@link rawPointSchema} — see it for field meanings.
 */
type RawPointInput = z.infer<typeof rawPointSchema>;

/**
 * Parsed output of {@link rawBatchSchema} — see it for field meanings.
 */
type RawBatchInput = z.infer<typeof rawBatchSchema>;

/**
 * Compose the boundary error for a failed parse.
 *
 * @returns a concise `{ path, reason }`-style description of the first
 *   failing issue so WS producers can debug without dumping whole
 *   payloads.
 */
function describeIssues(error: z.core.$ZodError): string {
  const first = error.issues[0];
  if (!first) return "unknown validation failure";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * Parse one untrusted point against the wire schema.
 *
 * @param raw - the raw value (never trusted; `unknown` by design).
 * @param label - context label used in the error message.
 * @returns the parsed, coerced point input.
 * @throws {TypeError} on validation failure; also carry the full zod
 *   error as `cause` for operators debugging producers.
 */
function parsePointInput(raw: unknown, label: string): RawPointInput {
  const result = z.safeParse(rawPointSchema, raw);
  if (result.success) return result.data;
  throw new TypeError(
    `[normalize] invalid ${label} (${describeIssues(result.error)})`,
    { cause: result.error },
  );
}

/**
 * Parse an untrusted batch envelope against the wire schema.
 *
 * @param raw - the raw value (never trusted; `unknown` by design).
 * @returns the parsed envelope; point items are validated downstream
 *   by {@link normalizePoint}, each exactly once.
 * @throws {TypeError} when the envelope shape itself fails.
 */
function parseBatchInput(raw: unknown): RawBatchInput {
  const result = z.safeParse(rawBatchSchema, raw);
  if (result.success) return result.data;
  throw new TypeError(
    `[normalize] invalid batch (${describeIssues(result.error)})`,
    { cause: result.error },
  );
}

/**
 * Reduce a validated point input to the canonical {@link MetricPoint}.
 *
 * Alias resolution (snake_case preferred, camelCase as fallback) and
 * missing-field fallbacks live here — not in the schema — so the
 * schema describes the *accepted wire shape* while this function
 * describes the *mapping out of it* (e.g. `time` → {@link Date}).
 *
 * @param point - output of {@link parsePointInput}.
 * @returns a fully-populated {@link MetricPoint}. Optional counters
 *   and histogram quantiles are `undefined` when the producer omits
 *   them (the flusher leaves those columns NULL). `time` is the
 *   "Invalid Date" state when neither `time_ms` nor `time` is present:
 *   the flusher drops such rows rather than ingest a bogus timestamp.
 */
function toMetricPoint(point: RawPointInput): MetricPoint {
  const epochMs = point.time_ms ?? point.time ?? NaN;
  return {
    time: new Date(epochMs),
    runId: point.run_id ?? point.runId ?? "",
    endpoint: point.endpoint ?? "",
    rps: point.rps,
    p50: point.p50,
    p95: point.p95,
    p99: point.p99,
    errorRate: point.error_rate ?? point.errorRate ?? 0,
    vusersStarted: point.vusers_started ?? point.vusersStarted ?? undefined,
    vusersStopped: point.vusers_stopped ?? point.vusersStopped ?? undefined,
    vusersCreated: point.vusers_created ?? point.vusersCreated ?? undefined,
    vusersCompleted:
      point.vusers_completed ?? point.vusersCompleted ?? undefined,
    errorCount: point.error_count ?? point.errorCount ?? undefined,
    histMin: point.hist_min ?? point.histMin ?? undefined,
    histMax: point.hist_max ?? point.histMax ?? undefined,
    histP75: point.hist_p75 ?? point.histP75 ?? undefined,
    histP90: point.hist_p90 ?? point.histP90 ?? undefined,
    histP999: point.hist_p999 ?? point.histP999 ?? undefined,
  };
}

/**
 * Normalize one raw point produced by user infrastructure into the
 * domain {@link MetricPoint} (alias resolution + validation).
 *
 * @param raw - untrusted point object (snake_case or camelCase keys;
 *   numbers or numeric strings). Anything that is not an object, or
 *   that violates the wire schema, throws.
 * @returns a fully-populated {@link MetricPoint} — see
 *   {@link toMetricPoint} for the missing-field contract.
 * @throws {TypeError} when validation fails.
 */
export function normalizePoint(raw: unknown): MetricPoint {
  return toMetricPoint(parsePointInput(raw, "point"));
}

/**
 * Normalize a batch message (single point or array) into domain points.
 *
 * The batch-level `run_id`/`runId` is inherited by points that omit
 * their own, so one envelope field can cover a run's whole batch.
 * Validation runs before any ingestion: `points` items are each
 * parsed (and once only) by {@link normalizePoint}, while the envelope
 * is parsed by {@link parseBatchInput}. Over-cap batches are still
 * validated in full — the caller's `INGEST_MAX_BATCH_POINTS` slice
 * decides how much of a *valid* message reaches the flusher.
 *
 * @param raw - untrusted envelope object. Without a `points` array
 *   the whole object is treated as one point.
 * @returns parsed {@link MetricPoint} objects with `runId` filled in
 *   from the envelope when a point omits it.
 * @throws {TypeError} when the envelope or any point fails validation.
 */
export function normalizeBatch(raw: unknown): MetricPoint[] {
  const batch = parseBatchInput(raw);
  const runId = batch.run_id ?? batch.runId ?? "";
  const rawPoints: unknown[] = batch.points ?? [raw];
  return rawPoints.map((p) => {
    const point = toMetricPoint(parsePointInput(p, "point"));
    if (!point.runId) point.runId = runId;
    return point;
  });
}
