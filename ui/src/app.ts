import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { navigate, parseHash, type Route } from "./router.js";
import { RUN_STATUS_EVENT, UNAUTHORIZED_EVENT } from "./api.js";
import { currentTheme, toggleTheme } from "./theme.js";
import type { RunStatus } from "./types.js";
import "./components/health-badge.js";
import "./components/trigger-dialog.js";
import "./views/login.js";
import "./views/run-list.js";
import "./views/run-detail.js";
import "./views/live-view.js";
import "./views/compare-view.js";
import "./views/not-found.js";

/**
 * App shell: slim fixed sidebar (brand, mono nav) + sticky topbar with
 * the page title, live status, health indicator and theme glyph.
 * Shows the login view when the API answers 401 (API_TOKEN set, no
 * valid token stored). Dark-first, krivostr instrument styling.
 */
@customElement("broadside-app")
export class App extends LitElement {
  @state() private route: Route = { name: "list" };
  @state() private runStatus: RunStatus | null = null;
  @state() private needsAuth = false;
  @state() private triggerOpen = false;
  @state() private sidebarOpen = false;
  @state() private theme = currentTheme();

  private onHash = () => {
    this.route = parseHash(window.location.hash);
    this.runStatus = null;
    this.sidebarOpen = false;
  };

  private onToggleTheme = () => {
    toggleTheme();
    this.theme = currentTheme();
  };

  private onUnauthorized = () => {
    this.needsAuth = true;
  };

  private onRunStatus = (event: Event) => {
    this.runStatus = (event as CustomEvent<RunStatus>).detail;
  };

  override connectedCallback() {
    super.connectedCallback();
    this.onHash();
    window.addEventListener("hashchange", this.onHash);
    window.addEventListener(UNAUTHORIZED_EVENT, this.onUnauthorized);
    window.addEventListener(RUN_STATUS_EVENT, this.onRunStatus);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this.onHash);
    window.removeEventListener(UNAUTHORIZED_EVENT, this.onUnauthorized);
    window.removeEventListener(RUN_STATUS_EVENT, this.onRunStatus);
  }

  private navClass(name: Route["name"]): string {
    return this.route.name === name ? "nav-item active" : "nav-item";
  }

  private topbarTitle(): string {
    const name = this.route.name;
    if (name === "compare") return "Compare Artillery Runs";
    if (name === "detail" || name === "live") return "Artillery Run Status";
    return "Artillery Runs";
  }

  private view() {
    const route = this.route;
    switch (route.name) {
      case "list":
        return html`<broadside-run-list></broadside-run-list>`;
      case "detail":
        return keyed(
          route.id,
          html`<broadside-run-detail
            .runId=${route.id}
          ></broadside-run-detail>`,
        );
      case "live":
        return keyed(
          route.id,
          html`<broadside-live-view
            .runId=${route.id}
          ></broadside-live-view>`,
        );
      case "compare":
        return html`<broadside-compare-view></broadside-compare-view>`;
      case "not-found":
        return html`<broadside-not-found
          message=${`No page at ${route.path}`}
        ></broadside-not-found>`;
    }
  }

  override render() {
    if (this.needsAuth) {
      return html`<broadside-login
        @login-success=${() => (this.needsAuth = false)}
      ></broadside-login>`;
    }

    const dark = this.theme === "dark";
    const status = this.runStatus;

    return html`
      <div class="shell">
        <aside class="sidebar ${this.sidebarOpen ? "open" : ""}">
          <div class="brand">
            <img src="/favicon.svg" alt="" class="brand-img" />
            <span class="brand-name">Broadside</span>
          </div>
          <nav>
            <a
              class=${this.navClass("list")}
              href="#/"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              <span class="glyph" aria-hidden="true">▶</span> Runs
            </a>
            <a
              class=${this.navClass("compare")}
              href="#/compare"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/compare");
              }}
            >
              <span class="glyph" aria-hidden="true">≋</span> Compare
            </a>
          </nav>
        </aside>
        ${this.sidebarOpen
          ? html`<div
              class="scrim"
              @click=${() => (this.sidebarOpen = false)}
            ></div>`
          : ""}
        <main class="main">
          <header class="topbar">
            <button
              class="hamburger"
              @click=${() => (this.sidebarOpen = !this.sidebarOpen)}
              aria-label="Menu"
            >
              <span class="glyph" aria-hidden="true">≡</span>
            </button>
            <span class="topbar-title">${this.topbarTitle()}</span>
            ${status === "completed" || status === "running" || status === "failed"
              ? html`<span class="topbar-status topbar-status-${status}">
                  ${status === "completed" ? "✓" : status === "failed" ? "✕" : "●"}
                  ${status}
                </span>`
              : ""}
            <span class="topbar-right">
              <broadside-health-badge></broadside-health-badge>
              <button
                class="theme-btn"
                @click=${this.onToggleTheme}
                title=${dark ? "switch to light" : "switch to dark"}
                aria-label="Toggle theme"
              >
                <span class="glyph glyph-large" aria-hidden="true">${dark ? "☽" : "☼"}</span>
              </button>
            </span>
          </header>
          <section
            class="content"
            @new-run=${() => (this.triggerOpen = true)}
          >
            ${this.view()}
          </section>
        </main>
      </div>

      <broadside-trigger-dialog
        .open=${this.triggerOpen}
        @close=${() => (this.triggerOpen = false)}
        @run-started=${(e: CustomEvent<{ id: string }>) => {
          this.triggerOpen = false;
          navigate(`/runs/${e.detail.id}/live`);
        }}
      ></broadside-trigger-dialog>
    `;
  }

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }
    .shell {
      display: flex;
      min-height: 100vh;
    }
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 160px;
      z-index: 10;
      background: var(--ink-2);
      border-right: 1px solid var(--rule);
      display: flex;
      flex-direction: column;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      padding: var(--s-4) var(--s-3);
      font-family: var(--font-mono);
    }
    .brand-img {
      width: 22px;
      height: 22px;
      flex: none;
    }
    .brand-name {
      font-size: var(--step-1);
      font-weight: 600;
      color: var(--text);
      letter-spacing: 0.01em;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: var(--s-1);
      padding: var(--s-3);
    }
    .glyph {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      line-height: 1;
    }
    .glyph-large {
      font-size: var(--step-1);
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-2) var(--s-3);
      border-radius: var(--radius);
      color: var(--text-dim);
      text-decoration: none;
      font-family: var(--font-mono);
      font-size: var(--step-1);
      font-weight: 500;
      border: 1px solid transparent;
      transition: all var(--dur-fast) var(--ease);
    }
    .nav-item:hover {
      background: var(--surface-2);
      color: var(--text);
    }
    .nav-item.active {
      background: var(--text);
      color: var(--bg);
    }
    .main {
      margin-left: 160px;
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: var(--s-4);
      padding: var(--s-3) var(--s-5);
      border-bottom: 1px solid var(--rule);
      position: sticky;
      top: 0;
      background: color-mix(in oklab, var(--bg) 85%, transparent);
      backdrop-filter: blur(12px);
      z-index: 5;
      font-family: var(--font-mono);
    }
    .topbar-title {
      font-size: var(--step-1);
      font-weight: 500;
      color: var(--text);
      letter-spacing: 0.01em;
    }
    .topbar-status {
      font-size: var(--step--1);
    }
    .topbar-status-completed {
      color: var(--ok);
      font-weight: 600;
    }
    .topbar-status-running {
      color: var(--ok);
    }
    .topbar-status-failed {
      color: var(--bad);
      font-weight: 600;
    }
    .topbar-right {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--s-3);
    }
    .theme-btn,
    .hamburger {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--mute);
      font-family: var(--font-mono);
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .theme-btn:hover,
    .hamburger:hover {
      color: var(--text);
      border-color: var(--amber-dim);
    }
    .hamburger {
      display: none;
    }
    .content {
      padding: var(--s-6) var(--s-5);
      max-width: 1440px;
      width: 100%;
      box-sizing: border-box;
      margin: 0 auto;
      animation: fade-up var(--dur-slow) var(--ease);
    }
    .scrim {
      display: none;
    }
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform 180ms ease;
      }
      .sidebar.open {
        transform: none;
      }
      .main {
        margin-left: 0;
      }
      .hamburger {
        display: inline-flex;
      }
      .scrim {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 9;
      }
    }
  `;
}
