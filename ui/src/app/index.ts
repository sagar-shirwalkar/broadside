import { LitElement, css } from "lit";
import { customElement } from "lit/decorators.js";
import { parseHash } from "../lib/router.js";
import { RUN_STATUS_EVENT, UNAUTHORIZED_EVENT } from "../services/api.js";
import type { RunStatus } from "../types.js";
import { applyTheme, currentTheme, toggleTheme } from "../theme.js";
import type { AppAction, AppState } from "./types.js";
import { update } from "./update.js";
import { view } from "./view.js";

const initialState = (): AppState => ({
  route: parseHash(window.location.hash),
  runStatus: null,
  needsAuth: false,
  triggerOpen: false,
  sidebarOpen: false,
  theme: currentTheme(),
});

/**
 * Root app shell (TEA/MVU): model/update/view separated, subscriptions wired to dispatch.
 */
@customElement("broadside-app")
export class App extends LitElement {
  private model: AppState = initialState();

  private dispatch = (action: AppAction): void => {
    // side-effectful action handled here (theme) to keep update pure
    if (action.type === "toggle_theme") {
      toggleTheme();
      action = { ...action, theme: currentTheme() };
    }
    this.model = update(this.model, action);
    this.requestUpdate();
  };

  private onHash = () => {
    this.dispatch({ type: "route_changed", route: parseHash(window.location.hash) });
  };

  private onUnauthorized = () => {
    this.dispatch({ type: "unauthorized" });
  };

  private onRunStatus = (event: Event) => {
    this.dispatch({
      type: "run_status",
      status: (event as CustomEvent<RunStatus>).detail,
    });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.model = { ...initialState(), theme: currentTheme() };
    window.addEventListener("hashchange", this.onHash);
    window.addEventListener(UNAUTHORIZED_EVENT, this.onUnauthorized);
    window.addEventListener(RUN_STATUS_EVENT, this.onRunStatus);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this.onHash);
    window.removeEventListener(UNAUTHORIZED_EVENT, this.onUnauthorized);
    window.removeEventListener(RUN_STATUS_EVENT, this.onRunStatus);
  }

  protected override render() {
    // ensure theme attr reflects state
    applyTheme(this.model.theme);
    return view(this.model, this.dispatch);
  }

  static override styles = css`
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
      width: 208px;
      z-index: 10;
      background: var(--ink-2);
      border-right: 1px solid var(--rule);
      display: flex;
      flex-direction: column;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--s-2);
      padding: var(--s-4) var(--s-3);
      font-family: var(--font-mono);
      background: transparent;
      border: none;
      border-bottom: none;
      cursor: pointer;
      text-align: center;
    }
    .brand-img {
      width: 24px;
      height: 24px;
      flex: none;
    }
    .brand-name {
      font-size: var(--step-2);
      font-weight: 600;
      color: var(--text);
      letter-spacing: -0.02em;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
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
    .theme-icon {
      display: block;
      flex: none;
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
      background: transparent;
      border-color: var(--amber);
      color: var(--amber);
    }
    .nav-item.active {
      background: var(--amber);
      border-color: var(--amber);
      color: var(--ink);
    }
    .main {
      margin-left: 208px;
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
      font-family: var(--font-mono);
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .theme-btn {
      color: var(--amber);
      border-color: var(--amber-dim);
    }
    .hamburger {
      color: var(--mute);
      display: none;
    }
    .theme-btn:hover,
    .hamburger:hover {
      color: var(--amber);
      border-color: var(--amber);
    }
    .hamburger:hover {
      color: var(--text);
    }
    .content {
      padding: var(--s-6) var(--s-5);
      max-width: 1440px;
      width: 100%;
      min-width: 0;
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
