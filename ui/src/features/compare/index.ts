import { LitElement, css } from "lit";
import { customElement } from "lit/decorators.js";
import type { Cmd } from "../../core/types.js";
import { runCmd } from "../../core/cmd.js";
import { loadRuns } from "./cmds.js";
import { initialState, type Action, type State } from "./types.js";
import { update } from "./update.js";
import { view } from "./view.js";

export { initialState, update, view };
export type { State, Action };

@customElement("broadside-compare-view")
export class CompareFeature extends LitElement {
  private model: State = initialState;

  private dispatch = (action: Action): void => {
    this.model = update(this.model, action);
    this.requestUpdate();
  };

  private run = (cmd: Cmd<Action>): void => {
    runCmd(cmd, this.dispatch);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.model = { ...initialState };
    this.run(loadRuns());
  }

  protected override render() {
    return view(this.model, this.dispatch, this.run);
  }

  static override styles = css`
    .page { display: flex; flex-direction: column; gap: var(--s-5); min-width: 0; }
    h1 { margin: 0; font-size: var(--step-3); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--s-5); min-width: 0; }
    .actions { display: flex; align-items: flex-end; gap: var(--s-3); flex-wrap: wrap; margin-bottom: var(--s-4); }
    .count { margin-left: auto; font-family: var(--font-mono); font-size: var(--step--1); color: var(--mute); padding-bottom: var(--s-2); }
    .btn { font-family: var(--font-mono); font-size: var(--step-0); padding: var(--s-2) var(--s-5); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; transition: all var(--dur-fast) var(--ease); }
    .btn:hover:not(:disabled) { border-color: var(--amber); color: var(--amber); }
    .btn.primary { background: var(--amber); border-color: var(--amber); color: var(--ink); }
    .btn.primary:hover:not(:disabled) { background: var(--amber-dim); color: var(--ink); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .picker { max-height: calc(10 * 41px); overflow-y: auto; margin: 0 calc(var(--s-5) * -1); padding: 0 var(--s-5); min-width: 0; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--step-0); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    th { text-align: left; font-weight: 500; color: var(--mute); font-size: var(--step--1); text-transform: uppercase; letter-spacing: 0.08em; padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); }
    td { padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--border); color: var(--text-dim); }
    tbody tr:hover { background: color-mix(in oklab, var(--surface) 50%, transparent); }
    tr.selected { box-shadow: inset 0 0 0 1px var(--amber); }
    tr.selected td { border-bottom-color: var(--amber); }
    td input[type="checkbox"] { accent-color: var(--amber); cursor: pointer; width: 16px; height: 16px; }
    .muted { color: var(--mute); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-4); min-width: 0; }
    @media (max-width: 1024px) { .grid { grid-template-columns: 1fr; } }
    .table-card { padding: var(--s-2) var(--s-5); overflow-x: auto; min-width: 0; }
    .best { font-weight: 500; color: var(--ok); }
    .elapsed-note { margin: 0 0 var(--s-2); font-family: var(--font-mono); font-size: var(--step--1); color: var(--mute); }
    .mono { font-family: var(--font-mono); }
    .lat-ok { color: var(--ok); }
    .lat-warn { color: var(--warn); }
    .lat-bad { color: var(--bad); }
  `;
}
