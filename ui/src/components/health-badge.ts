import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { HealthResponse } from "../types.js";
import { formatDuration } from "../format.js";

const POLL_MS = 30_000;

/**
 * Sidebar footer indicator. Polls /api/health every 30s: green dot when
 * ok, amber when the database is down, red when the server is unreachable.
 * A native `title` tooltip carries uptime + flusher stats; dropped
 * points get a warning glyph.
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
    // /api/health is public and must never toast — poll with plain fetch.
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`health ${res.status}`);
      const body = (await res.json()) as HealthResponse;
      if (!body.flusher) throw new Error("malformed health payload");
      this.health = body;
      this.unreachable = false;
    } catch {
      this.unreachable = true;
      this.health = null;
    }
  }

  private dotClass(): string {
    if (this.unreachable) return "dot-bad";
    if (this.health?.status === "degraded") return "dot-wait";
    return "dot-ok";
  }

  private tooltipText(): string {
    if (this.unreachable) return "server unreachable";
    if (!this.health) return "checking…";
    const { uptime, flusher, database } = this.health;
    return [
      `status: ${this.health.status} · db: ${database.status}`,
      `uptime: ${formatDuration(Math.round(uptime * 1000))}`,
      `buffered: ${flusher.buffered} · dropped: ${flusher.dropped} · flushed: ${flusher.flushed}`,
    ].join("\n");
  }

  override render() {
    return html`
      <span class="badge" role="status" title=${this.tooltipText()}>
        <span class="dot ${this.dotClass()}"></span>
        <span class="text">
          ${this.unreachable ? "offline" : this.health?.status ?? "…"}
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
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
      flex: none;
    }
    .dot-ok {
      background: var(--ok);
      box-shadow: 0 0 8px var(--ok);
    }
    .dot-wait {
      background: var(--warn);
      animation: blink 1.2s infinite;
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
