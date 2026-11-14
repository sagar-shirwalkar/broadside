import { html, type TemplateResult } from "lit";
import { navigate } from "../../lib/router.ts";
import type { State } from "./types.ts";

export function view(state: State): TemplateResult {
  return html`
    <main class="page">
      <p class="code">404</p>
      <h1>${state.message}</h1>
      <p class="hint">// the run may have been deleted, or the link is stale.</p>
      <button class="btn" @click=${() => navigate("/")}>← go to run list</button>
    </main>
  `;
}
