import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeBatch, normalizePoint } from "../src/lib/normalize.js";

/**
 * Property-based fuzz suite for the normalize boundary — the repo's
 * only untrusted-JSON parse point (WebSocket/Kafka ingestion). This is
 * also Broadside's fast-check fuzzing story (OpenSSF Scorecard's
 * TypeScript Fuzzing probe).
 */

// A valid snake_case point generated from *typed* values: every field
// guaranteed to pass the wire schema (finite numbers or numeric strings).
//
// Bounds: epoch millis are capped at ~2096-06 so `new Date()` stays
// in valid JS territory across the whole fuzz domain.
const EPOCH_MAX = 4_000_000_000_000;

const validSnakePoint = fc.record({
  time_ms: fc.oneof(
    fc.nat({ max: EPOCH_MAX }),
    fc.nat({ max: EPOCH_MAX }).map(String),
  ),
  run_id: fc.string({ maxLength: 32 }),
  endpoint: fc.string({ maxLength: 64 }),
  rps: fc.double({ noNaN: true, noDefaultInfinity: true }),
  p50: fc.double({ noNaN: true, noDefaultInfinity: true }),
  p95: fc.double({ noNaN: true, noDefaultInfinity: true }),
  p99: fc.double({ noNaN: true, noDefaultInfinity: true }),
  error_rate: fc.double({ min: 0, max: 1, noNaN: true }),
  error_count: fc.nat(),
  vusers_started: fc.nat(),
  vusers_stopped: fc.nat(),
  vusers_created: fc.nat(),
  vusers_completed: fc.nat(),
  hist_min: fc.double({ noNaN: true, noDefaultInfinity: true }),
  hist_max: fc.double({ noNaN: true, noDefaultInfinity: true }),
});

// Batch envelope with a typed run id and an array of *typed-or-garbage*
// points. Each point is either well-formed or an arbitrary JSON value,
// exercising both accept and reject paths.
const batchEnvelope = fc.record({
  run_id: fc.string({ maxLength: 32 }),
  points: fc.array(
    fc.oneof(validSnakePoint, fc.jsonValue({ maxDepth: 3 })),
  ),
});

describe("normalize fuzz (fast-check)", () => {
  it("never throws anything but TypeError on arbitrary JSON values", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (input) => {
        try {
          const points = normalizeBatch(input);
          expect(Array.isArray(points)).toBe(true);
          for (const point of points) {
            expect(point.runId).toEqual(expect.any(String));
            expect(point.endpoint).toEqual(expect.any(String));
            expect(Number.isFinite(point.rps)).toBe(true);
            expect(Number.isFinite(point.p50)).toBe(true);
            expect(Number.isFinite(point.p95)).toBe(true);
            expect(Number.isFinite(point.p99)).toBe(true);
            expect(Number.isFinite(point.errorRate)).toBe(true);
            for (const optional of [
              point.errorCount,
              point.vusersStarted,
              point.vusersStopped,
              point.vusersCreated,
              point.vusersCompleted,
            ]) {
              if (optional !== undefined) {
                expect(Number.isFinite(optional)).toBe(true);
              }
            }
          }
        } catch (err) {
          expect(err).toBeInstanceOf(TypeError);
        }
      }),
    );
  });

  it("preserves batch length and run-id inheritance for valid batches", () => {
    fc.assert(
      fc.property(batchEnvelope, (envelope) => {
        try {
          const points = normalizeBatch(envelope);
          expect(points).toHaveLength(envelope.points.length);
          points.forEach((point, i) => {
            const raw = envelope.points[i] as Record<string, unknown> | undefined;
            const ownRunId = raw?.run_id ?? raw?.runId;
            if (typeof ownRunId === "string" && ownRunId.length > 0) {
              expect(point.runId).toBe(ownRunId);
            } else {
              expect(point.runId).toBe(envelope.run_id);
            }
          });
        } catch (err) {
          // Garbage items in the points array reject the whole batch —
          // that is the fail-closed contract. It must be a TypeError.
          expect(err).toBeInstanceOf(TypeError);
        }
      }),
    );
  });

  it("round-trips a well-formed point through its snake_case aliases", () => {
    fc.assert(
      fc.property(validSnakePoint, (raw) => {
        const point = normalizePoint(raw);

        expect(point.time.getTime()).toBe(Number(raw.time_ms));
        expect(point.runId).toBe(raw.run_id);
        expect(point.endpoint).toBe(raw.endpoint);
        expect(point.rps).toBe(raw.rps);
        expect(point.p50).toBe(raw.p50);
        expect(point.p95).toBe(raw.p95);
        expect(point.p99).toBe(raw.p99);
        expect(point.errorRate).toBe(raw.error_rate);
        expect(point.errorCount).toBe(raw.error_count);
        expect(point.vusersStarted).toBe(raw.vusers_started);
        expect(point.histMax).toBe(raw.hist_max);
      }),
    );
  });

  it("camelCase and snake_case aliases produce equal points", () => {
    fc.assert(
      fc.property(validSnakePoint, (snake) => {
        const camel = {
          time: snake.time_ms,
          runId: snake.run_id,
          endpoint: snake.endpoint,
          rps: snake.rps,
          p50: snake.p50,
          p95: snake.p95,
          p99: snake.p99,
          errorRate: snake.error_rate,
          errorCount: snake.error_count,
          vusersStarted: snake.vusers_started,
          vusersStopped: snake.vusers_stopped,
          vusersCreated: snake.vusers_created,
          vusersCompleted: snake.vusers_completed,
          histMin: snake.hist_min,
          histMax: snake.hist_max,
        };
        expect(normalizePoint(camel)).toEqual(normalizePoint(snake));
      }),
    );
  });

  it("is idempotent: re-normalizing a MetricPoint changes nothing", () => {
    fc.assert(
      fc.property(validSnakePoint, (raw) => {
        const first = normalizePoint(raw);
        // normalizePoint's own output uses camelCase keys, which the
        // schema accepts as aliases — re-parse must be a fixed point.
        const second = normalizePoint(first as unknown as object);

        expect(second.time.getTime()).toBe(first.time.getTime());
        expect(second.runId).toBe(first.runId);
        expect(second.endpoint).toBe(first.endpoint);
        expect(second.rps).toBe(first.rps);
        expect(second.p50).toBe(first.p50);
        expect(second.p95).toBe(first.p95);
        expect(second.p99).toBe(first.p99);
        expect(second.errorRate).toBe(first.errorRate);
        expect(second.errorCount).toBe(first.errorCount);
        expect(second.vusersStarted).toBe(first.vusersStarted);
        expect(second.histMax).toBe(first.histMax);
      }),
    );
  });

  it("ignores unknown extra keys (metamorphic: adding keys is a no-op)", () => {
    fc.assert(
      fc.property(
        validSnakePoint,
        fc.string({ maxLength: 16 }).filter((k) => k !== "points"),
        (raw, extraKey) => {
          const baseline = normalizePoint(raw);
          const withExtra = normalizePoint({ ...raw, [extraKey]: fc.sample(fc.jsonValue()) });
          expect(withExtra).toEqual(baseline);
        },
      ),
    );
  });

  it("duplicate-field preference: snake_case wins over camelCase", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (snakeVal, camelVal) => {
          const point = normalizePoint({
            time_ms: snakeVal,
            time: camelVal,
            run_id: "snake-run",
            runId: "camel-run",
          });
          // snake_case is preferred via the ?? chain.
          expect(point.time.getTime()).toBe(snakeVal);
          expect(point.runId).toBe("snake-run");
        },
      ),
    );
  });

  it("time_ms/time aliases are equivalent single-value alternatives", () => {
    fc.assert(
      fc.property(fc.nat({ max: EPOCH_MAX }), (epoch) => {
        expect(normalizePoint({ time_ms: epoch }).time.getTime()).toBe(epoch);
        expect(normalizePoint({ time: epoch }).time.getTime()).toBe(epoch);
      }),
    );
  });
});
