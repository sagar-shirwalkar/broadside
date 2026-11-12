import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { HealthResponse } from "../../types.js";
import { formatDuration } from "../../format.js";

const POLL_MS = 30_000;

/**
 * Topbar status indicator. Polls /readyz for rich status (DB + flusher).
 * Falls back to disconnected when unreachable/degraded probe fails.
 */
@customElement("broadside-health-badge")
export class HealthBadge extends LitElement {
  @state() private health: HealthResponse | null = null;
  @state() private unreachable = false;
  private timer: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  private async poll() {
    try {
      const res = await fetch("/readyz");
      const body = (await res.json()) as HealthResponse;
      if (!body.flusher) throw new Error("malformed ready payload");
      this.health = body;
      this.unreachable = false;
    } catch {
      this.unreachable = true;
      this.health = null;
    }
  }

  private dotClass(): string {
    if (this.unreachable) return "dot-bad";
    if (this.health?.status === "degraded") return "dot-bad";
    return "dot-ok";
  }

  private tooltipText(): string {
    if (this.unreachable) return "server unreachable";
    if (!this.health) return "checking…";
    const { uptime, flusher, database } = this.health;
    const lines = [
      `status: ${this.health.status} · db: ${database.status}`,
      `uptime: ${formatDuration(Math.round(uptime * 1000))}`,
      `buffered: ${flusher.buffered} · dropped: ${flusher.dropped} · flushed: ${flusher.flushed}`,
    ];
    if (typeof flusher.dbWriteErrors === "number") {
      lines.push(`db write errors: ${flusher.dbWriteErrors}`);
    }
    if (flusher.ringDepth) {
      lines.push(
        `ring depth: ${flusher.ringDepth.current} (max 1m: ${flusher.ringDepth.maxLastMinute})`,
      );
    }
    if (flusher.flushLatencyMs) {
      lines.push(
        `flush latency ms p50/p95/p99: ${Math.round(flusher.flushLatencyMs.p50)}/${Math.round(flusher.flushLatencyMs.p95)}/${Math.round(flusher.flushLatencyMs.p99)}`,
      );
    }
    return lines.join("\n");
  }

  override render() {
    return html`
      <span class="badge" role="status" title=${this.tooltipText()}>
        <span class="dot ${this.dotClass()}"></span>
        <span class="text">
          ${this.unreachable ? "disconnected" : "connected"}
        </span>
        ${this.health?.flusher.dropped
          ? html`<span class="warn" aria-hidden="true">⚠</span>`
          : ""}
      </span>
    `;
  }

  static styles = css`
    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--text-dim);
      cursor: help;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
      flex: none;
    }
    .dot-ok {
      background: var(--ok);
      box-shadow: 0 0 8px var(--ok);
    }
    .dot-bad {
      background: var(--bad);
    }
    .warn {
      color: var(--warn);
      font-size: var(--step--1);
    }
  `;
}
