import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { navigate, parseHash, type Route } from "./router.js";
import { UNAUTHORIZED_EVENT } from "./api.js";
import { currentTheme, toggleTheme } from "./theme.js";
import "./components/health-badge.js";
import "./components/trigger-dialog.js";
import "./views/login.js";
import "./views/run-list.js";
import "./views/run-detail.js";
import "./views/live-view.js";
import "./views/compare-view.js";
import "./views/not-found.js";

/**
 * App shell: sidebar (brand, mono nav, health indicator, theme glyph)
 * and the main content area, switched by the hash router. Shows the
 * login view when the API answers 401 (API_TOKEN set, no/invalid token
 * stored). Dark-first, krivostr instrument styling.
 */
@customElement("broadside-app")
export class App extends LitElement {
  @state() private route: Route = { name: "list" };
  @state() private needsAuth = false;
  @state() private triggerOpen = false;
  @state() private sidebarOpen = false;

  private onHash = () => {
    this.route = parseHash(window.location.hash);
    this.sidebarOpen = false;
  };

  private onUnauthorized = () => {
    this.needsAuth = true;
  };

  override connectedCallback() {
    super.connectedCallback();
    this.onHash();
    window.addEventListener("hashchange", this.onHash);
    window.addEventListener(UNAUTHORIZED_EVENT, this.onUnauthorized);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this.onHash);
    window.removeEventListener(UNAUTHORIZED_EVENT, this.onUnauthorized);
  }

  private navClass(name: Route["name"]): string {
    return this.route.name === name ? "nav-item active" : "nav-item";
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

    const dark = currentTheme() === "dark";

    return html`
      <div class="shell">
        <aside class="sidebar ${this.sidebarOpen ? "open" : ""}">
          <div class="brand">
            <span class="brand-dot" aria-hidden="true"></span>
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
              <span class="glyph" aria-hidden="true">▤</span> Runs
            </a>
            <a
              class=${this.navClass("compare")}
              href="#/compare"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/compare");
              }}
            >
              <span class="glyph" aria-hidden="true">◈</span> Compare
            </a>
          </nav>
          <div class="sidebar-foot">
            <broadside-health-badge></broadside-health-badge>
            <button
              class="theme-btn"
              @click=${toggleTheme}
              title=${dark ? "switch to light (☼)" : "switch to dark (☽)"}
              aria-label="Toggle theme"
            >
              <span class="glyph" aria-hidden="true">${dark ? "☽" : "☼"}</span>
            </button>
          </div>
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
            <span class="topbar-title">artillery runs</span>
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
      width: 216px;
      flex: none;
      background: var(--ink-2);
      border-right: 1px solid var(--rule);
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      height: 100vh;
      z-index: 10;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-5) var(--s-4) var(--s-4);
      font-family: var(--font-mono);
      font-size: var(--step-0);
      color: var(--text);
    }
    .brand-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 12px var(--amber);
      flex: none;
    }
    .brand-name {
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: var(--s-1);
      padding: var(--s-2) var(--s-3);
    }
    .glyph {
      font-family: var(--font-mono);
      font-size: var(--step--1);
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: 9px var(--s-3);
      border-radius: var(--radius);
      color: var(--text-dim);
      text-decoration: none;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      transition: all var(--dur-fast) var(--ease);
      border: 1px solid transparent;
    }
    .nav-item:hover {
      background: var(--surface-2);
      color: var(--text);
    }
    .nav-item.active {
      background: var(--text);
      color: var(--bg);
    }
    .sidebar-foot {
      margin-top: auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--s-4);
      border-top: 1px solid var(--rule);
    }
    .theme-btn,
    .hamburger {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step-0);
      width: 34px;
      height: 34px;
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
    .main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-3) var(--s-5);
      border-bottom: 1px solid var(--rule);
      position: sticky;
      top: 0;
      background: color-mix(in oklab, var(--bg) 85%, transparent);
      backdrop-filter: blur(12px);
      z-index: 5;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
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
        position: fixed;
        left: 0;
        top: 0;
        transform: translateX(-100%);
        transition: transform 180ms ease;
      }
      .sidebar.open {
        transform: none;
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
