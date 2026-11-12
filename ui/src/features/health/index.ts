import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { HealthResponse } from "../../types.js";
import { formatDuration } from "../../format.js";

const POLL_MS = 30_000;

/**
 * Topbar status indicator. Polls /readyz for aggregate system health.
 * Green + "healthy" when all services (dashboard, ingest, db) are live/responsive.
 * Red + "broken" otherwise.
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
      // "unreachable" here means we couldn't determine health; only treat as reachable if probe responded.
      this.unreachable = false;
    } catch {
      this.unreachable = true;
      this.health = null;
    }
  }

  private isHealthy(): boolean {
    if (this.unreachable || !this.health) return false;
    if (typeof this.health.healthy === "boolean") return this.health.healthy;
    const s = this.health.services;
    if (s) {
      return s.dashboard === "ok" && s.ingest === "ok" && s.database === "ok";
    }
    // Backward-compat fallback
    return this.health.status === "ok" && this.health.database?.status === "ok";
  }

  private dotClass(): string {
    return this.isHealthy() ? "dot-ok" : "dot-bad";
  }

  private statusLabel(): string {
    return this.isHealthy() ? "healthy" : "broken";
  }

  private tooltipText(): string {
    if (this.unreachable) return "status: broken (unreachable)";
    if (!this.health) return "checking…";
    const { uptime, flusher, database } = this.health;
    const services = this.health.services;
    const svcLine = services
      ? `services: dashboard=${services.dashboard} ingest=${services.ingest} db=${services.database}`
      : `status: ${this.health.status} · db: ${database.status}`;
    const lines = [
      svcLine,
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
        <span class="text">${this.statusLabel()}</span>
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
