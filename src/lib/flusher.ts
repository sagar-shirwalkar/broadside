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

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    void this.flush(); // final drain
  }

  /** O(1) — called by all ingestion paths. */
  ingest(points: MetricPoint[]): void {
    this.ring.pushBatch(points);
    if (this.ring.size >= config.ring.batchSize) {
      void this.flush();
    }
  }

  get stats() {
    return {
      buffered: this.ring.size,
      dropped: this.ring.dropped,
      flushed: this.totalFlushed,
    };
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    const batch = this.ring.drain(config.ring.batchSize);
    if (batch.length === 0) {
      this.flushing = false;
      return;
    }

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
        })))}
      `;
      this.totalFlushed += batch.length;
    } catch (err) {
      logger.error({ err }, "[flusher] write failed, re-queueing");
      this.ring.pushBatch(batch);
    }

    this.flushing = false;
  }
}

export const metricsFlusher = new MetricsFlusher();
