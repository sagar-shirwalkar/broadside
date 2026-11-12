import { sql } from "../db/client.js";
import { logger } from "../logger.js";

interface RunIngestState {
  lastSeenAt: number;
  sawIngest: boolean;
}

class IngestTracker {
  private state = new Map<string, RunIngestState>();
  private timer: NodeJS.Timeout | null = null;
  private stallMs = parseInt(process.env.INGEST_STALL_TIMEOUT_MS ?? "30000", 10);
  private checkIntervalMs = parseInt(process.env.INGEST_STALL_CHECK_MS ?? "5000", 10);

  touch(runId: string): void {
    if (!runId) return;
    const now = Date.now();
    const existing = this.state.get(runId);
    this.state.set(runId, { lastSeenAt: now, sawIngest: true });
    if (!existing) {
      // best-effort mark as ingest-tracked? no schema change required
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.check();
    }, this.checkIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    const now = Date.now();
    const candidates: string[] = [];
    for (const [runId, st] of this.state) {
      if (st.sawIngest && now - st.lastSeenAt > this.stallMs) {
        candidates.push(runId);
      }
    }
    for (const runId of candidates) {
      try {
        // Only mark runs that are still running and had ingest activity
        const res = (await sql`
          UPDATE runs
          SET status = 'failed',
              failure_reason = COALESCE(failure_reason, ${"ingest_disconnected"}),
              partial_data = TRUE
          WHERE id = ${runId} AND status = 'running'
          RETURNING id
        `) as Array<{ id: string }>;
        if (res.length > 0) {
          logger.warn({ runId }, "[ingest] marked run as ingest_disconnected due to stall");
        }
        this.state.delete(runId);
      } catch (err) {
        logger.error({ err, runId }, "[ingest] failed to mark stalled run");
      }
    }
  }
}

export const ingestTracker = new IngestTracker();
