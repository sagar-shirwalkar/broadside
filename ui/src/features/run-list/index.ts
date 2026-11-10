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

@customElement("broadside-run-list")
export class RunListFeature extends LitElement {
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
    this.dispatch({ type: "load_started" });
    this.run(loadRuns(this.model.limit, this.model.offset));
  }

  protected override render() {
    return view(this.model, this.dispatch, this.run);
  }

  static override styles = css`
    .page { display: flex; flex-direction: column; gap: var(--s-5); min-width: 0; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; }
    h1 { margin: 0; font-size: var(--step-3); }
    .controls { display: flex; align-items: center; gap: var(--s-2); }
    .btn { font-family: var(--font-mono); font-size: var(--step-0); padding: var(--s-2) var(--s-5); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; transition: all var(--dur-fast) var(--ease); }
    .btn:hover:not(:disabled) { border-color: var(--amber); color: var(--amber); }
    .btn.primary { background: var(--amber); border-color: var(--amber); color: var(--ink); }
    .btn.primary:hover:not(:disabled) { background: var(--amber-dim); color: var(--ink); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow-x: auto; padding: var(--s-2) var(--s-5); min-width: 0; }
    .empty { padding: var(--s-8); text-align: center; color: var(--mute); font-family: var(--font-mono); font-size: var(--step--1); }
    table { width: 100%; border-collapse: collapse; font-size: var(--step-0); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    th { text-align: left; font-weight: 500; color: var(--mute); font-size: var(--step--1); text-transform: uppercase; letter-spacing: 0.08em; padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--border); }
    td { padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--border); color: var(--text-dim); }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr { cursor: pointer; transition: background var(--dur-fast) var(--ease); }
    tbody tr:hover { background: color-mix(in oklab, var(--surface) 50%, transparent); }
    .id { color: var(--accent); }
    .muted { color: var(--mute); }
    .status-cell { display: inline-flex; align-items: center; gap: var(--s-2); font-family: var(--font-mono); font-size: var(--step--1); }
    .status-ok { color: var(--ok); } .status-bad { color: var(--bad); } .status-warn { color: var(--warn); }
    .icon-text-btn { display: inline-flex; align-items: center; gap: var(--s-1); background: transparent; border: 1px solid transparent; border-radius: var(--radius); color: var(--mute); font-family: var(--font-mono); font-size: var(--step--1); padding: var(--s-1) var(--s-2); cursor: pointer; transition: all var(--dur-fast) var(--ease); }
    .icon-text-btn:hover { color: var(--bad); border-color: var(--bad); }
    .icon-text-btn .icon { flex: none; }
    .pager { display: flex; align-items: center; justify-content: center; gap: var(--s-2); flex-wrap: wrap; }
    .page-btn { min-width: 34px; height: 34px; padding: 0 var(--s-2); font-family: var(--font-mono); font-size: var(--step--1); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text-dim); cursor: pointer; transition: all var(--dur-fast) var(--ease); }
    .page-btn:hover:not(.current) { border-color: var(--amber-dim); color: var(--text); }
    .page-btn.current { background: var(--amber); border-color: var(--amber); color: var(--ink); font-weight: 500; }
    .ellipsis { font-family: var(--font-mono); font-size: var(--step--1); color: var(--mute); padding: 0 var(--s-1); }
    .lat-ok { color: var(--ok); }
    .lat-warn { color: var(--warn); }
    .lat-bad { color: var(--bad); }
  `;
}
