import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
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
 * App shell: sidebar (nav + health indicator + theme toggle) and the main
 * content area, switched by the hash router. Shows the login view when the
 * API answers 401 (API_TOKEN set, no/invalid token stored).
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

    const theme = currentTheme();

    return html`
      <div class="shell">
        <aside class="sidebar ${this.sidebarOpen ? "open" : ""}">
          <div class="brand">
            <img src="/favicon.svg" alt="" width="30" height="30" />
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
              <sl-icon name="list"></sl-icon> Runs
            </a>
            <a
              class=${this.navClass("compare")}
              href="#/compare"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/compare");
              }}
            >
              <sl-icon name="graph-up"></sl-icon> Compare
            </a>
          </nav>
          <div class="sidebar-foot">
            <broadside-health-badge></broadside-health-badge>
            <sl-button
              variant="text"
              size="small"
              @click=${toggleTheme}
            >
              <sl-icon
                name=${theme === "dark" ? "sun" : "moon-stars"}
                label="Toggle theme"
              ></sl-icon>
            </sl-button>
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
            <sl-button
              variant="text"
              size="small"
              class="hamburger"
              @click=${() => (this.sidebarOpen = !this.sidebarOpen)}
            >
              <sl-icon name="list" label="Menu"></sl-icon>
            </sl-button>
            <span class="topbar-title">Artillery runs</span>
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
      width: 220px;
      flex: none;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
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
      gap: var(--space-3);
      padding: var(--space-5) var(--space-4) var(--space-4);
    }
    .brand-name {
      font-size: var(--text-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 var(--space-2);
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: 10px var(--space-3);
      border-radius: 10px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: var(--text-sm);
      font-weight: 500;
    }
    .nav-item:hover {
      background: var(--surface-hover);
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
      padding: var(--space-4);
      border-top: 1px solid var(--border);
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
      gap: var(--space-2);
      padding: var(--space-3) var(--space-5);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg);
      z-index: 5;
    }
    .hamburger {
      display: none;
    }
    .topbar-title {
      font-size: var(--text-sm);
      color: var(--text-muted);
      font-weight: 500;
    }
    .content {
      padding: var(--space-5);
      max-width: 1440px;
      width: 100%;
      box-sizing: border-box;
      margin: 0 auto;
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
        display: inline-block;
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
