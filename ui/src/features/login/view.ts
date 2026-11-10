import { html, type TemplateResult } from "lit";
import type { Cmd } from "../../core/types.js";
import { submitLogin } from "./cmds.js";
import type { Action, State } from "./types.js";

export function view(
  state: State,
  dispatch: (a: Action) => void,
  run: (c: Cmd<Action>) => void,
): TemplateResult {
  const onSubmit = () => {
    dispatch({ type: "submit_started" });
    run(submitLogin(state.token));
  };

  return html`
    <main class="page">
      <section class="card">
        <div class="brand">
          <span class="brand-dot" aria-hidden="true"></span>
          <h1>Broadside</h1>
          <p class="sub">artillery run dashboard</p>
        </div>
        ${state.error ? html`<p class="warn">⚠ ${state.error}</p>` : ""}
        <label class="field">
          api token
          <input
            class="input"
            type="password"
            autocomplete="current-password"
            .value=${state.token}
            @input=${(e: Event) => {
              dispatch({ type: "token_changed", token: (e.target as HTMLInputElement).value });
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") onSubmit();
            }}
          />
        </label>
        <button class="btn primary" ?disabled=${state.submitting} @click=${onSubmit}>
          sign in →
        </button>
        <footer class="foot">
          <span>powered by artillery</span>
        </footer>
      </section>
    </main>
  `;
}
