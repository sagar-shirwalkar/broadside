import { RingBuffer } from "./ring-buffer.js";
import { config } from "../config.js";
import { sql } from "../db/client.js";
import { logger } from "../logger.js";
import type { MetricPoint } from "../types.js";

export class MetricsFlusher {
  private ring: RingBuffer<MetricPoint>;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private totalFlushed = 0;
  private dbWriteErrors = 0;
  private lastFlushAt: string | null = null;
  private lastFlushDurationMs = 0;
  private maxBuffered = 0;

  constructor() {
    this.ring = new RingBuffer<MetricPoint>(config.ring.capacity);
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, config.ring.flushIntervalMs);
    // Don't keep process alive just for the timer
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Best-effort final drain; do not re-queue indefinitely on shutdown.
    await this.flush(false);
  }

  /** O(1) — called by all ingestion paths. */
  ingest(points: MetricPoint[]): void {
    this.ring.pushBatch(points);
    if (this.ring.size > this.maxBuffered) this.maxBuffered = this.ring.size;
    if (this.ring.size >= config.ring.batchSize) {
      void this.flush();
    }
  }

  get stats() {
    return {
      buffered: this.ring.size,
      dropped: this.ring.dropped,
      flushed: this.totalFlushed,
      dbWriteErrors: this.dbWriteErrors,
      lastFlushAt: this.lastFlushAt,
      lastFlushDurationMs: this.lastFlushDurationMs,
      maxBuffered: this.maxBuffered,
    };
  }

  private async flush(requeueOnError = true): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      while (this.ring.size > 0) {
        const batch = this.ring.drain(config.ring.batchSize);
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
          this.totalFlushed += batch.length;
          this.lastFlushDurationMs = Date.now() - started;
          this.lastFlushAt = new Date().toISOString();
        } catch (err) {
          this.dbWriteErrors += 1;
          logger.error({ err }, "[flusher] write failed");
          if (requeueOnError) {
            this.ring.pushBatch(batch);
          } else {
            logger.warn(
              { dropped: batch.length },
              "[flusher] dropping batch during shutdown after write failure",
            );
          }
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

export const metricsFlusher = new MetricsFlusher();
