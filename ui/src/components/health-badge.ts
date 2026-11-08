import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import type { HealthResponse } from "../types.js";
import { formatDuration } from "../format.js";

const POLL_MS = 30_000;

/**
 * Sidebar footer indicator. Polls /api/health every 30s: green dot when
 * ok, amber when the database is down, red when the server is unreachable.
 * The tooltip carries uptime + flusher stats; dropped points get a warning
 * icon.
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
    if (this.unreachable) return "dot-red";
    if (this.health?.status === "degraded") return "dot-amber";
    return "dot-green";
  }

  private tooltipText(): string {
    if (this.unreachable) return "Server unreachable";
    if (!this.health) return "Checking…";
    const { uptime, flusher, database } = this.health;
    return [
      `Status: ${this.health.status}`,
      `Database: ${database.status}`,
      `Uptime: ${formatDuration(Math.round(uptime * 1000))}`,
      `Buffered: ${flusher.buffered} · Dropped: ${flusher.dropped} · Flushed: ${flusher.flushed}`,
    ].join(" · ");
  }

  override render() {
    return html`
      <sl-tooltip content=${this.tooltipText()} placement="top">
        <span class="badge" role="status">
          <span class="dot ${this.dotClass()}"></span>
          <span class="text">
            ${this.unreachable ? "offline" : this.health?.status ?? "…"}
          </span>
          ${this.health?.flusher.dropped
            ? html`<sl-icon
                name="exclamation-triangle"
                class="warn"
                label="Dropped points"
              ></sl-icon>`
            : ""}
        </span>
      </sl-tooltip>
    `;
  }

  static styles = css`
    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-sm);
      color: var(--text-muted);
      cursor: help;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex: none;
    }
    .dot-green {
      background: var(--success);
    }
    .dot-amber {
      background: var(--warning);
    }
    .dot-red {
      background: var(--danger);
    }
    .warn {
      color: var(--warning);
      font-size: 16px;
    }
  `;
}
