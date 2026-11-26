import { RingBuffer } from "./ring-buffer.ts";
import { config } from "../config.ts";
import { sql } from "../db/client.ts";
import { logger } from "../logger.ts";
import type { MetricPoint } from "../types.ts";

interface Shard {
  ring: RingBuffer<MetricPoint>;
  flushing: boolean;
  totalFlushed: number;
  dbWriteErrors: number;
  lastFlushAt: string | null;
  lastFlushDurationMs: number;
  maxBuffered: number;
  latencySamples: number[]; // recent flush latencies (ms)
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function hashRunId(runId: string, shards: number): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < runId.length; i++) {
    h ^= runId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % shards;
}

export class MetricsFlusher {
  private shards: Shard[] = [];
  private timer: NodeJS.Timeout | null = null;
  private depthSampler: NodeJS.Timeout | null = null;
  private lossTimer: NodeJS.Timeout | null = null;
  private slowDownSent = 0;
  private depthSamples: Array<{ ts: number; depth: number }> = [];
  private droppedByRun = new Map<string, { dropped: number; reason: "ring_overflow" | "flush_failed" }>();

  constructor() {
    const shardCount = Math.max(1, Number(config.ring.shards ?? 1) || 1);
    const perShardCapacity = Math.max(
      2,
      Math.ceil((config.ring.capacity ?? 16384) / shardCount),
    );
    for (let i = 0; i < shardCount; i++) {
      this.shards.push({
        ring: new RingBuffer<MetricPoint>(perShardCapacity),
        flushing: false,
        totalFlushed: 0,
        dbWriteErrors: 0,
        lastFlushAt: null,
        lastFlushDurationMs: 0,
        maxBuffered: 0,
        latencySamples: [],
      });
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      for (let i = 0; i < this.shards.length; i++) void this.flushShard(i);
    }, config.ring.flushIntervalMs);
    this.timer.unref();

    this.depthSampler = setInterval(() => {
      const now = Date.now();
      const depth = this.totalBuffered();
      this.depthSamples.push({ ts: now, depth });
      const cutoff = now - 60_000;
      while (this.depthSamples.length > 0 && this.depthSamples[0]!.ts < cutoff) {
        this.depthSamples.shift();
      }
    }, 1000);
    this.depthSampler.unref();

    this.lossTimer = setInterval(() => {
      void this.applyRunLossAccounting();
    }, 2000);
    this.lossTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.depthSampler) {
      clearInterval(this.depthSampler);
      this.depthSampler = null;
    }
    if (this.lossTimer) {
      clearInterval(this.lossTimer);
      this.lossTimer = null;
    }
    await this.flush(false);
    await this.applyRunLossAccounting();
  }

  /** Drain all buffered points to the database (best-effort). */
  async flush(requeueOnError = true): Promise<void> {
    await Promise.all(this.shards.map((_, i) => this.flushShard(i, requeueOnError)));
  }

  /** O(1) per point — called by all ingestion paths. */
  ingest(points: MetricPoint[]): void {
    if (points.length === 0) return;
    // Group by shard to preserve locality and reduce contention.
    const buckets: MetricPoint[][] = Array.from({ length: this.shards.length }, () => []);
    for (const p of points) {
      const idx = hashRunId(p.runId, this.shards.length);
      buckets[idx]!.push(p);
    }
    for (let i = 0; i < buckets.length; i++) {
      const batch = buckets[i]!;
      if (batch.length === 0) continue;
      const shard = this.shards[i]!;
      const beforeDropped = shard.ring.dropped;
      shard.ring.pushBatch(batch);
      const deltaDropped = shard.ring.dropped - beforeDropped;
      if (deltaDropped > 0) {
        this.recordDropped(batch, deltaDropped);
      }
      if (shard.ring.size > shard.maxBuffered) shard.maxBuffered = shard.ring.size;
      if (shard.ring.size >= config.ring.batchSize) {
        void this.flushShard(i);
      }
    }
  }

  private recordDropped(
    batch: MetricPoint[],
    count: number,
    reason: "ring_overflow" | "flush_failed" = "ring_overflow",
  ): void {
    // Attribute drops approximately by points present in this shard batch.
    // Best-effort accounting for observability (not billing-grade).
    if (count <= 0) return;
    const perRun = new Map<string, number>();
    for (const p of batch) perRun.set(p.runId, (perRun.get(p.runId) ?? 0) + 1);
    const total = batch.length || 1;
    let remaining = count;
    for (const [runId, n] of perRun) {
      const share = Math.max(0, Math.round((count * n) / total));
      if (share <= 0) continue;
      remaining -= share;
      const prev = this.droppedByRun.get(runId);
      this.droppedByRun.set(runId, {
        dropped: (prev?.dropped ?? 0) + share,
        reason: prev?.reason === "flush_failed" ? "flush_failed" : reason,
      });
    }
    if (remaining > 0) {
      const fallback = batch[0]?.runId ?? "unknown";
      const prev = this.droppedByRun.get(fallback);
      this.droppedByRun.set(fallback, {
        dropped: (prev?.dropped ?? 0) + remaining,
        reason: prev?.reason === "flush_failed" ? "flush_failed" : reason,
      });
    }
  }

  /** Best-effort snapshot and reset of per-run drop counters. */
  drainDroppedByRun(): Map<string, { dropped: number; reason: "ring_overflow" | "flush_failed" }> {
    const snapshot = new Map(this.droppedByRun);
    this.droppedByRun.clear();
    return snapshot;
  }

  private async applyRunLossAccounting(): Promise<void> {
    const drops = this.drainDroppedByRun();
    if (drops.size === 0) return;
    for (const [runId, info] of drops) {
      if (!runId || runId === "unknown" || info.dropped <= 0) continue;
      try {
        await sql`
          UPDATE runs
          SET partial_data = TRUE,
              dropped_points = COALESCE(dropped_points, 0) + ${info.dropped},
              failure_reason = COALESCE(failure_reason, ${info.reason})
          WHERE id = ${runId}
        `;
      } catch (err) {
        logger.error(
          { err, runId, dropped: info.dropped, reason: info.reason },
          "[flusher] failed to persist run loss accounting",
        );
      }
    }
  }

  shouldSlowDown(): boolean {
    const cap = this.totalCapacity();
    if (cap <= 0) return false;
    return this.totalBuffered() / cap >= config.ring.slowDownThreshold;
  }

  /** Suggested producer target Hz when backpressured (proportional to headroom). */
  getSlowDownTargetHz(): number {
    const cap = this.totalCapacity();
    if (cap <= 0) return 1;
    const utilization = this.totalBuffered() / cap;
    const headroom = Math.max(0, 1 - utilization);
    // Scale target with remaining headroom: 1 Hz when nearly full, higher when just over threshold.
    return Math.max(1, Math.floor(headroom * 100));
  }

  noteSlowDownSent(): void {
    this.slowDownSent += 1;
  }

  private totalBuffered(): number {
    let n = 0;
    for (const s of this.shards) n += s.ring.size;
    return n;
  }

  private totalCapacity(): number {
    let n = 0;
    for (const s of this.shards) n += s.ring.capacity;
    return n;
  }

  get stats() {
    let buffered = 0;
    let dropped = 0;
    let flushed = 0;
    let dbWriteErrors = 0;
    let maxBuffered = 0;
    let lastFlushAt: string | null = null;
    let lastFlushDurationMs = 0;
    const allLatencies: number[] = [];
    for (const s of this.shards) {
      buffered += s.ring.size;
      dropped += s.ring.dropped;
      flushed += s.totalFlushed;
      dbWriteErrors += s.dbWriteErrors;
      maxBuffered += s.maxBuffered;
      if (s.lastFlushAt && (!lastFlushAt || s.lastFlushAt > lastFlushAt)) {
        lastFlushAt = s.lastFlushAt;
        lastFlushDurationMs = s.lastFlushDurationMs;
      }
      allLatencies.push(...s.latencySamples);
    }
    const latencies = allLatencies.slice(-200);
    const depthCurrent = buffered;
    let depthMaxLastMinute = depthCurrent;
    for (const sample of this.depthSamples) {
      if (sample.depth > depthMaxLastMinute) depthMaxLastMinute = sample.depth;
    }
    return {
      buffered,
      dropped,
      flushed,
      dbWriteErrors,
      lastFlushAt,
      lastFlushDurationMs,
      maxBuffered,
      slowDownSent: this.slowDownSent,
      shards: this.shards.length,
      flushLatencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
      },
      ringDepth: {
        current: depthCurrent,
        maxLastMinute: depthMaxLastMinute,
      },
    };
  }

  private async flushShard(index: number, requeueOnError = true): Promise<void> {
    const shard = this.shards[index];
    if (!shard || shard.flushing) return;
    shard.flushing = true;

    try {
      while (shard.ring.size > 0) {
        const batch = shard.ring.drain(config.ring.batchSize ?? 5000);
        if (batch.length === 0) break;

        const started = Date.now();
        try {
          await sql`
            INSERT INTO metrics
            ${sql(batch.map((p) => ({
              time: p.time.toISOString(),
              run_id: p.runId,
              endpoint: p.endpoint,
              rps: p.rps,
              p50: p.p50,
              p95: p.p95,
              p99: p.p99,
              error_rate: p.errorRate,
              vusers_started: p.vusersStarted ?? null,
              vusers_stopped: p.vusersStopped ?? null,
              vusers_created: p.vusersCreated ?? null,
              vusers_completed: p.vusersCompleted ?? null,
              error_count: p.errorCount ?? null,
              hist_min: p.histMin ?? null,
              hist_max: p.histMax ?? null,
              hist_p75: p.histP75 ?? null,
              hist_p90: p.histP90 ?? null,
              hist_p999: p.histP999 ?? null,
            })))}
          `;
          shard.totalFlushed += batch.length;
          const dur = Date.now() - started;
          shard.lastFlushDurationMs = dur;
          shard.lastFlushAt = new Date().toISOString();
          shard.latencySamples.push(dur);
          if (shard.latencySamples.length > 200) {
            shard.latencySamples.splice(0, shard.latencySamples.length - 200);
          }
        } catch (err) {
          shard.dbWriteErrors += 1;
          logger.error({ err, shard: index }, "[flusher] write failed");
          if (requeueOnError) {
            shard.ring.pushBatch(batch);
          } else {
            logger.warn(
              { shard: index, dropped: batch.length },
              "[flusher] dropping batch during shutdown after write failure",
            );
            this.recordDropped(batch, batch.length, "flush_failed");
          }
          break;
        }
      }
    } finally {
      shard.flushing = false;
    }
  }
}

export const metricsFlusher = new MetricsFlusher();
