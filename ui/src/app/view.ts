import { html, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { navigate } from "../router.js";
import type { AppAction, AppState } from "./types.js";
import "../components/health-badge.js";
import "../components/trigger-dialog.js";
import "../views/login.js";
import "../views/overview-view.js";
import "../views/run-list.js";
import "../views/run-detail.js";
import "../views/live-view.js";
import "../views/compare-view.js";
import "../views/not-found.js";

function navClass(routeName: AppState["route"]["name"], name: AppState["route"]["name"]): string {
  return routeName === name ? "nav-item active" : "nav-item";
}

function topbarTitle(route: AppState["route"]): string {
  const name = route.name;
  if (name === "overview") return "Overview";
  if (name === "compare") return "Compare Artillery Runs";
  if (name === "detail" || name === "live") return "Artillery Run Status";
  return "Artillery Runs";
}

function routeView(route: AppState["route"]) {
  switch (route.name) {
    case "overview":
      return html`<broadside-overview-view></broadside-overview-view>`;
    case "list":
      return html`<broadside-run-list></broadside-run-list>`;
    case "detail":
      return keyed(
        route.id,
        html`<broadside-run-detail .runId=${route.id}></broadside-run-detail>`,
      );
    case "live":
      return keyed(
        route.id,
        html`<broadside-live-view .runId=${route.id}></broadside-live-view>`,
      );
    case "compare":
      return html`<broadside-compare-view></broadside-compare-view>`;
    case "not-found":
      return html`<broadside-not-found
        message=${`No page at ${route.path}`}
      ></broadside-not-found>`;
  }
}

export function view(state: AppState, dispatch: (a: AppAction) => void): TemplateResult {
  if (state.needsAuth) {
    return html`<broadside-login
      @login-success=${() => dispatch({ type: "login_success" })}
    ></broadside-login>`;
  }

  const dark = state.theme === "dark";
  const route = state.route;

  return html`
    <div class="shell">
      <aside class="sidebar ${state.sidebarOpen ? "open" : ""}">
        <button
          class="brand"
          @click=${() => navigate("/")}
          aria-label="Broadside — home"
        >
          <img src="/favicon.svg" alt="" class="brand-img" />
          <span class="brand-name">Broadside</span>
        </button>
        <nav>
          <a
            class=${navClass(route.name, "overview")}
            href="#/"
            @click=${(e: Event) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <span class="glyph" aria-hidden="true">◆</span> Overview
          </a>
          <a
            class=${navClass(route.name, "list")}
            href="#/runs"
            @click=${(e: Event) => {
              e.preventDefault();
              navigate("/runs");
            }}
          >
            <span class="glyph" aria-hidden="true">▶</span> Runs
          </a>
          <a
            class=${navClass(route.name, "compare")}
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
      ${state.sidebarOpen
        ? html`<div
            class="scrim"
            @click=${() => dispatch({ type: "set_sidebar", open: false })}
          ></div>`
        : ""}
      <main class="main">
        <header class="topbar">
          <button
            class="hamburger"
            @click=${() => dispatch({ type: "set_sidebar", open: !state.sidebarOpen })}
            aria-label="Menu"
          >
            <span class="glyph" aria-hidden="true">≡</span>
          </button>
          <span class="topbar-title">${topbarTitle(route)}</span>
          <span class="topbar-right">
            <broadside-health-badge></broadside-health-badge>
            <button
              class="theme-btn"
              @click=${() => dispatch({ type: "toggle_theme", theme: dark ? "light" : "dark" })}
              title=${dark ? "switch to light" : "switch to dark"}
              aria-label="Toggle theme"
            >
              <span class="glyph glyph-large" aria-hidden="true">${dark ? "☽" : "☼"}</span>
            </button>
          </span>
        </header>
        <section
          class="content"
          @new-run=${() => dispatch({ type: "set_trigger", open: true })}
        >
          ${routeView(route)}
        </section>
      </main>
    </div>

    <broadside-trigger-dialog
      .open=${state.triggerOpen}
      @close=${() => dispatch({ type: "set_trigger", open: false })}
      @run-started=${(e: CustomEvent<{ id: string }>) => {
        dispatch({ type: "set_trigger", open: false });
        navigate(`/runs/${e.detail.id}/live`);
      }}
    ></broadside-trigger-dialog>
  `;
}
